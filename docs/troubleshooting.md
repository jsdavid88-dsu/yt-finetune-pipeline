# StoryForge 트러블슈팅 로그

실제 개발/배포 과정에서 겪은 오류와 해결 과정 기록.

---

## 1. Unsloth 설치

### 1-1. pip install unsloth이 PyTorch CUDA를 CPU로 덮어씀
- **증상**: `torch.cuda.is_available()` → `False`
- **원인**: `pip install unsloth`이 의존성 해석 중 torch를 CPU 버전으로 교체
- **해결**: unsloth 설치 후 CUDA torch 강제 재설치
  ```
  pip install unsloth
  pip install --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cu128
  ```
- **시스템 반영**: `setup_train_env.py`에 이 순서 자동화

### 1-2. triton 버전 충돌
- **증상**: `cannot import name 'AttrsDescriptor' from 'triton.compiler.compiler'`
- **원인**: unsloth가 설치한 triton-windows 버전이 torch 버전과 안 맞음
- **해결**: `pip install triton-windows==3.2.0.post19` (torch 2.6 호환)
- **참고**: venv 격리 후에는 unsloth가 맞는 버전 설치하므로 문제 없음

### 1-3. pip install이 1시간 넘게 멈춤
- **증상**: `status: "installing"` 에서 진행 안 됨
- **원인**: Unsloth 의존성 20개+ 해석에 시간 소요, subprocess 출력 안 보임
- **해결**: 수동으로 `pip install unsloth` 실행, venv 격리로 전환

---

## 2. 학습 (Training)

### 2-1. `Unsloth cannot find any torch accelerator`
- **증상**: GPU 있는데 "You need a GPU" 에러
- **원인**: 1-1의 CPU torch 문제
- **해결**: CUDA torch 재설치

### 2-2. `Unsloth: No or negligible GPU memory available for fused cross entropy`
- **증상**: 모델 로드 후 학습 시작 직전 실패
- **원인**: Unsloth 내부에서 `torch.cuda.mem_get_info()`로 VRAM 체크 시 여유 메모리가 0으로 감지
- **해결**: 환경변수 `UNSLOTH_CE_LOSS_TARGET_GB=2` 설정
- **시스템 반영**: `train_lora.py` 최상단에 `os.environ["UNSLOTH_CE_LOSS_TARGET_GB"] = "2"`

### 2-3. `ProgressCallback.on_epoch_end() got unexpected argument`
- **증상**: epoch 끝날 때 에러로 학습 중단
- **원인**: transformers 5.x에서 `on_epoch_end` 시그니처에 `control` 인자 추가됨
- **해결**: `def on_epoch_end(self, _args, state, control=None, **kwargs)`

### 2-4. `SFTConfig.__init__() got unexpected keyword argument 'push_to_hub_token'`
- **증상**: 학습 시작 시 에러
- **원인**: trl 버전 호환성 (1.0.0 vs 0.23.0)
- **해결**: 최신 trl 사용, Unsloth가 내부적으로 처리

### 2-5. RTX 5090 (CUDA 13.2) — PyTorch cu126 호환 안 됨
- **증상**: `NVIDIA GeForce RTX 5090 with CUDA capability sm_120 is not compatible`
- **원인**: RTX 5090은 sm_120, PyTorch cu126은 sm_90까지만 지원
- **해결**: `pip install torch --index-url https://download.pytorch.org/whl/cu128`
- **시스템 반영**: `setup_train_env.py`에서 CUDA 13.x → cu128 매핑

### 2-6. RTX 4090 (24GB) — 8B 모델 학습 느림 (step당 429초)
- **증상**: 26 step에 ~3시간
- **원인**: max_seq_length=4096 + batch_size=2로 VRAM 24GB 거의 풀 사용
- **참고**: seq_length 2048로 줄이면 속도 향상, 5090에서는 여유있음

### 2-7. Gemma 4 26B MoE — OOM
- **증상**: `Some modules are dispatched on the CPU or the disk`
- **원인**: 26B MoE의 전문가 레이어가 3D 텐서라 bitsandbytes 4bit 양자화 불가, 실제 VRAM ~42.5GB 필요
- **해결**: 26B MoE는 24GB/32GB에서 QLoRA 불가. 8B(E4B) 사용 또는 H100(80GB) 필요

