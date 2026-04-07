"""Convert LoRA adapter to GGUF using Unsloth FastModel.
Based on official Unsloth docs: https://unsloth.ai/docs/models/gemma-4/train

Usage: python convert_gguf.py --lora-dir PATH
"""
import argparse
import os
import sys
from pathlib import Path

os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lora-dir", required=True)
    args = parser.parse_args()

    lora_dir = Path(args.lora_dir)
    gguf_dir = lora_dir.parent / "gguf"

    # Clean previous
    import shutil
    if gguf_dir.exists():
        shutil.rmtree(gguf_dir, ignore_errors=True)
    gguf_dir.mkdir(parents=True, exist_ok=True)

    print(f"LoRA: {lora_dir}")
    print(f"GGUF: {gguf_dir}")

    # Use FastModel (NOT FastLanguageModel) per official docs
    from unsloth import FastModel
    import torch

    print("\n[1/2] Loading model with FastModel (4bit)...")
    model, tokenizer = FastModel.from_pretrained(
        str(lora_dir),
        max_seq_length=2048,
        load_in_4bit=True,
    )

    print("\n[2/2] Converting to GGUF (q4_k_m)...")
    print("  This may take 10-15 minutes...")
    model.save_pretrained_gguf(
        str(gguf_dir), tokenizer, quantization_method="q4_k_m"
    )

    # Check output
    gguf_files = list(gguf_dir.glob("*.gguf"))
    if not gguf_files:
        print("\nERROR: No GGUF files produced.")
        sys.exit(1)

    print(f"\n  GGUF: {gguf_files[0]} ({gguf_files[0].stat().st_size / 1024**3:.1f} GB)")

    # Register with Ollama
    print("\nRegistering with Ollama...")
    project_name = lora_dir.parent.parent.name
    modelfile = gguf_dir / "Modelfile"
    modelfile.write_text(f"FROM {gguf_files[0].name}\n", encoding="utf-8")

    import subprocess
    subprocess.run(
        ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile)],
        cwd=str(gguf_dir),
    )
    print(f"\nDone! Model: storyforge-{project_name}")


if __name__ == "__main__":
    main()
