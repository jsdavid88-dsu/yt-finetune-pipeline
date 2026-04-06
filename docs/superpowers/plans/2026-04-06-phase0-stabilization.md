# Phase 0: 안정화 + 환경 이식성 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어떤 PC/서버(Windows/Linux)에서든 원클릭으로 전체 파이프라인이 동작하게 만든다

**Architecture:** 학습 환경을 setup_train_env.py로 분리하여 venv/CUDA/Unsloth 자동 관리. 크로스 플랫폼 시작 스크립트. UI 버그 수정.

**Tech Stack:** Python venv, nvidia-smi, pip, FastAPI, React/TypeScript

**Spec:** `docs/superpowers/specs/2026-04-06-train-env-setup-design.md`

---

## Task 1: setup_train_env.py — 학습 환경 자동 구축 스크립트

**Files:**
- Create: `backend/scripts/setup_train_env.py`

- [ ] **Step 1: 스크립트 작성**

핵심 함수들:
- `detect_cuda_version()` — nvidia-smi에서 CUDA 버전 추출 → "cu126" 등
- `get_venv_python(venv_dir)` — OS별 python 경로 반환
- `setup(project_dir, progress_file)` — 전체 설치 흐름 + progress 실시간 기록

```python
"""Training environment auto-setup.
Creates venv, installs CUDA torch + Unsloth, validates.
"""
import json
import os
import platform
import re
import subprocess
import sys
import venv
from pathlib import Path


def update_progress(progress_file: Path, detail: str, step: int, total: int = 5):
    progress_file.write_text(json.dumps({
        "status": "setup",
        "detail": detail,
        "setup_step": step,
        "setup_total": total,
        "epoch": 0, "total_epochs": 0, "progress": 0,
        "loss": None, "eval_loss": None, "error": None,
    }, ensure_ascii=False), encoding="utf-8")


def detect_cuda_version() -> str | None:
    """Detect CUDA version from nvidia-smi."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return None
        # Get CUDA version from nvidia-smi header
        result2 = subprocess.run(
            ["nvidia-smi"], capture_output=True, text=True, timeout=10,
        )
        m = re.search(r"CUDA Version:\s+([\d.]+)", result2.stdout)
        if not m:
            return None
        ver = m.group(1)  # e.g. "12.6"
        major, minor = ver.split(".")[:2]
        return f"cu{major}{minor}"  # "cu126"
    except Exception:
        return None


def get_venv_python(venv_dir: Path) -> Path:
    """Return venv python path for current OS."""
    if platform.system() == "Windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def run_pip(venv_dir: Path, args: list[str], progress_file: Path | None = None, detail: str = "") -> bool:
    """Run pip in venv with output capture."""
    pip = get_venv_python(venv_dir).parent / ("pip.exe" if platform.system() == "Windows" else "pip")
    if not pip.exists():
        pip_args = [str(get_venv_python(venv_dir)), "-m", "pip"] + args
    else:
        pip_args = [str(pip)] + args

    proc = subprocess.Popen(
        pip_args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    for line in proc.stdout:
        line = line.strip()
        if line and progress_file:
            progress = json.loads(progress_file.read_text(encoding="utf-8"))
            progress["detail"] = f"{detail}: {line[:60]}"
            progress_file.write_text(json.dumps(progress, ensure_ascii=False), encoding="utf-8")
    proc.wait()
    return proc.returncode == 0


def validate(venv_dir: Path) -> bool:
    """Validate that venv has working CUDA torch + unsloth."""
    python = get_venv_python(venv_dir)
    if not python.exists():
        return False
    try:
        result = subprocess.run(
            [str(python), "-c",
             "import torch; assert torch.cuda.is_available(); from unsloth import FastLanguageModel; print('OK')"],
            capture_output=True, text=True, timeout=30,
        )
        return result.returncode == 0 and "OK" in result.stdout
    except Exception:
        return False


def setup(project_dir: Path, venv_dir: Path) -> Path | None:
    """Full setup flow. Returns venv python path or None on failure."""
    progress_file = project_dir / "train_progress.json"

    # Step 1: Check existing venv
    update_progress(progress_file, "환경 확인 중...", 1)
    venv_python = get_venv_python(venv_dir)
    if venv_python.exists() and validate(venv_dir):
        update_progress(progress_file, "환경 확인 완료", 5)
        return venv_python

    # Step 2: Detect CUDA
    update_progress(progress_file, "GPU/CUDA 버전 감지 중...", 2)
    cuda_ver = detect_cuda_version()
    if not cuda_ver:
        progress_file.write_text(json.dumps({
            "status": "failed",
            "error": "NVIDIA GPU를 찾을 수 없습니다. 학습에는 NVIDIA GPU가 필요합니다.",
            "epoch": 0, "total_epochs": 0, "progress": 0,
            "loss": None, "eval_loss": None,
        }, ensure_ascii=False), encoding="utf-8")
        return None

    # Step 3: Create venv + install CUDA torch
    update_progress(progress_file, f"가상환경 생성 + PyTorch 설치 중 (CUDA {cuda_ver})...", 3)
    if venv_dir.exists():
        import shutil
        shutil.rmtree(venv_dir, ignore_errors=True)
    venv.create(str(venv_dir), with_pip=True)

    torch_index = f"https://download.pytorch.org/whl/{cuda_ver}"
    if not run_pip(venv_dir, [
        "install", "torch", "torchvision",
        "--index-url", torch_index,
    ], progress_file, "PyTorch 설치"):
        progress_file.write_text(json.dumps({
            "status": "failed", "error": "PyTorch CUDA 설치 실패",
            "epoch": 0, "total_epochs": 0, "progress": 0,
            "loss": None, "eval_loss": None,
        }, ensure_ascii=False), encoding="utf-8")
        return None

    # Step 4: Install Unsloth (without touching torch)
    update_progress(progress_file, "Unsloth 설치 중...", 4)
    deps = [
        "unsloth", "unsloth_zoo",
        "bitsandbytes", "peft", "trl", "datasets",
        "transformers", "accelerate", "xformers",
        "hf_transfer", "cut_cross_entropy",
    ]
    if not run_pip(venv_dir, [
        "install", "--no-deps", "unsloth", "unsloth_zoo",
    ], progress_file, "Unsloth 코어"):
        progress_file.write_text(json.dumps({
            "status": "failed", "error": "Unsloth 설치 실패",
            "epoch": 0, "total_epochs": 0, "progress": 0,
            "loss": None, "eval_loss": None,
        }, ensure_ascii=False), encoding="utf-8")
        return None

    # Install remaining deps (torch already installed, won't be touched)
    remaining = [d for d in deps if d not in ("unsloth", "unsloth_zoo")]
    run_pip(venv_dir, ["install"] + remaining, progress_file, "의존성 설치")

    # Step 5: Validate
    update_progress(progress_file, "설치 검증 중...", 5)
    if not validate(venv_dir):
        progress_file.write_text(json.dumps({
            "status": "failed",
            "error": "설치 검증 실패. CUDA torch 또는 Unsloth가 제대로 설치되지 않았습니다.",
            "epoch": 0, "total_epochs": 0, "progress": 0,
            "loss": None, "eval_loss": None,
        }, ensure_ascii=False), encoding="utf-8")
        return None

    return venv_python


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--venv-dir", required=True)
    args = parser.parse_args()
    result = setup(Path(args.project_dir), Path(args.venv_dir))
    if result:
        print(str(result))
        sys.exit(0)
    sys.exit(1)
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/setup_train_env.py
git commit -m "feat: setup_train_env.py — 학습 venv 자동 생성/설치/검증"
```

