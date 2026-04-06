"""Training service — manages training subprocess lifecycle."""
from __future__ import annotations

import json
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_SCRIPTS_DIR = _BACKEND_DIR / "scripts"
_DATA_DIR = _BACKEND_DIR / "data"
_VENV_DIR = _BACKEND_DIR / ".train-venv"
_train_processes: dict[str, subprocess.Popen] = {}


def _get_venv_python() -> Path:
    """Return venv python path for current OS."""
    if platform.system() == "Windows":
        return _VENV_DIR / "Scripts" / "python.exe"
    return _VENV_DIR / "bin" / "python"


def check_gpu() -> dict:
    """Check whether an NVIDIA GPU is available via nvidia-smi."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return {"available": True, "info": result.stdout.strip()}
    except Exception:
        pass
    return {"available": False, "info": "NVIDIA GPU not detected"}


def start_training(project_id: str, config: dict[str, Any]) -> dict:
    """Launch training: setup env (if needed) → train."""
    if project_id in _train_processes:
        proc = _train_processes[project_id]
        if proc.poll() is None:
            return {"error": "이 프로젝트에서 이미 학습이 진행 중입니다."}

    project_dir = _DATA_DIR / project_id
    if not (project_dir / "dataset.jsonl").exists():
        return {"error": "dataset.jsonl이 없습니다. 먼저 정제를 완료하세요."}

    config["project_dir"] = str(project_dir)
    config_path = project_dir / "train_config.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

    (project_dir / "train_progress.json").write_text(
        json.dumps({"status": "starting", "progress": 0, "detail": "환경 확인 중..."}),
        encoding="utf-8",
    )

    # Determine python to use: venv if exists, else system (setup will create venv)
    venv_python = _get_venv_python()
    if venv_python.exists():
        train_python = str(venv_python)
    else:
        train_python = sys.executable

    # Launch: setup_train_env first, then train_lora
    # We use a wrapper approach: run setup, then exec train
    proc = subprocess.Popen(
        [
            train_python,
            "-u",
            str(_SCRIPTS_DIR / "train_wrapper.py"),
            "--config", str(config_path),
            "--venv-dir", str(_VENV_DIR),
        ],
    )
    _train_processes[project_id] = proc
    return {"status": "started", "pid": proc.pid}


def get_progress(project_id: str) -> dict:
    """Read current training progress from the progress JSON file."""
    progress_path = _DATA_DIR / project_id / "train_progress.json"
    if not progress_path.exists():
        return {"status": "idle", "progress": 0}
    try:
        data = json.loads(progress_path.read_text(encoding="utf-8"))
        # If failed/completed and no active process, allow restart
        if data.get("status") in ("failed", "completed"):
            proc = _train_processes.get(project_id)
            if proc is None or proc.poll() is not None:
                # Clean up stale progress so UI shows idle
                pass  # Keep showing status so user sees result
        return data
    except (json.JSONDecodeError, IOError):
        # Corrupted file — reset
        progress_path.unlink(missing_ok=True)
        return {"status": "idle", "progress": 0}


def stop_training(project_id: str) -> dict:
    """Terminate the training subprocess for the given project."""
    proc = _train_processes.get(project_id)
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
        return {"status": "stopped"}
    return {"status": "not_running"}