### 2-8. 학습 loss가 17.8로 매우 높음
- **증상**: 첫 step loss 17.8
- **원인**: 정상 — 첫 step은 원래 높고, 학습 진행되면서 하락 (17.8 → 9.6 → 7.3 → 3.x)
- **참고**: 최종 loss 2~3이면 양호

---

## 3. GGUF 변환 + Ollama 등록

### 3-1. `config.json does not exist inside` 에러
- **증상**: `save_pretrained_gguf()` 실패
- **원인**: LoRA `save_pretrained()`는 adapter만 저장, 베이스 모델 config.json 미포함
- **해결**: HuggingFace 캐시에서 config.json 복사
  ```python
  from huggingface_hub import hf_hub_download
  shutil.copy2(hf_hub_download(base_model, "config.json"), lora_dir / "config.json")
  ```

### 3-2. 4bit merge 텐서 크기 불일치
- **증상**: `The size of tensor a (294912) must match the size of tensor b (768)`
- **원인**: Gemma4의 `Gemma4ClippableLinear` 레이어가 4bit merge 시 차원 불일치
- **해결**: 4bit merge 대신 16bit로 로드 후 merge, 또는 `save_pretrained_gguf()` 직접 호출 (내부 merge 사용)
- **참고**: PEFT issue #2321, 수동 `merge_and_unload()` 호출하지 말 것

