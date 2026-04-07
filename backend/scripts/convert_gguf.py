"""Convert LoRA adapter to GGUF for Ollama registration.
Usage: python convert_gguf.py --lora-dir PATH
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
    merged_dir = lora_dir.parent / "merged_16bit"
    merged_dir.mkdir(parents=True, exist_ok=True)

    print(f"LoRA: {lora_dir}")
    print(f"Merged output: {merged_dir}")

    from unsloth import FastLanguageModel
    import torch

    # Step 1: Load in 16bit (not 4bit) for clean merge
    print("\n[1/4] Loading base model + LoRA in 16bit...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        str(lora_dir),
        max_seq_length=2048,
        load_in_4bit=False,  # 16bit for clean merge
        dtype=torch.float16,
    )

    # Step 2: Save merged 16bit model
    print("\n[2/4] Merging and saving 16bit model...")
    model.save_pretrained_merged(
        str(merged_dir),
        tokenizer,
        save_method="merged_16bit",
    )

    # Ensure config.json exists in merged dir
    import shutil
    merged_config = merged_dir / "config.json"
    if not merged_config.exists():
        # Copy from lora dir
        lora_config = lora_dir / "config.json"
        if lora_config.exists():
            shutil.copy2(str(lora_config), str(merged_config))
            print("  Copied config.json from lora dir")
        else:
            # Copy from HF cache
            try:
                from huggingface_hub import hf_hub_download
                src = hf_hub_download("unsloth/gemma-4-E4B-it-unsloth-bnb-4bit", "config.json")
                shutil.copy2(src, str(merged_config))
                print("  Copied config.json from HF cache")
            except Exception:
                print("  WARNING: config.json not found anywhere")

    # Free GPU memory
    del model
    torch.cuda.empty_cache()

    # Step 3: Convert to GGUF
    print("\n[3/4] Converting to GGUF (q4_k_m)...")
    # Use llama.cpp directly
    import subprocess
    llama_cpp_convert = Path.home() / ".unsloth" / "llama.cpp" / "convert_hf_to_gguf.py"
    if not llama_cpp_convert.exists():
        llama_cpp_convert = Path.home() / ".unsloth" / "llama.cpp" / "unsloth_convert_hf_to_gguf.py"

    venv_python = Path(sys.executable)
    gguf_bf16 = merged_dir / "model-bf16.gguf"
    gguf_q4 = merged_dir / "model-q4_k_m.gguf"

    # Step 3a: HF -> GGUF bf16
    print("  Converting HF -> GGUF bf16...")
    result = subprocess.run(
        [str(venv_python), str(llama_cpp_convert),
         "--outfile", str(gguf_bf16), "--outtype", "bf16",
         str(merged_dir)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  HF->GGUF failed: {result.stderr[:500]}")
        print("  Trying Unsloth method instead...")
        # Reload in 4bit and try unsloth GGUF
        model2, tokenizer2 = FastLanguageModel.from_pretrained(
            str(lora_dir), max_seq_length=2048, load_in_4bit=True,
        )
        model2.save_pretrained_gguf(
            str(merged_dir), tokenizer2, quantization_method="q4_k_m",
        )
        gguf_files = list(merged_dir.glob("*.gguf"))
        if gguf_files:
            gguf_q4 = gguf_files[0]
        else:
            print("All conversion methods failed.")
            sys.exit(1)
    else:
        # Step 3b: GGUF bf16 -> q4_k_m
        print("  Quantizing bf16 -> q4_k_m...")
        quantize_bin = Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "llama-quantize"
        if not quantize_bin.exists():
            quantize_bin = Path.home() / ".unsloth" / "llama.cpp" / "build" / "bin" / "llama-quantize.exe"
        if quantize_bin.exists():
            subprocess.run(
                [str(quantize_bin), str(gguf_bf16), str(gguf_q4), "q4_k_m"],
            )
            # Remove bf16 to save space
            if gguf_q4.exists():
                gguf_bf16.unlink(missing_ok=True)
        else:
            print(f"  llama-quantize not found at {quantize_bin}")
            gguf_q4 = gguf_bf16  # Use bf16 as fallback

    # Step 4: Register with Ollama
    print("\n[4/4] Registering with Ollama...")
    gguf_files = list(merged_dir.glob("*.gguf"))
    if not gguf_files:
        print("No GGUF file found.")
        sys.exit(1)

    gguf_file = gguf_files[0]
    project_name = lora_dir.parent.parent.name
    modelfile = merged_dir / "Modelfile"
    modelfile.write_text(f"FROM {gguf_file.name}\n", encoding="utf-8")

    import subprocess as sp
    result = sp.run(
        ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile)],
        cwd=str(merged_dir),
    )

    if result.returncode == 0:
        print(f"\nDone! Model: storyforge-{project_name}")
        print(f"Test: ollama run storyforge-{project_name}")
    else:
        print("\nOllama registration failed.")
        print(f"GGUF file is at: {gguf_file}")


if __name__ == "__main__":
    main()