---

## Task 2: train_service.py — setup → train 2단계 실행

**Files:**
- Modify: `backend/services/train_service.py`

- [ ] **Step 1: setup + train 통합**

```python
# 변경점:
# 1. _VENV_PYTHON 하드코딩 제거
# 2. start_training에서 setup_train_env.setup() 먼저 호출
# 3. OS별 venv python 경로 자동 감지

import platform
from scripts.setup_train_env import setup as setup_train_env, get_venv_python

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_VENV_DIR = _BACKEND_DIR / ".train-venv"

def start_training(project_id, config):
    # ... 기존 중복 체크 ...

    project_dir = _DATA_DIR / project_id
    
    # Setup + Train을 하나의 subprocess로
    # train_lora.py가 시작 시 setup을 호출하도록 변경
    venv_python = get_venv_python(_VENV_DIR)
    
    # venv가 없으면 시스템 python으로 setup 먼저 실행
    if not venv_python.exists():
        train_python = sys.executable
    else:
        train_python = str(venv_python)
    
    proc = subprocess.Popen(
        [train_python, "-u",
         str(_SCRIPTS_DIR / "train_lora.py"),
         "--config", str(config_path)],
    )
```

- [ ] **Step 2: train_lora.py 시작 부분에서 setup 호출**

train_lora.py의 기존 Unsloth 설치 코드를 setup_train_env.setup()으로 교체.
setup이 venv python 경로를 반환하면, 현재 프로세스가 시스템 python이면 venv python으로 자기 자신을 재실행.