### 3-3. llama.cpp가 Gemma4ForConditionalGeneration 미지원
- **증상**: `convert_hf_to_gguf.py` 실행 시 `Unrecognized model` 에러
- **원인**: llama.cpp 버전이 오래되어 Gemma4 아키텍처 미지원
- **해결**: llama.cpp 최신 버전 필요 (PR #21428 — sliding_window_pattern 수정 포함)
- **대안**: Ollama의 safetensors import 사용

### 3-4. Ollama `ADAPTER .` — `no Modelfile or safetensors files found`
- **증상**: Ollama가 LoRA adapter를 못 읽음
- **원인**: `ADAPTER .`이 현재 디렉토리가 아닌 Modelfile 위치 기준으로 해석
- **해결**: 절대경로 사용 `ADAPTER D:\path\to\lora\`

### 3-5. Ollama `--experimental` — `gemma4:latest is not a supported model directory`
- **증상**: `FROM gemma4` 경로를 로컬 디렉토리로 해석
- **원인**: `--experimental` 모드에서 `FROM`을 Ollama 모델이 아닌 로컬 경로로 인식
- **해결**: merged full model의 safetensors 디렉토리를 `FROM`에 지정

### 3-6. `Gemma4ClippableLinear is not supported` (PEFT merge)
- **증상**: `PeftModel.from_pretrained()` 시 에러
- **원인**: `unsloth/gemma-4-E4B-it-unsloth-bnb-4bit` 모델의 내부 레이어가 커스텀 타입
- **해결**: bnb-4bit 모델 대신 원본 모델(`unsloth/gemma-4-E4B-it`)을 16bit로 로드

### 3-7. CMake 미설치 — GGUF 변환 실패
- **증상**: `Failed to install Kitware.CMake via winget`
- **해결**: `winget install Kitware.CMake`, cmd 새로 열어야 PATH 반영

### 3-8. 5090 PC에서 github.com 간헐적 접속 불가
- **증상**: `Could not resolve host: github.com`
- **원인**: 학교 네트워크 DNS 불안정
- **해결**: 2~3번 재시도하면 됨, 영구 해결은 DNS를 8.8.8.8로 변경

---

## 4. Ollama 등록 — 최종 권장 방법 (2026-04-07 기준)

Gemma 4 LoRA 학습 후 Ollama 등록 방법 (우선순위):

### 방법 1: Ollama ADAPTER import (가장 간단)
```
# Modelfile
FROM gemma4
ADAPTER /absolute/path/to/lora/adapter/directory/
```
```bash
ollama create storyforge-myproject -f Modelfile
```
- LoRA adapter 폴더에 `adapter_model.safetensors` + `adapter_config.json` 필요
- Ollama가 Gemma4 adapter를 지원하는지 버전에 따라 다름

### 방법 2: Full merge → Ollama import
```python
# 원본 모델(non-bnb)을 bfloat16으로 로드
model = AutoModelForCausalLM.from_pretrained("unsloth/gemma-4-E4B-it", dtype=torch.bfloat16)
model = PeftModel.from_pretrained(model, "path/to/lora")
model = model.merge_and_unload()
model.save_pretrained("merged_full")
```
```
# Modelfile
FROM /path/to/merged_full/
```
```bash
ollama create storyforge-myproject -f Modelfile --experimental -q q4_K_M
```

### 방법 3: Unsloth save_pretrained_gguf (직접)
```python
# 학습 직후, merge 없이 바로 호출
model.save_pretrained_gguf("output_dir", tokenizer, quantization_method="q4_k_m")
```
- config.json이 output_dir에 있어야 함
- llama.cpp 최신 버전 필요 (Gemma4 지원)

---

## 5. 시작.bat / 환경 이슈

### 5-1. 더블클릭하면 바로 꺼짐
- **원인**: `echo [OK]`의 대괄호가 bat에서 특수문자, 또는 `start /B`로 백그라운드 실행 후 에러 시 즉시 종료
- **해결**: 서버를 포그라운드로 실행 (`"%PYTHON%" main.py`), 에러 시에도 `pause`로 대기

### 5-2. `[OK]은(는) 내부 또는 외부 명령이 아닙니다`
- **원인**: bat에서 `echo [OK]`의 `[` 특수문자 해석
- **해결**: 대괄호 제거, ASCII 텍스트만 사용

### 5-3. `if` 블록 안의 `goto` — bat 동작 불안정
- **원인**: Windows cmd의 `if ( ... goto ... )` 파싱 버그
- **해결**: `goto` 제거, `if not defined` 패턴 사용

### 5-4. 한글 인코딩 — `chcp 65001` 후에도 깨짐
- **증상**: 유니코드 문자가 bat에서 명령어로 인식
- **해결**: bat 파일 내용을 ASCII only로, 한글 최소화

### 5-5. `frontend/dist/` 미포함 — `Directory does not exist`
- **증상**: 프론트엔드 빌드 파일이 없어서 서버 시작 실패
- **원인**: `.gitignore`에 `dist/` 포함
- **해결**: `.gitignore`에서 `frontend/dist/` 제거, 빌드 결과물을 git에 포함

---

## 6. 수집 (Collection)

### 6-1. YouTube rate limit
- **증상**: `rate-limited by YouTube for up to an hour`
- **원인**: 1,299개 영상 연속 요청
- **해결**: 영상 간 2초 딜레이, rate limit 감지 시 60초 대기 + 재시도
- **시스템 반영**: `collect.py`에 `_COLLECT_DELAY = 2.0`, `_RATE_LIMIT_WAIT = 60`

### 6-2. 수집 데이터 유실
- **증상**: 중간에 에러나면 그때까지 수집한 데이터 전부 날아감
- **원인**: 전체 완료 후 한번에 저장하는 구조
- **해결**: 영상 하나 완료할 때마다 즉시 `raw.txt` append + `videos.json` 저장
- **시스템 반영**: incremental save 구현

---

## 7. 프론트엔드 UI

### 7-1. 생성 탭 진입 시 `o.map is not a function` 크래시
- **원인**: `generateGetModels()` API가 `{models: [...]}` 반환하는데 `GenerateModel[]`로 타입 지정
- **해결**: `const data: any = await request(...)` + `data?.models || []` 파싱

### 7-2. 학습 탭 진입 시 UI 전체 검은 화면
- **원인**: `train_progress.json`이 빈 파일/깨진 JSON → `JSON.parse` 에러 → React 크래시
- **해결**: JSON 파싱 실패 시 `{"status": "idle"}` 반환, 파일 삭제 안 함 (사용 중일 수 있으므로)

### 7-3. loss 차트가 화면 밖으로 나감
- **원인**: 초반 loss 17.8이 나중 loss 3.x 대비 너무 커서 스케일 초과
- **해결**: 최근 50개만 표시, min/max 기준 정규화

### 7-4. 학습 상태 "데이터 수집중..." 표시
- **원인**: 상태 메시지 매핑이 안 되어 기본 텍스트 표시
- **해결**: `STATUS_LABELS` 매핑에 setup/installing/loading_model 등 추가
