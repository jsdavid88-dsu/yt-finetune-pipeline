"""Standalone LoRA training script. Run as subprocess.
Usage: python train_lora.py --config path/to/config.json

This script expects to run inside a venv with CUDA torch + Unsloth installed.
Use setup_train_env.py to prepare the environment first.
"""
import argparse
import json
import os
import sys
from pathlib import Path

# Pre-set Unsloth env vars before importing anything
os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    project_dir = Path(config["project_dir"])
    progress_file = project_dir / "train_progress.json"
    dataset_path = project_dir / "dataset.jsonl"
    output_dir = project_dir / "adapters"
    output_dir.mkdir(parents=True, exist_ok=True)

    # --- Hyperparameters ---
    base_model = config.get("base_model", "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit")
    num_epochs = config.get("num_epochs", 2)
    learning_rate = config.get("learning_rate", 1e-4)
    batch_size = config.get("batch_size", 2)
    gradient_accumulation_steps = config.get("gradient_accumulation_steps", 16)
    lora_rank = config.get("lora_rank", 32)
    lora_alpha = config.get("lora_alpha", lora_rank * 2)
    max_seq_length = config.get("max_seq_length", 4096)
    warmup_ratio = config.get("warmup_ratio", 0.05)
    weight_decay = config.get("weight_decay", 0.01)
    eval_split = config.get("eval_split", 0.05)

    def update_progress(status, epoch=0, total_epochs=0, loss=None, eval_loss=None, error=None, **extra):
        progress = {
            "status": status,
            "epoch": epoch,
            "total_epochs": total_epochs,
            "progress": int(epoch / total_epochs * 100) if total_epochs else 0,
            "loss": loss,
            "eval_loss": eval_loss,
            "error": error,
            **extra,
        }
        progress_file.write_text(
            json.dumps(progress, ensure_ascii=False), encoding="utf-8"
        )

    # Map bnb-4bit model names to FP16 counterparts for merge step
    bnb4_to_fp16 = {
        "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit": "google/gemma-4-E4B-it",
        "unsloth/gemma-4-12B-it-unsloth-bnb-4bit": "google/gemma-4-12B-it",
        "unsloth/gemma-4-27B-it-unsloth-bnb-4bit": "google/gemma-4-27B-it",
        "unsloth/gemma-4-31B-it-unsloth-bnb-4bit": "google/gemma-4-31B-it",
    }

    try:
        # Import (should work since setup_train_env prepared the venv)
        update_progress("loading_model", detail="Unsloth 로딩 중...")
        from unsloth import FastModel
        from datasets import load_dataset
        from trl import SFTTrainer
        from transformers import TrainingArguments, TrainerCallback, EarlyStoppingCallback
        import torch

        use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()

        # Use non-bnb model for 16bit training (GGUF merge works cleanly)
        # bnb-4bit models cause merge failures with save_pretrained_gguf
        NON_BNB = {
            "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit": "unsloth/gemma-4-E4B-it",
            "unsloth/gemma-4-31B-it-unsloth-bnb-4bit": "unsloth/gemma-4-31B-it",
        }
        actual_model = NON_BNB.get(base_model, base_model)

        update_progress("loading_model", detail=f"모델 다운로드 중: {actual_model}...")
        model, tokenizer = FastModel.from_pretrained(
            model_name=actual_model,
            max_seq_length=max_seq_length,
            load_in_4bit=False,
            full_finetuning=False,
        )

        update_progress("loading_model", detail="LoRA 어댑터 설정 중...")
        model = FastModel.get_peft_model(
            model,
            finetune_vision_layers=False,
            finetune_language_layers=True,
            finetune_attention_modules=True,
            finetune_mlp_modules=True,
            r=lora_rank,
            lora_alpha=lora_alpha,
            lora_dropout=0,
            bias="none",
            random_state=42,
        )

        # --- Dataset ---
        update_progress("loading_model", detail="데이터셋 로딩 중...")
        dataset = load_dataset("json", data_files=str(dataset_path), split="train")
        dataset = dataset.shuffle(seed=42)

        if eval_split > 0 and len(dataset) > 100:
            split = dataset.train_test_split(test_size=eval_split, seed=42)
            train_dataset = split["train"]
            eval_dataset = split["test"]
        else:
            train_dataset = dataset
            eval_dataset = None

        alpaca_prompt = (
            "Below is an instruction that describes a task. "
            "Write a response that appropriately completes the request.\n\n"
            "### Instruction:\n{}\n\n### Input:\n{}\n\n### Response:\n{}"
        )

        def formatting_func(examples):
            texts = []
            for inst, inp, out in zip(
                examples["instruction"], examples["input"], examples["output"]
            ):
                texts.append(
                    alpaca_prompt.format(inst, inp, out) + tokenizer.eos_token
                )
            return {"text": texts}

        train_dataset = train_dataset.map(formatting_func, batched=True)
        if eval_dataset is not None:
            eval_dataset = eval_dataset.map(formatting_func, batched=True)

        total_steps = (len(train_dataset) // (batch_size * gradient_accumulation_steps)) * num_epochs
        update_progress("training", 0, num_epochs,
                        detail=f"학습 시작 — {len(train_dataset)}개 데이터, {total_steps} steps")

        class ProgressCallback(TrainerCallback):
            def on_log(self, _args, state, control=None, logs=None, **kwargs):
                if not state.log_history:
                    return
                last = state.log_history[-1]
                current_loss = last.get("loss")
                current_eval_loss = last.get("eval_loss")
                current_epoch = state.epoch or 0
                step = state.global_step
                update_progress(
                    "training",
                    epoch=int(current_epoch),
                    total_epochs=num_epochs,
                    loss=current_loss,
                    eval_loss=current_eval_loss,
                    step=step,
                    total_steps=total_steps,
                    detail=f"Step {step}/{total_steps}" + (f" | loss: {current_loss:.4f}" if current_loss else ""),
                )

        # --- Training Arguments ---
        training_args = TrainingArguments(
            per_device_train_batch_size=batch_size,
            gradient_accumulation_steps=gradient_accumulation_steps,
            num_train_epochs=num_epochs,
            learning_rate=learning_rate,
            lr_scheduler_type="cosine",
            warmup_ratio=warmup_ratio,
            weight_decay=weight_decay,
            bf16=use_bf16,
            fp16=not use_bf16,
            logging_steps=1,
            output_dir=str(output_dir / "checkpoints"),
            save_strategy="steps",
            save_steps=500,
            seed=42,
            optim="adamw_8bit",
        )

        if eval_dataset is not None:
            training_args.eval_strategy = "steps"
            training_args.eval_steps = 500
            training_args.load_best_model_at_end = True
            training_args.metric_for_best_model = "eval_loss"

        callbacks = [ProgressCallback()]
        if eval_dataset is not None:
            callbacks.append(EarlyStoppingCallback(early_stopping_patience=3))

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=train_dataset,
            eval_dataset=eval_dataset,
            dataset_text_field="text",
            max_seq_length=max_seq_length,
            args=training_args,
            callbacks=callbacks,
        )

        trainer.train()

        # --- Save LoRA adapter ---
        update_progress("converting", num_epochs, num_epochs, detail="LoRA 어댑터 저장 중...")
        lora_dir = output_dir / "lora"
        model.save_pretrained(str(lora_dir))
        tokenizer.save_pretrained(str(lora_dir))

        # --- GGUF 변환 (모델이 메모리에 있을 때 바로 실행) ---
        update_progress("converting", num_epochs, num_epochs, detail="GGUF 변환 중 (10~15분 소요)...")
        gguf_dir = output_dir / "gguf"
        gguf_dir.mkdir(parents=True, exist_ok=True)

        # NOTE: Do NOT copy the bnb-4bit config.json into gguf_dir.
        # save_pretrained_gguf handles the merge internally and writes its own
        # clean config.json. Copying the bnb-4bit config.json causes llama.cpp's
        # converter to fail with:
        #   NotImplementedError: Quant method is not yet supported: 'bitsandbytes'

        import shutil
        gguf_success = False
        try:
            model.save_pretrained_gguf(
                str(gguf_dir), tokenizer, quantization_method="q4_k_m"
            )
            # Verify .gguf file was actually produced
            if list(gguf_dir.glob("*.gguf")):
                gguf_success = True
            else:
                print("GGUF conversion produced no .gguf files (merge may have failed silently)")
        except Exception as gguf_err:
            print(f"GGUF conversion failed: {gguf_err}")
            import traceback
            traceback.print_exc()

        # --- Ollama 등록 ---
        if gguf_success:
            update_progress("registering", num_epochs, num_epochs, detail="Ollama에 모델 등록 중...")

            ollama_base_map = {
                "gemma-4-E4B": "gemma4",
                "gemma-4-12B": "gemma4:12b",
                "gemma-4-26B": "gemma4:27b",
                "gemma-4-27B": "gemma4:27b",
                "gemma-4-31B": "gemma4:31b",
                "llama-3.1-8b": "llama3.1:8b",
                "Qwen2.5-7B": "qwen2.5:7b",
            }
            ollama_base = "gemma4"
            for key, val in ollama_base_map.items():
                if key.lower() in base_model.lower():
                    ollama_base = val
                    break

            import subprocess as sp
            project_name = project_dir.name
            gguf_files = list(gguf_dir.glob("*.gguf"))
            if gguf_files:
                modelfile_path = gguf_dir / "Modelfile"
                modelfile_path.write_text(
                    f"FROM {ollama_base}\nADAPTER {gguf_files[0].name}\n", encoding="utf-8"
                )
                sp.run(
                    ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile_path)],
                    cwd=str(gguf_dir),
                )
            update_progress("completed", num_epochs, num_epochs, detail="학습 완료! 모델 등록됨")
        else:
            update_progress("completed", num_epochs, num_epochs,
                            detail="학습 완료! (GGUF 변환 실패 — llama.cpp 업데이트 필요)")
    except Exception as exc:
        update_progress("failed", error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
