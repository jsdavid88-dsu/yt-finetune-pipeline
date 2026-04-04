# StoryForge 전면 개편 설계 문서

## 개요

StoryForge는 유튜브 영상에서 텍스트를 추출하고, 로컬 LLM을 LoRA 파인튜닝하여 콘텐츠를 생성하는 범용 로컬 파이프라인이다. 컴퓨터에 아무것도 설치되어 있지 않은 사용자도 압축 풀고 더블클릭 하나로 전체 파이프라인을 사용할 수 있어야 한다.

## 설계 원칙

- **모든 LLM 작업은 로컬** — Ollama 기반, 토큰 비용 0원
- **사용자가 직접 설치하는 건 없다** — 모든 의존성 자동 다운로드/설치
- **범용** — 프로젝트 프리셋만 바꾸면 막장드라마든 판타지든 기술문서든 동일 흐름
- **GUI에서 클릭만으로 전체 파이프라인 실행**

## 현재 상태

### 동작하는 것
- 수집: YouTube URL → 자막 추출 (단건)
- 정제: 텍스트 쪼개기 → Ollama(gemma4) 태깅 → JSONL 생성
- 생성: Ollama 기본 모델 채팅

### 버그
- **수집 덮어쓰기**: URL을 여러 번 넣으면 `raw.txt`/`videos.json`이 매번 덮어써져서 이전 데이터 소실
- **에러 영상 기록 없음**: 수집 실패한 영상이 뭔지 알 수 없음
- **SSE 스트리밍 깨짐**: 백엔드는 `{"token": ...}`으로 보내는데 프론트는 `content`/`text`로 읽음 → 채팅 스트리밍 안 됨
- **인메모리 job store 메모리 누수**: 완료된 job이 정리되지 않아 장시간 사용 시 메모리 증가
- **정제 자동처리가 프리셋 무시**: RefineTab에서 chunk_size=1500, model='gemma4' 하드코딩

### 미구현
- 자막 없는 영상 처리 (STT/OCR)
- 프로젝트 프리셋 시스템 (태깅 프롬프트 커스텀)
- LoRA 학습 (Unsloth + QLoRA) — 현재 완전 placeholder
- GGUF 변환 및 Ollama 모델 등록
- 학습된 모델로 생성
- 배포 패키징 (원클릭 설치)

---

## Phase A+B: 버그 수정 + 정제 보강

### A1. 수집 덮어쓰기 버그 수정

**문제**: `collect.py`의 `_run_collect_job()`이 `raw.txt`와 `videos.json`을 매번 `write_text()`로 덮어씀.

**해결**:
- `raw.txt`: 기존 내용 읽어서 새 영상 텍스트를 append
- `videos.json`: 기존 리스트 로드 후 새 영상 추가 (video_id 기준 중복 체크)
- 이미 수집한 영상은 스킵
- **동시 수집 방지**: 같은 프로젝트에 수집 job이 이미 실행 중이면 새 요청 거부 (409 Conflict)

### A2-1. SSE 스트리밍 버그 수정

**문제**: `generate.py`가 `{"token": ...}` 키로 SSE 전송, 프론트 `api.ts`가 `content`/`text`로 파싱 → 채팅 스트리밍 안 됨.

**해결**: 프론트/백엔드 SSE 키를 통일.

### A2-2. 인메모리 job store 정리

**해결**: 완료된 job은 1시간 후 자동 삭제. 최대 100개 유지.

### A2. 수집 에러 기록

**해결**: 에러난 영상도 `videos.json`에 `status: "error"`, `error: "사유"` 포함하여 기록. UI에서 어떤 영상이 실패했는지 표시.

### A3. VibeVoice-ASR STT 추가

**목적**: 자막 없는 영상도 수집 가능하게.

**흐름**:
```
자막 추출 시도
  ├── 자막 있음 → 기존 로직 (yt-dlp 자막 다운로드)
  └── 자막 없음 → Route B: STT
      ├── ffmpeg로 영상에서 오디오 추출 (wav/mp3)
      ├── VibeVoice-ASR 모델로 음성 전사
      └── 전사 텍스트를 raw.txt에 추가
```

