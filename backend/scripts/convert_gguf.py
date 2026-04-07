"""Convert LoRA adapter to GGUF — pure transformers, no Unsloth.
Usage: python convert_gguf.py --lora-dir PATH
"""
import argparse
import json
import os
import sys
import shutil
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lora-dir", required=True)
    args = parser.parse_args()

    lora_dir = Path(args.lora_dir)
    merged_dir = lora_dir.parent / "merged_full"
    gguf_dir = lora_dir.parent / "gguf"

    for d in [merged_dir, gguf_dir]:
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    merged_dir.mkdir(parents=True, exist_ok=True)
    gguf_dir.mkdir(parents=True, exist_ok=True)

    # Read adapter config
    adapter_cfg = json.loads((lora_dir / "adapter_config.json").read_text(encoding="utf-8"))
    base_model_bnb = adapter_cfg.get("base_model_name_or_path", "")
    # Get non-bnb version
    # Must use google/ original (not unsloth/) — unsloth models have
    # Gemma4ClippableLinear which PEFT can't handle
    BNB_TO_GOOGLE = {
        "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit": "google/gemma-4-e4b-it",
        "unsloth/gemma-4-E4B-it": "google/gemma-4-e4b-it",
        "unsloth/gemma-4-12B-it-unsloth-bnb-4bit": "google/gemma-4-12b-it",
        "unsloth/gemma-4-12B-it": "google/gemma-4-12b-it",
        "unsloth/gemma-4-31B-it-unsloth-bnb-4bit": "google/gemma-4-31b-it",
        "unsloth/gemma-4-31B-it": "google/gemma-4-31b-it",
    }
    base_model = BNB_TO_GOOGLE.get(base_model_bnb, base_model_bnb.replace("-unsloth-bnb-4bit", "").replace("-bnb-4bit", ""))

    print(f"LoRA: {lora_dir}")
    print(f"Base: {base_model}")
    print(f"Merged: {merged_dir}")
    print(f"GGUF: {gguf_dir}")

    import torch

    # [1/4] Load base model with raw transformers (NOT Unsloth)
    print("\n[1/4] Loading base model (transformers, bfloat16)...")
    print("  This avoids Unsloth's custom layers that block merge")

    # Monkey-patch adapter_config to point to non-bnb model
    adapter_cfg_backup = lora_dir / "adapter_config.json.bak"
    shutil.copy2(str(lora_dir / "adapter_config.json"), str(adapter_cfg_backup))

    adapter_cfg["base_model_name_or_path"] = base_model
    (lora_dir / "adapter_config.json").write_text(
        json.dumps(adapter_cfg, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import PeftModel

        model = AutoModelForCausalLM.from_pretrained(
            base_model,
            dtype=torch.bfloat16,
            device_map="cpu",  # CPU to save GPU memory for larger models
            trust_remote_code=True,
        )
        tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

        # [2/4] Load and merge LoRA
        print("\n[2/4] Merging LoRA adapter...")
        model = PeftModel.from_pretrained(model, str(lora_dir))
        model = model.merge_and_unload()

        # [3/4] Save merged model
        print("\n[3/4] Saving merged safetensors...")
        model.save_pretrained(str(merged_dir), safe_serialization=True)
        tokenizer.save_pretrained(str(merged_dir))

        # Clean config.json
        config_path = merged_dir / "config.json"
        if config_path.exists():
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config.pop("quantization_config", None)
            config_path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")

        st_files = list(merged_dir.glob("*.safetensors"))
        print(f"  Saved {len(st_files)} file(s)")

        del model
        torch.cuda.empty_cache()

    finally:
        # Restore original adapter_config
        if adapter_cfg_backup.exists():
            shutil.move(str(adapter_cfg_backup), str(lora_dir / "adapter_config.json"))

    if not st_files:
        print("ERROR: No safetensors saved")
        sys.exit(1)

    # [4/4] Convert to GGUF
    print("\n[4/4] Converting to GGUF...")
    converter = Path.home() / ".unsloth" / "llama.cpp" / "convert_hf_to_gguf.py"

    gguf_bf16 = gguf_dir / "model-bf16.gguf"
    gguf_q4 = gguf_dir / "model-q4_k_m.gguf"

    print("  HF → bf16 GGUF...")
    result = subprocess.run(
        [sys.executable, str(converter),
         "--outfile", str(gguf_bf16),
         "--outtype", "bf16",
         str(merged_dir)],
    )

    if result.returncode != 0:
        print("  GGUF conversion failed.")
        print("  Try: update_llamacpp.bat")
        sys.exit(1)

    # Quantize
    quantize_bin = None
    for p in [
        Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "Release" / "llama-quantize.exe",
        Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "llama-quantize.exe",
        Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "llama-quantize",
    ]:
        if p.exists():
            quantize_bin = p
            break

    if quantize_bin:
        print("  bf16 → q4_k_m...")
        subprocess.run([str(quantize_bin), str(gguf_bf16), str(gguf_q4), "q4_k_m"])
        if gguf_q4.exists():
            gguf_bf16.unlink(missing_ok=True)
            final_gguf = gguf_q4
        else:
            final_gguf = gguf_bf16
    else:
        print("  llama-quantize not found, using bf16")
        final_gguf = gguf_bf16

    print(f"  GGUF: {final_gguf} ({final_gguf.stat().st_size / 1024**3:.1f} GB)")

    # Register with Ollama
    print("\nRegistering with Ollama...")
    project_name = lora_dir.parent.parent.name
    modelfile = gguf_dir / "Modelfile"
    modelfile.write_text(f"FROM {final_gguf.name}\n", encoding="utf-8")

    subprocess.run(
        ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile)],
        cwd=str(gguf_dir),
    )
    print(f"\nDone! Model: storyforge-{project_name}")


if __name__ == "__main__":
    main()
