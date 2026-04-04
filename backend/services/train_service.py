"""Training service — manages training subprocess lifecycle."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_train_processes: dict[str, subprocess.Popen] = {}


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
    """Launch training subprocess for the given project."""
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
        json.dumps({"status": "starting", "progress": 0}), encoding="utf-8"
    )

    proc = subprocess.Popen(
        [
            sys.executable,
            str(_SCRIPTS_DIR / "train_lora.py"),
            "--config",
            str(config_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    _train_processes[project_id] = proc
    return {"status": "started", "pid": proc.pid}


def get_progress(project_id: str) -> dict:
    """Read current training progress from the progress JSON file."""
    progress_path = _DATA_DIR / project_id / "train_progress.json"
    if not progress_path.exists():
        return {"status": "idle", "progress": 0}
    try:
        return json.loads(progress_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, IOError):
        return {"status": "unknown", "progress": 0}


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
