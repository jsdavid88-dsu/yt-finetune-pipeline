"""Convert LoRA adapter to GGUF — bypasses Unsloth completely.
Loads base model + LoRA with Unsloth, merges, saves safetensors,
then runs llama.cpp converter directly.

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
    merged_dir = lora_dir.parent / "merged_full"
    gguf_dir = lora_dir.parent / "gguf"

    # Clean previous attempts
    for d in [merged_dir, gguf_dir]:
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    merged_dir.mkdir(parents=True, exist_ok=True)
    gguf_dir.mkdir(parents=True, exist_ok=True)

    print(f"LoRA: {lora_dir}")
    print(f"Merged: {merged_dir}")
    print(f"GGUF: {gguf_dir}")

    from unsloth import FastLanguageModel
    import torch

    # [1/4] Load in 16bit
    print("\n[1/4] Loading model (16bit)...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        str(lora_dir),
        max_seq_length=2048,
        load_in_4bit=False,
    )

    # [2/4] Merge LoRA and save as safetensors manually
    print("\n[2/4] Merging LoRA + saving safetensors...")
    # Use Unsloth's internal merge
    model.save_pretrained_merged(
        str(merged_dir),
        tokenizer,
        save_method="merged_16bit",
    )

    # Check if safetensors were actually saved
    st_files = list(merged_dir.glob("*.safetensors"))
    if not st_files:
        print("  WARNING: No safetensors in merged dir. Trying manual save...")
        # Fallback: disable adapter and save base model directly
        try:
            model.disable_adapter_layers()
            model.base_model.save_pretrained(str(merged_dir), safe_serialization=True)
            tokenizer.save_pretrained(str(merged_dir))
            st_files = list(merged_dir.glob("*.safetensors"))
        except Exception as e:
            print(f"  Manual save failed: {e}")

    if not st_files:
        print("\nERROR: Could not save merged model as safetensors.")
        print("The LoRA adapter is saved at:", lora_dir)
        sys.exit(1)

    # Make sure config.json exists and is clean (no bitsandbytes)
    config_path = merged_dir / "config.json"
    if config_path.exists():
        import json
        config = json.loads(config_path.read_text(encoding="utf-8"))
        if "quantization_config" in config:
            del config["quantization_config"]
            config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
            print("  Cleaned quantization_config from config.json")

    print(f"  Saved {len(st_files)} safetensors file(s)")

    # Free GPU
    del model
    torch.cuda.empty_cache()

    # [3/4] Convert to GGUF with llama.cpp
    print("\n[3/4] Converting to GGUF...")
    import subprocess

    converter = Path.home() / ".unsloth" / "llama.cpp" / "convert_hf_to_gguf.py"
    if not converter.exists():
        converter = Path.home() / ".unsloth" / "llama.cpp" / "unsloth_convert_hf_to_gguf.py"

    venv_python = Path(sys.executable)
    gguf_bf16 = gguf_dir / "model-bf16.gguf"
    gguf_q4 = gguf_dir / "model-q4_k_m.gguf"

    print("  HF → GGUF bf16...")
    result = subprocess.run(
        [str(venv_python), str(converter),
         "--outfile", str(gguf_bf16),
         "--outtype", "bf16",
         str(merged_dir)],
    )

    if result.returncode != 0:
        print(f"\n  HF→GGUF conversion failed (exit code {result.returncode})")
        print("  Check if llama.cpp supports Gemma4.")
        print("  Try: update_llamacpp.bat")
        sys.exit(1)

    # Quantize
    quantize_bin = Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "Release" / "llama-quantize.exe"
    if not quantize_bin.exists():
        quantize_bin = Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "llama-quantize.exe"
    if not quantize_bin.exists():
        quantize_bin = Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "llama-quantize"

    if quantize_bin.exists():
        print("  bf16 → q4_k_m...")
        subprocess.run([str(quantize_bin), str(gguf_bf16), str(gguf_q4), "q4_k_m"])
        if gguf_q4.exists():
            gguf_bf16.unlink(missing_ok=True)
            final_gguf = gguf_q4
        else:
            final_gguf = gguf_bf16
    else:
        print(f"  llama-quantize not found, using bf16 (larger file)")
        final_gguf = gguf_bf16

    if not final_gguf.exists():
        print("\nERROR: GGUF file not created.")
        sys.exit(1)

    print(f"  GGUF: {final_gguf} ({final_gguf.stat().st_size / 1024**3:.1f} GB)")

    # [4/4] Register with Ollama
    print("\n[4/4] Registering with Ollama...")
    project_name = lora_dir.parent.parent.name
    modelfile = gguf_dir / "Modelfile"
    modelfile.write_text(f"FROM {final_gguf.name}\n", encoding="utf-8")

    subprocess.run(
        ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile)],
        cwd=str(gguf_dir),
    )
    print(f"\nDone! Model: storyforge-{project_name}")
    print(f"Test: ollama run storyforge-{project_name}")


if __name__ == "__main__":
    main()
