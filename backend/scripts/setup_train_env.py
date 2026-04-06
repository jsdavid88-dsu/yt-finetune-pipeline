"""Auto-create a Python venv and install CUDA PyTorch + Unsloth for LoRA training.

Usage (standalone):
    python setup_train_env.py --project-dir PATH [--venv-dir PATH]

The script writes progress to {project_dir}/train_progress.json at each step
and prints the venv python path to stdout on success.
"""
import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import venv
from pathlib import Path

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
_BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_VENV_DIR = _BACKEND_DIR / ".train-venv"

SETUP_TOTAL = 5

# Unsloth dependencies to install individually (without touching torch)
UNSLOTH_DEPS = [
    "triton-windows; sys_platform == 'win32'",
    "bitsandbytes",
    "peft",
    "trl",
    "datasets",
    "transformers",
    "accelerate",
    "xformers",
    "sentencepiece",
    "protobuf",
    "huggingface_hub",
    "hf_transfer",
    "tyro",
    "psutil",
    "wheel",
    "packaging",
    "cut_cross_entropy",
]


# ---------------------------------------------------------------------------
# Progress helpers
# ---------------------------------------------------------------------------

def _write_progress(progress_file: Path, status: str, detail: str = "",
                    setup_step: int = 0, error: str | None = None) -> None:
    """Write a progress JSON that the frontend can poll."""
    payload: dict = {
        "status": status,
        "detail": detail,
        "setup_step": setup_step,
        "setup_total": SETUP_TOTAL,
    }
    if error is not None:
        payload["error"] = error
    progress_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _fail(progress_file: Path, msg: str) -> None:
    """Write failure status and exit."""
    _write_progress(progress_file, "failed", error=msg)
    print(f"SETUP FAILED: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# CUDA detection
# ---------------------------------------------------------------------------

def detect_cuda_version() -> str | None:
    """Run ``nvidia-smi`` and parse ``CUDA Version: X.Y`` into a PyTorch-compatible tag.

    Maps to the closest supported PyTorch CUDA version.
    Returns None when CUDA is not available.
    """
    try:
        output = subprocess.check_output(
            ["nvidia-smi"], text=True, stderr=subprocess.DEVNULL,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    m = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", output)
    if not m:
        return None

    major, minor = int(m.group(1)), int(m.group(2))

    # PyTorch supported CUDA versions (as of 2026)
    # Map to closest supported version
    if major >= 13:
        return "cu128"  # CUDA 13.x / RTX 50xx → need cu128 for sm_120
    elif major == 12:
        if minor >= 6:
            return "cu126"
        elif minor >= 4:
            return "cu124"
        else:
            return "cu121"
    elif major == 11:
        return "cu118"
    else:
        return None


# ---------------------------------------------------------------------------
# Venv python path
# ---------------------------------------------------------------------------

def get_venv_python(venv_dir: Path) -> Path:
    """Return the OS-appropriate python executable inside *venv_dir*."""
    if platform.system() == "Windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


# ---------------------------------------------------------------------------
# Pip runner
# ---------------------------------------------------------------------------

def _run_pip(venv_python: Path, pip_args: list[str], progress_file: Path,
             step: int, detail_prefix: str) -> None:
    """Run a pip install command inside the venv and stream last-line updates
    to the progress file.
    """
    cmd = [str(venv_python), "-m", "pip", "install", "--progress-bar", "off"] + pip_args
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )

    last_line = ""
    for raw_line in proc.stdout:  # type: ignore[union-attr]
        line = raw_line.strip()
        if line:
            last_line = line
            short = last_line[:120]
            _write_progress(progress_file, "setup", f"{detail_prefix}: {short}",
                            setup_step=step)

    proc.wait()
    if proc.returncode != 0:
        _fail(progress_file, f"pip install failed ({detail_prefix}): {last_line}")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate(venv_python: Path) -> bool:
    """Return True if torch+CUDA and unsloth are importable in the venv."""
    code = (
        "import torch; "
        "assert torch.cuda.is_available(), 'CUDA not available'; "
        "from unsloth import FastLanguageModel; "
        "print('OK')"
    )
    try:
        result = subprocess.run(
            [str(venv_python), "-c", code],
            capture_output=True, text=True, timeout=120,
        )
        return result.returncode == 0 and "OK" in result.stdout
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Main setup
# ---------------------------------------------------------------------------

def setup(project_dir: Path, venv_dir: Path) -> Path:
    """Create venv, install dependencies, validate.

    Returns the path to the venv python on success.
    """
    progress_file = project_dir / "train_progress.json"
    progress_file.parent.mkdir(parents=True, exist_ok=True)
    venv_python = get_venv_python(venv_dir)

    # ------------------------------------------------------------------
    # Fast path: venv already exists AND validation passes → skip setup
    # ------------------------------------------------------------------
    if venv_python.exists():
        _write_progress(progress_file, "setup", "Validating existing environment...",
                        setup_step=5)
        if _validate(venv_python):
            _write_progress(progress_file, "setup", "Environment ready (cached).",
                            setup_step=5)
            return venv_python
        # Validation failed → nuke and recreate
        _write_progress(progress_file, "setup",
                        "Existing venv failed validation, recreating...",
                        setup_step=1)
        shutil.rmtree(venv_dir, ignore_errors=True)

    # ------------------------------------------------------------------
    # Step 1: Create venv
    # ------------------------------------------------------------------
    _write_progress(progress_file, "setup", "Creating virtual environment...",
                    setup_step=1)
    try:
        venv.create(str(venv_dir), with_pip=True, clear=True)
    except Exception as exc:
        _fail(progress_file, f"Failed to create venv: {exc}")

    if not venv_python.exists():
        _fail(progress_file, f"venv python not found at {venv_python}")

    # Upgrade pip/setuptools inside the venv
    _run_pip(venv_python, ["--upgrade", "pip", "setuptools", "wheel"],
             progress_file, 1, "Upgrading pip")

    # ------------------------------------------------------------------
    # Step 2: Detect CUDA version
    # ------------------------------------------------------------------
    _write_progress(progress_file, "setup", "Detecting CUDA version...",
                    setup_step=2)
    cuda_ver = detect_cuda_version()
    if cuda_ver is None:
        _fail(progress_file, "NVIDIA GPU required. nvidia-smi not found or CUDA not detected.")

    _write_progress(progress_file, "setup", f"CUDA detected: {cuda_ver}",
                    setup_step=2)

    # ------------------------------------------------------------------
    # Step 3: Install CUDA PyTorch FIRST (prevent CPU torch override)
    # ------------------------------------------------------------------
    index_url = f"https://download.pytorch.org/whl/{cuda_ver}"
    _write_progress(progress_file, "setup",
                    f"Installing PyTorch (CUDA {cuda_ver})...", setup_step=3)
    _run_pip(venv_python, ["torch", "torchvision", "--index-url", index_url],
             progress_file, 3, "PyTorch")

    # ------------------------------------------------------------------
    # Step 4: Install Unsloth WITHOUT touching torch
    # ------------------------------------------------------------------
    _write_progress(progress_file, "setup", "Installing Unsloth (no-deps)...",
                    setup_step=4)
    _run_pip(venv_python, ["--no-deps", "unsloth", "unsloth_zoo"],
             progress_file, 4, "Unsloth core")

    # Install remaining deps individually
    for dep in UNSLOTH_DEPS:
        _write_progress(progress_file, "setup", f"Installing {dep}...",
                        setup_step=4)
        _run_pip(venv_python, [dep], progress_file, 4, dep)

    # ------------------------------------------------------------------
    # Step 5: Validate
    # ------------------------------------------------------------------
    _write_progress(progress_file, "setup", "Validating installation...",
                    setup_step=5)
    if not _validate(venv_python):
        _fail(progress_file,
              "Validation failed: torch.cuda.is_available() or unsloth import failed. "
              "Delete the venv and retry, or check GPU drivers.")

    _write_progress(progress_file, "setup", "Environment ready.", setup_step=5)
    return venv_python


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create training venv with CUDA PyTorch + Unsloth",
    )
    parser.add_argument("--project-dir", required=True, type=Path,
                        help="Project data directory (contains train_progress.json)")
    parser.add_argument("--venv-dir", type=Path, default=DEFAULT_VENV_DIR,
                        help="Path for the training venv (default: backend/.train-venv)")
    args = parser.parse_args()

    venv_python = setup(args.project_dir, args.venv_dir)
    # Print the venv python path so the caller can capture it from stdout
    print(str(venv_python))


if __name__ == "__main__":
    main()
