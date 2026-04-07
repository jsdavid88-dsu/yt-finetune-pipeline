"""Merge LoRA adapter into base model and register with Ollama.
Bypasses Unsloth's buggy merge — uses PEFT + transformers directly.

Usage: python merge_and_register.py --lora-dir PATH
"""
import argparse
import os
import sys

os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lora-dir", required=True)
    args = parser.parse_args()

    from pathlib import Path
    lora_dir = Path(args.lora_dir)
    merged_dir = lora_dir.parent / "merged_full"
    merged_dir.mkdir(parents=True, exist_ok=True)

    print(f"LoRA: {lora_dir}")
    print(f"Output: {merged_dir}")

    import json
    adapter_config = json.loads((lora_dir / "adapter_config.json").read_text(encoding="utf-8"))
    base_model_name = adapter_config.get("base_model_name_or_path", "")
    print(f"Base model (from adapter): {base_model_name}")

    # Map bnb-4bit model names to their non-quantized originals
    non_bnb_name = base_model_name.replace("-unsloth-bnb-4bit", "").replace("-bnb-4bit", "")
    print(f"Non-quantized base: {non_bnb_name}")

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    # Step 1: Load base model in bfloat16 (NOT quantized)
    print("\n[1/4] Loading base model in bfloat16...")
    model = AutoModelForCausalLM.from_pretrained(
        non_bnb_name,
        dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(non_bnb_name, trust_remote_code=True)

    # Step 2: Load and merge LoRA
    print("\n[2/4] Loading and merging LoRA adapter...")
    model = PeftModel.from_pretrained(model, str(lora_dir))
    model = model.merge_and_unload()

    # Step 3: Save merged model
    print("\n[3/4] Saving merged model...")
    model.save_pretrained(str(merged_dir), safe_serialization=True)
    tokenizer.save_pretrained(str(merged_dir))
    print(f"  Saved to {merged_dir}")

    # Verify files
    safetensors_files = list(merged_dir.glob("*.safetensors"))
    config_file = merged_dir / "config.json"
    print(f"  safetensors files: {len(safetensors_files)}")
    print(f"  config.json: {config_file.exists()}")

    if not safetensors_files or not config_file.exists():
        print("ERROR: Merge produced incomplete output")
        sys.exit(1)

    # Free GPU memory
    del model
    torch.cuda.empty_cache()

    # Step 4: Register with Ollama
    print("\n[4/4] Registering with Ollama...")
    modelfile = merged_dir / "Modelfile"
    modelfile.write_text(f"FROM {merged_dir}\n", encoding="utf-8")

    import subprocess as sp
    project_name = lora_dir.parent.parent.name

    result = sp.run(
        ["ollama", "create", f"storyforge-{project_name}",
         "-f", str(modelfile), "--experimental", "-q", "q4_K_M"],
    )

    if result.returncode == 0:
        print(f"\n=== Success! ===")
        print(f"Model: storyforge-{project_name}")
        print(f"Test: ollama run storyforge-{project_name}")
    else:
        print(f"\nOllama registration failed.")
        print(f"Merged model saved at: {merged_dir}")
        print(f"Try manually: ollama create storyforge-{project_name} -f {modelfile} --experimental -q q4_K_M")


if __name__ == "__main__":
    main()
