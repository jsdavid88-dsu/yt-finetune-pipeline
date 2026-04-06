"""Standalone LoRA training script. Run as subprocess.
Usage: python train_lora.py --config path/to/config.json
"""
import argparse
import json
import os
import sys
from pathlib import Path

# Pre-set Unsloth env vars before importing anything
os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"  # Allow 2GB for cross entropy loss


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
    lora_alpha = config.get("lora_alpha", lora_rank * 2)  # ratio 2
    max_seq_length = config.get("max_seq_length", 4096)
    warmup_ratio = config.get("warmup_ratio", 0.05)
    weight_decay = config.get("weight_decay", 0.01)
    eval_split = config.get("eval_split", 0.05)  # 5% for validation

    def update_progress(status, epoch=0, total_epochs=0, loss=None, eval_loss=None, error=None):
        progress = {
            "status": status,
            "epoch": epoch,
            "total_epochs": total_epochs,
            "progress": int(epoch / total_epochs * 100) if total_epochs else 0,
            "loss": loss,
            "eval_loss": eval_loss,
            "error": error,
        }
        progress_file.write_text(
            json.dumps(progress, ensure_ascii=False), encoding="utf-8"
        )

    try:
        update_progress("installing")
        try:
            from unsloth import FastLanguageModel
        except ImportError:
            import subprocess as sp
            import threading

            # pip install with real-time progress updates
            proc = sp.Popen(
                [sys.executable, "-m", "pip", "install", "unsloth", "--progress-bar", "off"],
                stdout=sp.PIPE, stderr=sp.STDOUT, text=True, encoding="utf-8", errors="replace",
            )

            def _read_pip_output():
                last_line = ""
                while True:
                    line = proc.stdout.readline()
                    if not line and proc.poll() is not None:
                        break
                    line = line.strip()
                    if line:
                        last_line = line
                        # Update progress with pip output
                        short = last_line[:80]
                        update_progress("installing", error=None,
                                        epoch=0, total_epochs=0)
                        # Write pip status to a separate field
                        progress = json.loads(progress_file.read_text(encoding="utf-8"))
                        progress["detail"] = short
                        progress_file.write_text(
                            json.dumps(progress, ensure_ascii=False), encoding="utf-8"
                        )

            reader = threading.Thread(target=_read_pip_output, daemon=True)
            reader.start()
            proc.wait()
            reader.join(timeout=5)

            if proc.returncode != 0:
                update_progress("failed", error="Unsloth 설치 실패. 터미널에서 'pip install unsloth'을 직접 실행해보세요.")
                sys.exit(1)

            from unsloth import FastLanguageModel

        from datasets import load_dataset
        from trl import SFTTrainer
        from transformers import TrainingArguments, TrainerCallback, EarlyStoppingCallback
        import torch

        # Detect bf16 support
        use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()

        update_progress("loading_model")
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=base_model,
            max_seq_length=max_seq_length,
            load_in_4bit=True,
        )

        model = FastLanguageModel.get_peft_model(
            model,
            r=lora_rank,
            target_modules=[
                "q_proj",
                "k_proj",
                "v_proj",
                "o_proj",
                "gate_proj",
                "up_proj",
                "down_proj",
            ],
            lora_alpha=lora_alpha,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
            use_rslora=True,
        )

        # --- Dataset ---
        dataset = load_dataset("json", data_files=str(dataset_path), split="train")
        dataset = dataset.shuffle(seed=42)

        # Train/eval split
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

        update_progress("training", 0, num_epochs)

        class ProgressCallback(TrainerCallback):
            def on_epoch_end(self, _args, state, **kwargs):
                current_epoch = int(state.epoch)
                current_loss = None
                current_eval_loss = None
                if state.log_history:
                    for entry in reversed(state.log_history):
                        if current_loss is None and "loss" in entry:
                            current_loss = entry["loss"]
                        if current_eval_loss is None and "eval_loss" in entry:
                            current_eval_loss = entry["eval_loss"]
                        if current_loss is not None and current_eval_loss is not None:
                            break
                update_progress("training", current_epoch, num_epochs, current_loss, current_eval_loss)

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
            logging_steps=10,
            output_dir=str(output_dir / "checkpoints"),
            save_strategy="steps",
            save_steps=500,
            seed=42,
            optim="adamw_8bit",
        )

        # Add eval if we have eval dataset
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
        update_progress("converting", num_epochs, num_epochs)

        model.save_pretrained(str(output_dir / "lora"))
        tokenizer.save_pretrained(str(output_dir / "lora"))
        model.save_pretrained_gguf(
            str(output_dir), tokenizer, quantization_method="q4_k_m"
        )

        update_progress("registering", num_epochs, num_epochs)

        # Map unsloth model to Ollama base model
        ollama_base_map = {
            "gemma-4-E4B": "gemma4",
            "gemma-4-E12B": "gemma4:12b",
            "gemma-4-E27B": "gemma4:27b",
            "gemma-3-4b": "gemma4",
            "llama-3.1-8b": "llama3.1:8b",
            "Qwen2.5-7B": "qwen2.5:7b",
        }
        ollama_base = "gemma4"
        for key, val in ollama_base_map.items():
            if key in base_model:
                ollama_base = val
                break

        # Ensure Ollama has the matching base model
        import subprocess as sp
        sp.run(["ollama", "pull", ollama_base], capture_output=True)

        project_name = project_dir.name
        gguf_files = list(output_dir.glob("*.gguf"))
        if gguf_files:
            modelfile_path = output_dir / "Modelfile"
            modelfile_path.write_text(
                f"FROM {ollama_base}\nADAPTER {gguf_files[0].name}\n", encoding="utf-8"
            )

            sp.run(
                [
                    "ollama",
                    "create",
                    f"storyforge-{project_name}",
                    "-f",
                    str(modelfile_path),
                ],
                cwd=str(output_dir),
                capture_output=True,
            )

        update_progress("completed", num_epochs, num_epochs)
    except Exception as exc:
        update_progress("failed", error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