**VibeVoice-ASR 자동 설치**:
- 첫 STT 사용 시 HuggingFace에서 모델 자동 다운로드
- 다운로드 진행률 UI에 표시: "음성 인식 모델 다운로드 중... (최초 1회)"
- 이후 로컬 캐시에서 로드

**선택 이유 (vs Whisper)**:
- 60분 영상 한 번에 처리 (Whisper는 30초 단위 슬라이싱 필요)
- 화자 분리 + 타임스탬프 자동 포함
- MIT 라이선스, HuggingFace transformers 공식 지원

**OCR은 이후 단계로 미룸** — 화면 하드코딩 자막만 있는 특수 케이스용, 구현 복잡도 높음.

### B1. 프로젝트 프리셋 시스템

**목적**: 프로젝트 생성 시 용도별 설정을 프리셋으로 제공.

**프리셋 구성**:
```json
{
  "name": "막장드라마",
  "chunk_size": 1500,
  "tag_prompt": "이 텍스트의 장르, 주제, 분위기, 장면유형을 분류해줘",
  "tag_model": "gemma4",
  "jsonl_template": "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘",
  "base_model": "gemma4",
  "generation_prompt": "다음 설정으로 이야기를 써줘: {입력}"
}
```

**기본 프리셋**: 막장드라마, 판타지소설, 기술문서, 일반(커스텀)
**커스텀**: 사용자가 태깅 프롬프트, 템플릿 등 직접 수정 가능

### B2. 태깅 안정화

- 태깅 모델 선택 가능 (gemma4 하드코딩 → 프리셋에서 설정)
- 태깅 실패 시 최대 3회 재시도
- 정제 진행률 UI 실시간 업데이트 (현재도 있지만 안정화)

---

## Phase C: 학습 기능

### C1. Unsloth QLoRA 학습

**흐름**:
1. 사용자: 학습 탭에서 "학습 시작" 클릭
2. 시스템: GPU 존재 여부 확인 → 없으면 안내 메시지
3. 시스템: Unsloth 패키지 미설치 시 자동 설치 (pip)
4. 백엔드: 별도 프로세스로 학습 실행 (서버 블로킹 방지)
5. 프론트: 진행률(epoch, loss) 실시간 폴링 표시

**학습 설정 UI**:
- 베이스 모델 선택 (드롭다운): Gemma4, LLaMA 3, Mistral 등
- 하이퍼파라미터: epoch, learning rate, batch size, LoRA rank 등
- **기본값 제공** — 모르면 그냥 시작 가능

**학습 프로세스**:
- `subprocess`로 학습 스크립트 실행 (메인 서버와 분리)
- 학습 스크립트가 진행 상황을 JSON 파일로 기록
- 백엔드 API가 이 파일을 읽어서 프론트에 전달

### C1-1. 학습 크래시 복구

- 학습 스크립트는 매 epoch마다 체크포인트 저장
- 학습 중 프로세스 죽으면 → "학습이 중단되었습니다. 이어서 하시겠습니까?" 안내
- 이어하기 선택 시 마지막 체크포인트부터 재개

### C2. GGUF 변환 + Ollama 등록

**Unsloth 내장 기능 활용**: Unsloth `save_pretrained_gguf()` + `push_to_ollama()` 메서드로 변환+등록 한 번에 처리. 별도 llama.cpp 설치 불필요.

**학습 완료 후 자동 실행**:
1. Unsloth `save_pretrained()` → LoRA adapter (safetensors)
2. Unsloth `save_pretrained_gguf()` → LoRA adapter.gguf (llama.cpp 내장)
3. Ollama Modelfile 자동 생성:
   ```
   FROM gemma4
   ADAPTER ./adapters/project-name.gguf
   ```
4. `ollama create project-name -f Modelfile` 실행
5. 생성 탭 모델 목록에 자동 추가

