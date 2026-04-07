"""Load LoRA with Unsloth and convert to GGUF.
Must use Unsloth's FastLanguageModel (not raw transformers/PEFT).
Usage: python convert_gguf.py --lora-dir PATH
"""
import argparse
import os
import sys
import shutil
from pathlib import Path

os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lora-dir", required=True)
    args = parser.parse_args()

    lora_dir = Path(args.lora_dir)
    gguf_dir = lora_dir.parent / "gguf"
    gguf_dir.mkdir(parents=True, exist_ok=True)

    print(f"LoRA: {lora_dir}")
    print(f"GGUF output: {gguf_dir}")

    # Ensure config.json exists
    if not (lora_dir / "config.json").exists():
        print("config.json missing in lora dir, copying from HF cache...")
        try:
            import json
            adapter_cfg = json.loads((lora_dir / "adapter_config.json").read_text(encoding="utf-8"))
            base_name = adapter_cfg.get("base_model_name_or_path", "")
            from huggingface_hub import hf_hub_download
            src = hf_hub_download(base_name, "config.json")
            shutil.copy2(src, str(lora_dir / "config.json"))
            print(f"  Copied from {base_name}")
        except Exception as e:
            print(f"  Failed: {e}")

    # Copy config.json to gguf dir too
    if (lora_dir / "config.json").exists():
        shutil.copy2(str(lora_dir / "config.json"), str(gguf_dir / "config.json"))

    from unsloth import FastLanguageModel

    # Load with Unsloth (same way as training)
    print("\n[1/3] Loading model with Unsloth...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        str(lora_dir),
        max_seq_length=2048,
        load_in_4bit=True,
    )

    # GGUF conversion (Unsloth handles merge internally)
    print("\n[2/3] Converting to GGUF (q4_k_m)...")
    print("  This may take 10-15 minutes...")
    model.save_pretrained_gguf(
        str(gguf_dir), tokenizer, quantization_method="q4_k_m"
    )

    # Register with Ollama
    print("\n[3/3] Registering with Ollama...")
    gguf_files = list(gguf_dir.glob("*.gguf"))
    if gguf_files:
        project_name = lora_dir.parent.parent.name
        modelfile = gguf_dir / "Modelfile"
        modelfile.write_text(f"FROM gemma4\nADAPTER {gguf_files[0].name}\n", encoding="utf-8")

        import subprocess
        subprocess.run(
            ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile)],
            cwd=str(gguf_dir),
        )
        print(f"\nDone! Model: storyforge-{project_name}")
    else:
        print("\nGGUF file not found after conversion.")


if __name__ == "__main__":
    main()