- [ ] **Step 3: Commit**

```bash
git add backend/services/train_service.py backend/scripts/train_lora.py
git commit -m "feat: 학습 시작 시 자동 환경 구축 — setup → train 2단계"
```

---

## Task 3: 시작.sh — Linux/Mac 지원

**Files:**
- Create: `시작.sh`

- [ ] **Step 1: Linux/Mac용 시작 스크립트 작성**

```bash
#!/bin/bash
set -e

echo ""
echo "=== StoryForge v0.3 ==="
echo ""

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Python
echo "[1/5] Python..."
if [ -f "$ROOT/python-embedded/bin/python" ]; then
    PYTHON="$ROOT/python-embedded/bin/python"
    echo "  OK - embedded"
elif command -v python3 &>/dev/null; then
    PYTHON=python3
    echo "  OK - system (python3)"
elif command -v python &>/dev/null; then
    PYTHON=python
    echo "  OK - system (python)"
else
    echo "  ERROR - no python"
    exit 1
fi

# GPU
echo "[2/5] GPU..."
if command -v nvidia-smi &>/dev/null; then
    echo "  OK - $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"
else
    echo "  WARN - no NVIDIA GPU (training unavailable)"
fi

# Ollama
echo "[3/5] Ollama..."
if ! command -v ollama &>/dev/null; then
    echo "  installing..."
    curl -fsSL https://ollama.com/install.sh | sh
    if ! command -v ollama &>/dev/null; then
        echo "  ERROR - install failed. Visit https://ollama.com"
        exit 1
    fi
fi
echo "  OK"

# Ollama server
echo "[4/5] Ollama server..."
if ! pgrep -x "ollama" >/dev/null 2>&1; then
    ollama serve &>/dev/null &
    sleep 3
fi
if ! ollama list 2>/dev/null | grep -qi "gemma4"; then
    echo "  pulling gemma4..."
    ollama pull gemma4
fi
echo "  OK"

# Backend
echo "[5/5] Starting server..."
cd "$ROOT/backend"
$PYTHON -m pip install -r requirements.txt -q 2>/dev/null
$PYTHON main.py &
SERVER_PID=$!
sleep 3

echo ""
echo "=== StoryForge ready ==="
echo "http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1'):8000"
echo ""
echo "Press Ctrl+C to stop"

# Open browser (if desktop)
if command -v xdg-open &>/dev/null; then
    xdg-open "http://127.0.0.1:8000" 2>/dev/null || true
fi

wait $SERVER_PID
```

- [ ] **Step 2: 실행 권한**

```bash
chmod +x 시작.sh
```

- [ ] **Step 3: Commit**

```bash
git add 시작.sh
git commit -m "feat: 시작.sh — Linux/Mac 원클릭 시작 스크립트"
```

---

