"""Training wrapper: setup environment → launch training.
Handles venv creation and re-exec if needed.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--venv-dir", required=True)
    args = parser.parse_args()

    config_path = Path(args.config)
    venv_dir = Path(args.venv_dir)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    project_dir = Path(config["project_dir"])
    scripts_dir = Path(__file__).resolve().parent

    # Import setup module
    sys.path.insert(0, str(scripts_dir))
    from setup_train_env import setup, get_venv_python

    # Step 1: Ensure environment is ready
    venv_python = setup(project_dir, venv_dir)
    if venv_python is None:
        # setup already wrote error to progress file
        sys.exit(1)

    # Step 2: If we're not running in the venv, re-exec in venv
    current_python = Path(sys.executable).resolve()
    target_python = Path(str(venv_python)).resolve()

    if current_python != target_python:
        # Re-launch train_lora.py with venv python
        proc = subprocess.Popen(
            [str(venv_python), "-u",
             str(scripts_dir / "train_lora.py"),
             "--config", str(config_path)],
        )
        proc.wait()
        sys.exit(proc.returncode)
    else:
        # Already in venv, run train directly
        proc = subprocess.Popen(
            [str(venv_python), "-u",
             str(scripts_dir / "train_lora.py"),
             "--config", str(config_path)],
        )
        proc.wait()
        sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
