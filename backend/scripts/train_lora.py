"""Standalone LoRA training script. Run as subprocess.
Usage: python train_lora.py --config path/to/config.json
"""
import argparse
import json
import sys
from pathlib import Path


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

    base_model = config.get("base_model", "unsloth/gemma-3-4b-it-bnb-4bit")
    num_epochs = config.get("num_epochs", 3)
    learning_rate = config.get("learning_rate", 2e-4)
    batch_size = config.get("batch_size", 4)
    lora_rank = config.get("lora_rank", 16)
    max_seq_length = config.get("max_seq_length", 4096)

    def update_progress(status, epoch=0, total_epochs=0, loss=None, error=None):
        progress = {
            "status": status,
            "epoch": epoch,
            "total_epochs": total_epochs,
            "progress": int(epoch / total_epochs * 100) if total_epochs else 0,
            "loss": loss,
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

            sp.check_call([sys.executable, "-m", "pip", "install", "unsloth"])
            from unsloth import FastLanguageModel

        from datasets import load_dataset
        from trl import SFTTrainer
        from transformers import TrainingArguments, TrainerCallback

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
            lora_alpha=lora_rank,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
        )

        dataset = load_dataset("json", data_files=str(dataset_path), split="train")

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

        dataset = dataset.map(formatting_func, batched=True)
        update_progress("training", 0, num_epochs)

        class ProgressCallback(TrainerCallback):
            def on_epoch_end(self, _args, state, **kwargs):
                current_epoch = int(state.epoch)
                current_loss = (
                    state.log_history[-1].get("loss") if state.log_history else None
                )
                update_progress("training", current_epoch, num_epochs, current_loss)

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            dataset_text_field="text",
            max_seq_length=max_seq_length,
            args=TrainingArguments(
                per_device_train_batch_size=batch_size,
                num_train_epochs=num_epochs,
                learning_rate=learning_rate,
                fp16=True,
                logging_steps=1,
                output_dir=str(output_dir / "checkpoints"),
                save_strategy="epoch",
                seed=42,
            ),
            callbacks=[ProgressCallback()],
        )

        trainer.train()
        update_progress("converting", num_epochs, num_epochs)

        model.save_pretrained(str(output_dir / "lora"))
        tokenizer.save_pretrained(str(output_dir / "lora"))
        model.save_pretrained_gguf(
            str(output_dir), tokenizer, quantization_method="q4_k_m"
        )

        update_progress("registering", num_epochs, num_epochs)

        project_name = project_dir.name
        gguf_files = list(output_dir.glob("*.gguf"))
        if gguf_files:
            modelfile_path = output_dir / "Modelfile"
            modelfile_path.write_text(
                f"FROM gemma4\nADAPTER {gguf_files[0].name}\n", encoding="utf-8"
            )
            import subprocess as sp

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