## Task 4: train_service.py — OS별 venv 경로 자동 감지

**Files:**
- Modify: `backend/services/train_service.py`

- [ ] **Step 1: platform 기반 경로 분기**

```python
import platform

def _get_venv_python() -> Path:
    venv_dir = Path(__file__).resolve().parent.parent / ".train-venv"
    if platform.system() == "Windows":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"
```

기존 `_VENV_PYTHON` 하드코딩 제거, `_get_venv_python()` 호출로 교체.

- [ ] **Step 2: Commit**

```bash
git add backend/services/train_service.py
git commit -m "fix: venv python 경로 OS 자동 감지 (Windows/Linux/Mac)"
```

---

## Task 5: 학습 탭 UI — 상태 메시지 수정

**Files:**
- Modify: `frontend/src/components/train/TrainTab.tsx`

- [ ] **Step 1: 상태 메시지 매핑 수정**

기존 STATUS_MSG를 확장하고, `setup` 상태 + `detail` 필드 표시:

```typescript
const STATUS_MSG: Record<string, string> = {
  idle: '',
  setup: '',  // detail 필드에서 가져옴
  installing: '패키지 설치 중...',
  loading_model: '모델 다운로드 중...',
  training: '학습 중...',
  converting: 'GGUF 변환 중...',
  registering: 'Ollama에 등록 중...',
  completed: '학습 완료! 모델이 등록되었습니다.',
  failed: '학습 실패',
};
```

진행률 표시 부분에서:
```typescript
// setup 상태일 때
if (progress.status === 'setup') {
    statusText = progress.detail || '환경 설정 중...';
    progressPercent = (progress.setup_step / progress.setup_total) * 100;
}
// training 상태일 때 step 정보도 표시
if (progress.status === 'training' && progress.loss) {
    statusText = `학습 중... (loss: ${progress.loss.toFixed(4)})`;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/train/TrainTab.tsx
git commit -m "fix: 학습 탭 상태 메시지 — setup/training Phase별 정확한 표시"
```

---

## Task 6: 프로젝트 삭제 API + UI

**Files:**
- Modify: `backend/routers/collect.py`
- Modify: `frontend/src/components/Sidebar.tsx` (또는 프로젝트 관리 컴포넌트)

- [ ] **Step 1: DELETE 엔드포인트 추가**

```python
@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    projects = _load_projects()
    projects = [p for p in projects if p["id"] != project_id]
    _save_projects(projects)
    
    # Delete project data directory
    project_dir = DATA_DIR / project_id
    if project_dir.exists():
        import shutil
        shutil.rmtree(project_dir, ignore_errors=True)
    
    return {"status": "deleted"}
```

- [ ] **Step 2: 프론트엔드에 삭제 버튼**

Sidebar의 프로젝트 목록에서 각 프로젝트 옆에 삭제 버튼 (확인 다이얼로그 포함).

- [ ] **Step 3: Commit**

```bash
git add backend/routers/collect.py frontend/src/components/Sidebar.tsx
git commit -m "feat: 프로젝트 삭제 API + UI"
```

---

## Task 7: health check 로그 필터링

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: uvicorn access log에서 /api/health 필터**

이미 코드 작성됨 (이전 커밋). 적용 확인만.

- [ ] **Step 2: Commit (필요시)**

---

## Task 8: 수집 에러 영상 UI 표시

**Files:**
- Modify: `frontend/src/components/collect/VideoList.tsx`

- [ ] **Step 1: 에러 상태 영상 시각적 구분**

VideoList에서 `status === 'error'`인 영상을 빨간 테두리 + 에러 메시지 표시:

```typescript
<div className={`... ${video.status === 'error' ? 'border-red-500/50 bg-red-900/10' : ''}`}>
    {video.title}
    {video.error && (
        <span className="text-xs text-red-400 block">{video.error}</span>
    )}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/collect/VideoList.tsx
git commit -m "feat: 수집 에러 영상 UI 표시 — 빨간 테두리 + 에러 메시지"
```
