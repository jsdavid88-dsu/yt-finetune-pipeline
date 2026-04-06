# 학습 환경 자동 구축 설계

## 개요

학습 시작 버튼 하나로 venv 생성, CUDA torch 설치, Unsloth 설치, 환경변수 세팅까지 전부 자동 처리. 사용자는 아무것도 몰라도 됨.

## 현재 문제

1. venv 수동 생성 필요
2. `pip install unsloth`이 torch를 CPU 버전으로 덮어씀
3. triton 버전 충돌 (torch 버전과 안 맞음)
4. CUDA 버전에 맞는 torch를 수동으로 재설치해야 함
5. `UNSLOTH_CE_LOSS_TARGET_GB` 환경변수 수동 설정
6. 설치 중 프론트엔드에 진행 상황 안 보임
7. OS별 venv 경로 다름 (Windows: Scripts/python.exe, Linux: bin/python)

## 해결: setup_train_env.py

별도 스크립트로 분리. `train_service.py`가 학습 시작 전에 이 스크립트를 먼저 실행.

### 설치 흐름

```
학습 시작 클릭
    ↓
train_service.py: setup_train_env() 호출
    ↓
Step 1: venv 존재 확인
    ├── 있음 → Step 5로
    └── 없음 → 생성
    ↓
Step 2: CUDA 버전 감지
    nvidia-smi --query-gpu=driver_version --format=csv,noheader
    → CUDA 12.x → cu126
    → CUDA 11.x → cu118
    → 없음 → 에러: "NVIDIA GPU 필요"
    ↓
Step 3: CUDA torch 설치 (torch 먼저, 덮어쓰기 방지)
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu{version}
    ↓
Step 4: Unsloth 설치 (torch 건드리지 않게)
    pip install unsloth --no-deps
    pip install 나머지 의존성 개별 설치 (bitsandbytes, peft, trl, datasets, ...)
    ↓
Step 5: 설치 검증
    venv python으로:
      import torch; assert torch.cuda.is_available()
      import unsloth
    실패 시 → 에러 메시지 + venv 삭제 후 재시도 안내
    ↓
Step 6: 학습 시작 (기존 train_lora.py)
```

### 진행 상황 보고

progress.json에 단계별 상태 기록:

```json
{"status": "setup", "detail": "가상환경 생성 중...", "setup_step": 1, "setup_total": 5}
{"status": "setup", "detail": "CUDA 12.6 감지, PyTorch 설치 중...", "setup_step": 3, "setup_total": 5}
{"status": "setup", "detail": "Unsloth 설치 중 (bitsandbytes)...", "setup_step": 4, "setup_total": 5}
{"status": "setup", "detail": "설치 검증 중...", "setup_step": 5, "setup_total": 5}
{"status": "loading_model", ...}  ← 기존 학습 흐름
```

프론트엔드에서 `status === "setup"`이면 `detail` + `setup_step/setup_total` 프로그레스바 표시.

### 파일 구조

```
backend/
  scripts/
    setup_train_env.py    ← 신규: venv 생성 + 의존성 설치
    train_lora.py          ← 기존: 학습 스크립트 (setup 부분 제거)
  services/
    train_service.py       ← 수정: setup → train 2단계 실행
```

### setup_train_env.py 핵심 로직

```python
VENV_DIR = backend/.train-venv
PROGRESS_FILE = data/{project_id}/train_progress.json

def detect_cuda_version():
    """nvidia-smi에서 CUDA 버전 감지"""
    # "CUDA Version: 12.6" → "cu126"
    # "CUDA Version: 11.8" → "cu118"
    # 없음 → None

def get_venv_python():
    """OS별 venv python 경로"""
    # Windows: .train-venv/Scripts/python.exe
    # Linux/Mac: .train-venv/bin/python

def setup():
    """전체 설치 흐름"""
    
    # Step 1: venv
    if venv 있고 검증 통과:
        return venv_python
    
    venv 생성
    
    # Step 2: CUDA 감지
    cuda_ver = detect_cuda_version()
    if not cuda_ver:
        에러("NVIDIA GPU 필요")
    
    # Step 3: torch 먼저
    pip install torch torchvision --index-url .../whl/{cuda_ver}
    
    # Step 4: unsloth (torch 안 건드리게)
    pip install --no-deps unsloth unsloth_zoo
    pip install bitsandbytes peft trl datasets transformers accelerate xformers ...
    
    # Step 5: 검증
    venv_python -c "import torch; assert torch.cuda.is_available(); from unsloth import FastLanguageModel"
    
    return venv_python
```

### train_service.py 변경

```python
def start_training(project_id, config):
    # 1단계: 환경 설정 (setup_train_env.py)
    proc = Popen([sys.executable, setup_train_env.py, --project-dir, ...])
    # setup이 끝나면 venv python 경로를 stdout으로 반환
    
    # 2단계: 학습 (train_lora.py)
    proc = Popen([venv_python, train_lora.py, --config, ...])
```

또는 `train_lora.py` 시작 부분에서 `setup_train_env.setup()` 호출 후 자기 자신을 venv python으로 재실행.

### train_lora.py 변경

기존 Unsloth 설치 부분 (try/except ImportError → pip install) 제거. setup_train_env.py가 전부 처리하므로.

환경변수 세팅은 유지:
```python
os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"
```

### 프론트엔드 변경

학습 탭 상태 표시:

```typescript
if (progress.status === "setup") {
    // "환경 설정 중 (3/5): Unsloth 설치 중..."
    // 프로그레스바: setup_step / setup_total
}
```

기존 status 매핑에 추가:
```typescript
const STATUS_MSG = {
    setup: progress.detail || "환경 설정 중...",
    installing: "패키지 설치 중...",  // 레거시, setup으로 대체
    loading_model: "모델 로딩 중...",
    training: "학습 중...",
    converting: "GGUF 변환 중...",
    registering: "Ollama 등록 중...",
    completed: "완료!",
    failed: `실패: ${progress.error}`,
};
```

## 변경 범위

| 파일 | 변경 |
|------|------|
| `backend/scripts/setup_train_env.py` | 신규 — venv 생성/의존성 설치/검증 |
| `backend/scripts/train_lora.py` | Unsloth 설치 부분 제거, setup에 위임 |
| `backend/services/train_service.py` | setup → train 2단계 실행, OS별 venv 경로 |
| `frontend/src/components/train/TrainTab.tsx` | setup 상태 표시 UI |

## 테스트 시나리오

1. **첫 실행 (venv 없음)**: 버튼 클릭 → venv 생성 → torch+CUDA → unsloth → 검증 → 학습 시작
2. **두 번째 실행 (venv 있음)**: 버튼 클릭 → 검증 통과 → 바로 학습 시작
3. **다른 PC로 이동**: venv 삭제됨 → 1번과 동일
4. **CUDA 없는 PC**: 에러 메시지 "NVIDIA GPU가 필요합니다"
5. **Linux 서버**: bin/python 경로로 자동 분기
