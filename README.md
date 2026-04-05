# StoryForge — YouTube to LoRA Fine-tune Pipeline

유튜브 영상에서 텍스트를 자동 추출하고, 로컬 LLM을 LoRA 파인튜닝하여 긴 스토리를 생성하는 원스톱 GUI 도구.

## 빠른 시작

**`시작.bat` 더블클릭** — 끝.

Python, Ollama, 모델 다운로드까지 전부 자동. 브라우저에서 `http://127.0.0.1:8000` 열림.

### 사전 요구사항

- Windows 10+
- Python 3.10+ (또는 `python-embedded/` 폴더에 내장)
- 인터넷 (첫 실행 시 Ollama + gemma4 모델 다운로드)
- NVIDIA GPU 8GB+ VRAM (학습용, 없어도 수집/정제/생성 가능)

## 사용 흐름

### 1. 수집 탭

유튜브 영상/재생목록에서 자막 텍스트를 추출.

- URL 입력 (단일/재생목록/여러 개 줄바꿈)
- **미리보기**: 재생목록 영상 목록 + 조회수 + 길이 확인
- **조회수 필터**: 상위 10% / 25% / 50% / 전체 선택
- 자막 없는 영상은 VibeVoice-ASR로 자동 음성 전사 (STT)
- 중복 자동 감지 — 이미 수집한 영상은 스킵

### 2. 정제 탭

수집된 텍스트를 학습 데이터로 변환. "자동 처리" 버튼 하나로 전체 파이프라인 실행:

1. **청킹**: 텍스트를 ~1,500자 단위로 분리
2. **STT 오타 교정** (Pass 1): gemma4가 전사 오류 자동 교정
3. **상세 분석** (Pass 2): 각 청크의 장르/핵심사건/감정흐름/떡밥/서사기법 분석
4. **4-Task 학습 데이터 생성**:
   - Task 1: 아웃라인 기획서 (에피소드 구조)
   - Task 2: 장면 확장 + 맥락 (이전 흐름 포함)
   - Task 3: 연속 집필 (앞 장면에서 이어쓰기)
   - Task 4: 스타일 (장르/감정/기법 조합)
5. **비내용 필터링**: 방송 인트로/아웃트로/광고 자동 제외

출력: `dataset.jsonl` (Alpaca 포맷), `outlines.json`, `chunks.json`

### 3. 학습 탭

Unsloth QLoRA로 파인튜닝.

- 베이스 모델 선택 (Gemma4, LLaMA 등)
- 하이퍼파라미터 설정 (기본값 제공)
- 실시간 진행률 + loss 표시
- 완료 시 GGUF 변환 → Ollama 자동 등록

### 4. 생성 탭

두 가지 모드:

**채팅 모드**: Ollama 모델과 자유 대화 + 배치 생성

**스크립트 모드**: 학습된 모델로 1시간 분량 스토리 생성
1. 장르 + 주제 입력
2. **아웃라인 생성** → 확인/편집 가능
3. 승인 후 **장면별 순차 생성** (실시간 진행 표시)
4. 개별 장면 **"다시 쓰기"** 가능
5. 전체 스크립트 내보내기 (.txt)

## 프로젝트 구조

```
backend/
  main.py                    # FastAPI 엔트리포인트
  routers/
    collect.py               # 수집 API
    refine.py                # 정제 API (2-pass + 4-Task)
    train.py                 # 학습 API
    generate.py              # 생성 API (채팅 + 스크립트)
  services/
    youtube.py               # yt-dlp 래퍼
    refine_service.py        # 교정/분석/JSONL 빌더
    story_service.py         # 연쇄 생성 파이프라인
    train_service.py         # 학습 프로세스 관리
    ollama.py                # Ollama API 클라이언트
    stt_service.py           # VibeVoice-ASR STT
  scripts/
    train_lora.py            # Unsloth QLoRA 학습 스크립트
  models/
    schemas.py               # Pydantic 스키마
  data/                      # 프로젝트 데이터 저장
    projects.json
    {project_id}/
      raw.txt                # 원본 텍스트
      videos.json            # 영상 메타 (조회수/길이 포함)
      chunks.json            # 교정 + 분석 결과
      outlines.json          # 에피소드 아웃라인
      dataset.jsonl          # 학습용 4-Task 데이터

frontend/
  src/components/
    collect/                 # 수집 탭
    refine/                  # 정제 탭
    train/                   # 학습 탭
    generate/                # 생성 탭 (채팅 + 스크립트)

시작.bat                     # 원클릭 실행
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | FastAPI, Python 3.12 |
| Frontend | React 18, Vite, Tailwind CSS, TypeScript |
| 수집 | yt-dlp, ffmpeg |
| STT | VibeVoice-ASR |
| 태깅/분석 | Ollama API (gemma4) |
| 학습 | Unsloth + QLoRA, max_seq_length 4096 |
| 변환 | Unsloth 내장 GGUF 변환 |
| 추론 | Ollama (베이스 + LoRA adapter) |

## 설계 문서

- `docs/superpowers/specs/` — 설계 명세
- `docs/superpowers/plans/` — 구현 계획