**사용자 경험**: "학습 완료 → 모델이 등록되었습니다" 알림 하나만 보임.

### C3. 학습 탭 UI

- 모델 선택 드롭다운
- 하이퍼파라미터 폼 (기본값 채워짐)
- "학습 시작" 버튼
- 실시간: epoch 진행률 바, loss 그래프
- 완료 시: "Ollama에 등록됨" 상태 표시
- GPU 없음 감지 시: 경고 메시지

---

## Phase D: 배포 패키징

### D1. 배포 패키지 구성

```
📦 StoryForge.zip (~300MB, 학습 의존성 제외)
├── 시작.bat                    ← 유일한 진입점
├── python-embedded/            ← Python 내장 (설치 불필요)
│   ├── python.exe
│   └── Lib/site-packages/      ← 필요 패키지 포함
├── backend/                    ← FastAPI 서버
├── frontend/dist/              ← 빌드된 정적 파일 (Node 불필요)
└── setup/
    └── ollama-installer.exe    ← Ollama 설치파일 내장
```

### D2. 시작.bat 흐름

```
더블클릭
├── 1. Ollama 없음? → setup/ollama-installer.exe 자동 실행
├── 2. Gemma4 없음? → ollama pull gemma4 (첫 실행, ~9.6GB)
├── 3. pip 패키지 누락? → python-embedded로 자동 설치
├── 4. 백엔드 시작 (python-embedded/python.exe backend/main.py)
├── 5. 브라우저 열기 (http://127.0.0.1:8000)
└── 완료
```

**무거운 의존성은 첫 사용 시점에 자동 다운로드** (시작 시 설치하지 않음):
- STT 첫 사용 → VibeVoice-ASR 모델 다운로드 (HuggingFace, 모델 ID: `microsoft/VibeVoice-ASR`)
- 학습 첫 사용 → PyTorch+CUDA + Unsloth 자동 설치 (~3GB, 시간 소요 안내)
- 다운로드 완료 후에는 오프라인 사용 가능

### D3. 요구사항

- **첫 실행**: 인터넷 필요, 10~15분 (Ollama + Gemma4 다운로드)
- **이후**: 오프라인 OK, 5초 시작 (STT/학습 모델 이미 다운로드했으면 오프라인도 가능)
- **최소 사양**: Windows 10+, 16GB RAM
- **학습용**: NVIDIA GPU 8GB VRAM 이상 (없으면 학습만 불가, 나머지 가능)
- **사용자 설치 항목**: 없음

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Backend | FastAPI, Python 3.12 (embedded) |
| Frontend | React 18, Vite, Tailwind CSS, TypeScript |
| 수집 | yt-dlp, ffmpeg |
| STT | VibeVoice-ASR (HuggingFace transformers) |
| 태깅 | Ollama API (Gemma4 등) |
| 학습 | Unsloth + QLoRA |
| 변환 | Unsloth 내장 GGUF 변환 (llama.cpp 별도 설치 불필요) |
| 추론 | Ollama (베이스 + LoRA adapter) |

---

## 구현 순서

| 단계 | 내용 | 의존성 |
|---|---|---|
| A+B (동시) | 수집 버그 fix, STT 추가, 프리셋 시스템, 태깅 안정화 | 없음 |
| C | Unsloth 학습, GGUF 변환, Ollama 등록, 학습 UI | A+B 완료 (정제된 데이터 필요) |
| D | embedded Python, 원클릭 시작.bat, 패키징 | C 완료 (전체 파이프라인 동작 확인 후) |

---

## JSONL 포맷

학습 데이터는 **Alpaca 포맷** 사용 (Unsloth 기본 지원):

```json
{
  "instruction": "장르: 막장로맨스 / 주제: 재산다툼 / 장면: 대결 스타일로 이야기를 써줘",
  "input": "",
  "output": "시어머니가..."
}
```

베이스 모델별 chat template 매핑은 Unsloth가 자동 처리.
