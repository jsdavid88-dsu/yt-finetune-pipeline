"""Convert LoRA adapter to GGUF for Ollama registration.
Usage: python convert_gguf.py --lora-dir PATH [--output-dir PATH]
"""
import argparse
import os
import sys

os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lora-dir", required=True, help="Path to LoRA adapter folder")
    parser.add_argument("--output-dir", default=None, help="Output folder (default: lora-dir/../merged)")
    parser.add_argument("--project-name", default=None, help="Ollama model name (default: folder name)")
    args = parser.parse_args()

    from pathlib import Path
    lora_dir = Path(args.lora_dir)
    output_dir = Path(args.output_dir) if args.output_dir else lora_dir.parent / "merged"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"LoRA: {lora_dir}")
    print(f"Output: {output_dir}")

    from unsloth import FastLanguageModel

    print("Loading model + LoRA...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        str(lora_dir),
        max_seq_length=2048,
        load_in_4bit=True,
    )

    # Try 16bit merge first, then 4bit forced as fallback
    print("Saving merged model (16bit)...")
    try:
        model.save_pretrained_merged(
            str(output_dir),
            tokenizer,
            save_method="merged_16bit",
        )
    except Exception as e1:
        print(f"16bit merge failed: {e1}")
        print("Trying lora_only method...")
        try:
            model.save_pretrained_merged(
                str(output_dir),
                tokenizer,
                save_method="lora",
            )
        except Exception as e2:
            print(f"lora method also failed: {e2}")
            print("Skipping merge, trying direct GGUF...")

    print("Converting to GGUF (q4_k_m)...")
    try:
        model.save_pretrained_gguf(
            str(output_dir),
            tokenizer,
            quantization_method="q4_k_m",
        )
    except Exception as e:
        print(f"GGUF conversion failed: {e}")
        print("\nFallback: Saving as LoRA-only GGUF...")
        try:
            model.save_pretrained_gguf(
                str(lora_dir),
                tokenizer,
                quantization_method="q4_k_m",
            )
            output_dir = lora_dir
        except Exception as e2:
            print(f"All GGUF methods failed: {e2}")
            print("You may need to convert on a different machine.")
            sys.exit(1)

    # Register with Ollama
    gguf_files = list(output_dir.glob("*.gguf"))
    if gguf_files:
        project_name = args.project_name or lora_dir.parent.parent.name
        modelfile = output_dir / "Modelfile"
        modelfile.write_text(f"FROM gemma4\nADAPTER {gguf_files[0].name}\n", encoding="utf-8")

        import subprocess
        print(f"Registering with Ollama as storyforge-{project_name}...")
        subprocess.run(
            ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile)],
            cwd=str(output_dir),
        )
        print(f"Done! Model registered: storyforge-{project_name}")
    else:
        print("GGUF file not found. Ollama registration skipped.")


if __name__ == "__main__":
    main()
