"""Load LoRA with Unsloth and convert to GGUF.
Must use Unsloth's FastLanguageModel (not raw transformers/PEFT).
Usage: python convert_gguf.py --lora-dir PATH
"""
import argparse
import json
import os
import sys
import shutil
from pathlib import Path

os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"

# Map from bnb-4bit model names to their FP16 counterparts
BNB4_TO_FP16_MAP = {
    "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit": "unsloth/gemma-4-E4B-it",
    "unsloth/gemma-4-12B-it-unsloth-bnb-4bit": "unsloth/gemma-4-12B-it",
    "unsloth/gemma-4-27B-it-unsloth-bnb-4bit": "unsloth/gemma-4-27B-it",
    "unsloth/gemma-4-31B-it-unsloth-bnb-4bit": "unsloth/gemma-4-31B-it",
}


def _resolve_fp16_base(adapter_config_path: Path) -> str | None:
    """Given an adapter_config.json, find the FP16 base model name for merge."""
    try:
        cfg = json.loads(adapter_config_path.read_text(encoding="utf-8"))
        base = cfg.get("base_model_name_or_path", "")
        # If it's a bnb-4bit model, map to its FP16 counterpart
        if base in BNB4_TO_FP16_MAP:
            return BNB4_TO_FP16_MAP[base]
        # If it contains "bnb-4bit", try to derive the FP16 name
        if "bnb-4bit" in base:
            # e.g. "unsloth/Foo-bnb-4bit" -> try "google/Foo" or "unsloth/Foo"
            return None  # can't reliably guess
        return None  # already FP16 or unknown
    except Exception:
        return None


def _ensure_fp16_in_cache(model_name: str):
    """Pre-download FP16 base model weights into HF cache so merge can find them."""
    print(f"  Pre-caching FP16 base model: {model_name}")
    print("  (This downloads the full-precision weights once for the merge step)")
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            model_name,
            ignore_patterns=["*.gguf", "*.bin"],
        )
        print("  FP16 weights cached successfully.")
    except Exception as e:
        print(f"  Warning: Could not cache FP16 weights: {e}")
        print("  The merge step may fail or re-download weights.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lora-dir", required=True)
    parser.add_argument("--quantization", default="q4_k_m",
                        help="GGUF quantization method (default: q4_k_m)")
    args = parser.parse_args()

    lora_dir = Path(args.lora_dir)
    gguf_dir = lora_dir.parent / "gguf"
    gguf_dir.mkdir(parents=True, exist_ok=True)

    print(f"LoRA: {lora_dir}")
    print(f"GGUF output: {gguf_dir}")

    # --- Step 0: Ensure FP16 base weights are in HF cache ---
    # This is critical for the merge step when training was done with load_in_4bit.
    # Without FP16 weights in cache, save_pretrained_gguf writes only config.json
    # (with bitsandbytes quantization_config), and llama.cpp's converter fails with:
    #   NotImplementedError: Quant method is not yet supported: 'bitsandbytes'
    adapter_cfg_path = lora_dir / "adapter_config.json"
    if adapter_cfg_path.exists():
        fp16_base = _resolve_fp16_base(adapter_cfg_path)
        if fp16_base:
            _ensure_fp16_in_cache(fp16_base)

    from unsloth import FastLanguageModel

    # Load with Unsloth (same way as training)
    print("\n[1/3] Loading model with Unsloth...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        str(lora_dir),
        max_seq_length=2048,
        load_in_4bit=True,
    )

    # GGUF conversion (Unsloth handles merge internally)
    print(f"\n[2/3] Converting to GGUF ({args.quantization})...")
    print("  This may take 10-15 minutes...")
    model.save_pretrained_gguf(
        str(gguf_dir), tokenizer, quantization_method=args.quantization
    )

    # Verify safetensors were actually written (not just config.json)
    safetensor_files = list(gguf_dir.glob("*.gguf"))
    if not safetensor_files:
        print("\nERROR: No .gguf files produced. The merge step likely failed silently.")
        print("Try running with the FP16 base model pre-cached, or use load_in_16bit=True.")
        sys.exit(1)

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
