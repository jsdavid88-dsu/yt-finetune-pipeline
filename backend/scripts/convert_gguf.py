"""Convert LoRA adapter to GGUF.
Bypasses Unsloth's merge (Windows file locking issue).
Uses manual PEFT merge on CPU + llama.cpp conversion.

Usage: python convert_gguf.py --lora-dir PATH
"""
import argparse
import json
import os
import sys
import shutil
import subprocess
from pathlib import Path

os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"


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

    # Read base model from adapter config
    adapter_cfg = json.loads((lora_dir / "adapter_config.json").read_text(encoding="utf-8"))
    base_model = adapter_cfg.get("base_model_name_or_path", "")
    print(f"LoRA: {lora_dir}")
    print(f"Base: {base_model}")

    import torch

    # [1/4] Load base model on CPU with safetensors memory mapping disabled
    print("\n[1/4] Loading base model on CPU (no mmap)...")
    from transformers import AutoModelForCausalLM, AutoTokenizer, AutoConfig

    config = AutoConfig.from_pretrained(base_model, trust_remote_code=True)
    # Remove quantization config if present
    if hasattr(config, 'quantization_config'):
        delattr(config, 'quantization_config')

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        config=config,
        torch_dtype=torch.bfloat16,
        device_map="cpu",
        trust_remote_code=True,
        use_safetensors=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

    # [2/4] Load LoRA weights manually (avoid PEFT's module type check)
    print("\n[2/4] Applying LoRA weights manually...")
    from safetensors.torch import load_file

    lora_weights = load_file(str(lora_dir / "adapter_model.safetensors"), device="cpu")

    # Parse LoRA config
    lora_r = adapter_cfg.get("r", 32)
    lora_alpha = adapter_cfg.get("lora_alpha", 64)
    scaling = lora_alpha / lora_r

    # Apply LoRA: W = W + scaling * (B @ A)
    applied = 0
    skipped = []
    for key in sorted(lora_weights.keys()):
        if "lora_A" not in key:
            continue

        # Find matching B weight
        b_key = key.replace("lora_A", "lora_B")
        if b_key not in lora_weights:
            continue

        # Extract module path from LoRA key
        # LoRA key: base_model.model.model.language_model.layers.0.self_attn.q_proj.lora_A.weight
        # Base key: model.language_model.layers.0.self_attn.q_proj.weight
        module_path = key.split(".lora_A")[0]  # base_model.model.model.language_model.layers.0.self_attn.q_proj
        # Remove "base_model.model." prefix
        module_path = module_path.replace("base_model.model.", "", 1)  # model.language_model.layers.0.self_attn.q_proj

        # Navigate to the module
        parts = module_path.split(".")
        param = model
        try:
            for part in parts:
                param = getattr(param, part)
        except AttributeError:
            skipped.append(module_path)
            continue

        # Find the actual weight tensor
        weight = None
        if hasattr(param, 'weight'):
            weight = param.weight
        elif hasattr(param, 'linear') and hasattr(param.linear, 'weight'):
            weight = param.linear.weight

        if weight is None:
            skipped.append(f"{module_path} (no weight)")
            continue

        A = lora_weights[key]
        B = lora_weights[b_key]
        delta = (B.to(weight.dtype) @ A.to(weight.dtype)) * scaling
        weight.data += delta
        applied += 1

    print(f"  Applied {applied} LoRA layers")
    if skipped:
        print(f"  Skipped {len(skipped)}: {skipped[:3]}...")

    # [3/4] Save merged model
    print("\n[3/4] Saving merged model...")
    model.save_pretrained(str(merged_dir), safe_serialization=True)
    tokenizer.save_pretrained(str(merged_dir))

    # Clean config
    config_path = merged_dir / "config.json"
    if config_path.exists():
        cfg = json.loads(config_path.read_text(encoding="utf-8"))
        cfg.pop("quantization_config", None)
        config_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")

    st_files = list(merged_dir.glob("*.safetensors"))
    print(f"  {len(st_files)} safetensors saved")

    del model
    torch.cuda.empty_cache()

    # [4/4] GGUF conversion
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
        print("  GGUF conversion failed. Try: update_llamacpp.bat")
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

    final_gguf = gguf_bf16
    if quantize_bin:
        print("  bf16 → q4_k_m...")
        subprocess.run([str(quantize_bin), str(gguf_bf16), str(gguf_q4), "q4_k_m"])
        if gguf_q4.exists():
            gguf_bf16.unlink(missing_ok=True)
            final_gguf = gguf_q4

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
