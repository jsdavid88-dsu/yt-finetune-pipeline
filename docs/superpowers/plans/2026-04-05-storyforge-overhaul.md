# StoryForge 전면 개편 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** StoryForge를 버그 수정하고, VibeVoice STT·프리셋 시스템·LoRA 학습·원클릭 배포를 구현하여 "URL 넣고 버튼 3번 → 나만의 LoRA LLM 완성" 파이프라인을 완성한다.

**Architecture:** FastAPI 백엔드 + React 프론트엔드. 수집→정제→학습→생성 4단계 파이프라인. 모든 LLM 작업은 Ollama(로컬), 학습은 Unsloth QLoRA, STT는 VibeVoice-ASR. 프로젝트별 data 디렉토리에 모든 결과물 저장.

**Tech Stack:** Python 3.12, FastAPI, React 18, TypeScript, Tailwind CSS, Ollama, Unsloth, VibeVoice-ASR, yt-dlp, ffmpeg

**Spec:** `docs/superpowers/specs/2026-04-05-storyforge-overhaul-design.md`

---

## Chunk 1: 버그 수정 (Phase A)

### Task 1: 수집 덮어쓰기 버그 수정

**Files:**
- Modify: `backend/routers/collect.py:66-118` — `_run_collect_job()` 함수
- Modify: `backend/models/schemas.py:30-32` — `SubtitleRoute` enum에 `stt` 추가

**Context:** 현재 `_run_collect_job()`이 `raw.txt`와 `videos.json`을 매번 `write_text()`로 덮어씀. 두 번째 URL 수집 시 첫 번째 데이터 소실됨.

- [ ] **Step 1: `_run_collect_job()`에서 기존 videos.json 로드 + 중복 체크 추가**

`backend/routers/collect.py`의 `_run_collect_job()` 함수에서 line 104 이후 persist 로직을 수정:

```python
# persist collected text to project directory
project_dir = _ensure_project_dir(job.project_id)

# Load existing videos to avoid duplicates
existing_videos: list[dict] = []
videos_path = project_dir / "videos.json"
if videos_path.exists():
    try:
        with open(videos_path, "r", encoding="utf-8") as f:
            existing_videos = json.load(f)
    except (json.JSONDecodeError, IOError):
        existing_videos = []

existing_ids = {v.get("video_id") for v in existing_videos}

# Build new text parts, skipping already-collected videos
new_text_parts: list[str] = []
new_videos: list[dict] = []
for vid in job.videos:
    vid_data = v.model_dump()
    if vid.video_id in existing_ids:
        continue  # skip duplicate
    if vid.text:
        new_text_parts.append(
            f"--- VIDEO: {vid.title} ---\n{vid.text}\n--- END VIDEO ---"
        )
    new_videos.append(vid_data)

# Append to raw.txt
if new_text_parts:
    new_content = "\n\n".join(new_text_parts)
    raw_path = project_dir / "raw.txt"
    if raw_path.exists():
        existing_text = raw_path.read_text(encoding="utf-8")
        if existing_text.strip():
            new_content = existing_text + "\n\n" + new_content
    raw_path.write_text(new_content, encoding="utf-8")

# Merge videos.json
all_videos = existing_videos + new_videos
(project_dir / "videos.json").write_text(
    json.dumps(all_videos, ensure_ascii=False, indent=2), encoding="utf-8"
)
```

- [ ] **Step 2: 동시 수집 방지 — 프로젝트별 락 추가**

`backend/routers/collect.py` 상단에 프로젝트별 실행 중 job 추적:

```python
# Track running jobs per project to prevent concurrent collection
_running_projects: set[str] = set()
```

`start_collection` 엔드포인트에 체크 추가:

```python
@router.post("/start")
async def start_collection(req: CollectRequest):
    projects = _load_projects()
    if not any(p["id"] == req.project_id for p in projects):
        raise HTTPException(status_code=404, detail="Project not found")

    if req.project_id in _running_projects:
        raise HTTPException(status_code=409, detail="이 프로젝트에서 이미 수집이 진행 중입니다.")

    _running_projects.add(req.project_id)
    job = CollectJob(project_id=req.project_id, url=req.url)
    _jobs[job.job_id] = job

    async def _run_and_unlock(j: CollectJob):
        try:
            await _run_collect_job(j)
        finally:
            _running_projects.discard(j.project_id)

    asyncio.create_task(_run_and_unlock(job))
    return {"job_id": job.job_id, "status": job.status}
```

- [ ] **Step 3: `SubtitleRoute` enum에 `stt` 값 추가**

`backend/models/schemas.py` line 30-32:

```python
class SubtitleRoute(str, Enum):
    subtitle = "subtitle"
    ocr = "ocr"
    stt = "stt"
```

- [ ] **Step 4: 수동 테스트 — 같은 프로젝트에 URL 2개 순차 수집**

Run: 백엔드 시작 후 프론트에서 같은 프로젝트에 URL 2개를 순차적으로 수집. `videos.json`에 두 영상 모두 있는지, `raw.txt`에 두 영상 텍스트 모두 포함되어 있는지 확인.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/collect.py backend/models/schemas.py
git commit -m "fix: 수집 시 raw.txt/videos.json 덮어쓰기 → append로 변경, 동시 수집 방지"
```

---

### Task 2: SSE 스트리밍 버그 수정

**Files:**
- Modify: `backend/routers/generate.py:55-65` — SSE 이벤트 키
- Modify: `frontend/src/api.ts:200-220` — SSE 파싱 로직

**Context:** 백엔드가 `{"token": "텍스트"}` 키로 SSE 전송, 프론트가 `parsed.content || parsed.text`로 읽어서 채팅 스트리밍이 안 됨.

- [ ] **Step 1: 백엔드 SSE 키를 `token`에서 `content`로 통일**

`backend/routers/generate.py` — `chat_stream()` 함수 내 SSE 이벤트 생성 부분. 현재 `{"token": chunk}` → `{"content": chunk}`로 변경:

```python
# generate.py의 SSE 전송 부분에서:
# 기존: yield {"data": json.dumps({"token": chunk})}
# 변경:
yield {"data": json.dumps({"content": chunk})}
```

- [ ] **Step 2: 프론트 SSE 파싱이 `content` 키를 읽는지 확인**

`frontend/src/api.ts`의 `generateChatStream` 함수에서 파싱 로직이 `parsed.content`를 읽고 있는지 확인. 이미 `content`를 읽고 있다면 백엔드 수정만으로 충분.

- [ ] **Step 3: 수동 테스트 — 생성 탭에서 채팅 전송 후 스트리밍 확인**

- [ ] **Step 4: Commit**

```bash
git add backend/routers/generate.py frontend/src/api.ts
git commit -m "fix: SSE 스트리밍 키 불일치 수정 (token → content)"
```

---

### Task 3: 인메모리 job store 정리

**Files:**
- Modify: `backend/routers/collect.py` — `_jobs` dict 정리 로직
- Modify: `backend/routers/refine.py` — `_refine_jobs` dict 정리 로직

**Context:** 완료된 job이 메모리에 계속 쌓임. 장시간 사용 시 메모리 누수.

- [ ] **Step 1: job 정리 헬퍼 함수 작성**

`backend/routers/collect.py` 상단에 추가:

```python
import time

_MAX_JOBS = 100
_JOB_TTL = 3600  # 1 hour

def _cleanup_jobs(store: dict[str, Any]) -> None:
    """Remove completed/failed jobs older than TTL, keep max _MAX_JOBS."""
    now = time.time()
    to_remove = []
    for jid, job in store.items():
        if hasattr(job, 'status') and job.status in (JobStatus.completed, JobStatus.failed):
            if hasattr(job, '_finished_at') and now - job._finished_at > _JOB_TTL:
                to_remove.append(jid)
    for jid in to_remove:
        del store[jid]
    # Hard cap
    if len(store) > _MAX_JOBS:
        oldest = sorted(store.keys())[:len(store) - _MAX_JOBS]
        for jid in oldest:
            del store[jid]
```

- [ ] **Step 2: `CollectJob`/`RefineJob`에 `_finished_at` 타임스탬프 기록**

`_run_collect_job()` 완료 시점에:
```python
job._finished_at = time.time()
```

마찬가지로 `_run_auto_process()` 완료 시점에도 추가.

- [ ] **Step 3: 새 job 생성 시 `_cleanup_jobs()` 호출**

`start_collection()`과 `auto_process()` 시작 시:
```python
_cleanup_jobs(_jobs)  # or _cleanup_jobs(_refine_jobs)
```

- [ ] **Step 4: Commit**

```bash
git add backend/routers/collect.py backend/routers/refine.py
git commit -m "fix: 완료된 job 자동 정리 (1시간 TTL, 최대 100개)"
```

---

## Chunk 2: 정제 보강 (Phase B)

### Task 4: 프리셋 시스템 실제 동작

**Files:**
- Modify: `backend/models/schemas.py:65-125` — `ProjectPreset` 스키마 + `DEFAULT_PRESETS` 확장
- Modify: `backend/routers/refine.py:74-78` — auto-process에서 프리셋 설정 읽기
- Modify: `frontend/src/components/refine/RefineTab.tsx:100` — 하드코딩된 chunk_size/model 제거

**Context:** 현재 프리셋이 정의만 되어있고, 정제 시 chunk_size=1500, model='gemma4' 하드코딩. 프리셋 설정이 실제 정제에 반영되어야 함.

- [ ] **Step 1: `ProjectPreset` 스키마에 `tag_model`, `chunk_size` 필드 추가**

`backend/models/schemas.py`에서 `ProjectPreset` 클래스를 확장. 기존 필드에 `tag_model`, `chunk_size` 추가:

```python
class ProjectPreset(BaseModel):
    name: str
    description: str = ""
    tag_prompt: str = "다음 텍스트를 분석하고 반드시 JSON만 응답해. 키: genre, topic, mood, scene_type"
    tag_model: str = "gemma4"
    chunk_size: int = 1500
    jsonl_template: str = "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘"
    base_model: str = "gemma4"
    generation_prompt: str = "다음 설정으로 이야기를 써줘: {입력}"
```

- [ ] **Step 2: `DEFAULT_PRESETS`에 기술문서 프리셋 추가 + 기존 프리셋에 새 필드 반영**

```python
DEFAULT_PRESETS = [
    {
        "name": "막장드라마",
        "description": "막장 드라마/실화사연 스타일",
        "tag_prompt": "이 텍스트의 장르, 주제, 분위기, 장면유형을 분류해줘. 반드시 JSON만 응답. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 1500,
        "jsonl_template": "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘",
        "base_model": "gemma4",
        "generation_prompt": "다음 설정으로 막장 드라마 스타일 이야기를 써줘: {입력}",
    },
    {
        "name": "판타지소설",
        "description": "판타지/이세계 소설 스타일",
        "tag_prompt": "이 텍스트의 장르, 주제, 분위기, 장면유형을 분류해줘. 반드시 JSON만 응답. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 2000,
        "jsonl_template": "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘",
        "base_model": "gemma4",
        "generation_prompt": "다음 설정으로 판타지 소설을 써줘: {입력}",
    },
    {
        "name": "기술문서",
        "description": "기술 블로그/문서 스타일",
        "tag_prompt": "이 텍스트의 주제, 난이도, 기술스택, 문서유형을 분류해줘. 반드시 JSON만 응답. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 2000,
        "jsonl_template": "주제: {topic} / 난이도: {mood} / 유형: {scene_type} 스타일로 기술 문서를 써줘",
        "base_model": "gemma4",
        "generation_prompt": "다음 주제로 기술 문서를 써줘: {입력}",
    },
    {
        "name": "일반",
        "description": "커스텀 용도",
        "tag_prompt": "다음 텍스트를 분석하고 반드시 JSON만 응답해. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 1500,
        "jsonl_template": "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘",
        "base_model": "gemma4",
        "generation_prompt": "다음 에피소드를 이어서 써줘.",
    },
]
```

- [ ] **Step 3: `_run_auto_process()`에서 프리셋 설정 자동 로드**

`backend/routers/refine.py`의 `_run_auto_process()` 함수를 수정하여 프로젝트 프리셋에서 `chunk_size`, `tag_model`, `tag_prompt`를 읽도록:

```python
async def _run_auto_process(
    job: RefineJob,
    chunk_size: int | None = None,
    model: str | None = None,
) -> None:
    # Load preset defaults
    preset = _load_project_preset(job.project_id)
    chunk_size = chunk_size or preset.get("chunk_size", 1500)
    model = model or preset.get("tag_model", "gemma4")
    tag_prompt = preset.get("tag_prompt", None)
    # ... rest of function uses these values
```

- [ ] **Step 4: `tag_chunk()` 함수에 커스텀 프롬프트 지원**

`backend/services/refine_service.py`의 `tag_chunk()`에 `prompt_template` 파라미터 추가:

```python
async def tag_chunk(chunk: str, model: str = "gemma4", prompt_template: str | None = None) -> dict:
    if prompt_template:
        prompt = f"{prompt_template}\n\n텍스트:\n{chunk}"
    else:
        prompt = (
            "다음 텍스트를 분석하고 반드시 JSON만 응답해. "
            "키: genre, topic, mood, scene_type\n\n"
            f"텍스트:\n{chunk}"
        )
    # ... rest unchanged
```

- [ ] **Step 5: 프론트 RefineTab에서 하드코딩 제거**

`frontend/src/components/refine/RefineTab.tsx` line ~100에서 프리셋 값을 API에서 가져오도록:

```typescript
// 기존: chunk_size: 1500, model: 'gemma4' 하드코딩
// 변경: 프리셋에서 읽거나 백엔드에서 자동 적용하므로 프론트는 생략 가능
const res = await refineAutoProcess(project.id);
// chunk_size, model은 백엔드가 프리셋에서 자동으로 읽음
```

`AutoProcessRequest` 백엔드 스키마에서 `chunk_size`와 `model`을 optional로 변경하여, 미입력 시 프리셋 기본값 사용.

- [ ] **Step 6: Commit**

```bash
git add backend/models/schemas.py backend/routers/refine.py backend/services/refine_service.py frontend/src/components/refine/RefineTab.tsx
git commit -m "feat: 프리셋 시스템 실제 동작 — 태깅 모델/프롬프트/chunk_size 프리셋에서 로드"
```

---

### Task 5: 태깅 재시도 로직

**Files:**
- Modify: `backend/services/refine_service.py:81-113` — `tag_chunk()` 함수

- [ ] **Step 1: `tag_chunk()`에 재시도 로직 추가**

```python
async def tag_chunk(chunk: str, model: str = "gemma4", prompt_template: str | None = None, max_retries: int = 3) -> dict:
    last_error = None
    for attempt in range(max_retries):
        try:
            # ... existing Ollama call logic ...
            tags = _extract_json(raw_response)
            if tags:  # Got valid tags
                return {
                    "genre": tags.get("genre", "미분류"),
                    "topic": tags.get("topic", "미분류"),
                    "mood": tags.get("mood", "미분류"),
                    "scene_type": tags.get("scene_type", "미분류"),
                }
        except httpx.ConnectError:
            raise  # Don't retry connection errors
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                await asyncio.sleep(1)  # Brief pause before retry
    return dict(DEFAULT_TAGS)
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/refine_service.py
git commit -m "feat: 태깅 실패 시 최대 3회 재시도"
```

---

### Task 6: VibeVoice-ASR STT 서비스 추가

**Files:**
- Create: `backend/services/stt_service.py` — VibeVoice-ASR 서비스
- Modify: `backend/services/youtube.py:150-161` — `extract_subtitle_for_video()`에 STT 폴백 추가
- Modify: `backend/routers/collect.py` — STT 상태 표시
- Modify: `backend/requirements.txt` — transformers, torch 추가

**Context:** 자막 없는 영상에서 VibeVoice-ASR(microsoft/VibeVoice-ASR)로 음성 전사. 첫 사용 시 모델 자동 다운로드.

- [ ] **Step 1: `backend/services/stt_service.py` 생성**

```python
"""STT service using Microsoft VibeVoice-ASR for subtitle-less videos."""

from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

# Lazy-loaded to avoid importing torch at startup
_model = None
_processor = None

MODEL_ID = "microsoft/VibeVoice-ASR"


def _ensure_model():
    """Load model on first use. Downloads from HuggingFace if not cached."""
    global _model, _processor
    if _model is not None:
        return

    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    _processor = AutoProcessor.from_pretrained(MODEL_ID)
    _model = AutoModelForSpeechSeq2Seq.from_pretrained(
        MODEL_ID,
        torch_dtype=dtype,
    ).to(device)


def _extract_audio(video_url: str, output_path: str) -> bool:
    """Use yt-dlp + ffmpeg to download audio from a YouTube video."""
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "-x",
                "--audio-format", "wav",
                "--audio-quality", "0",
                "-o", output_path,
                video_url,
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )
        return result.returncode == 0
    except Exception:
        return False


def _transcribe_audio(audio_path: str) -> str:
    """Transcribe audio file using VibeVoice-ASR."""
    import torch
    import librosa

    _ensure_model()

    audio, sr = librosa.load(audio_path, sr=16000)
    inputs = _processor(audio, sampling_rate=sr, return_tensors="pt")

    device = next(_model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        generated_ids = _model.generate(**inputs, max_new_tokens=4096)

    transcription = _processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    return transcription


async def transcribe_video(video_url: str, video_id: str) -> Optional[str]:
    """Full pipeline: download audio → transcribe → return text."""
    loop = asyncio.get_event_loop()

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = str(Path(tmpdir) / f"{video_id}.wav")

        # Download audio
        success = await loop.run_in_executor(
            None, _extract_audio, video_url, audio_path
        )
        if not success:
            return None

        # Find the actual file (yt-dlp may add extension)
        actual_files = list(Path(tmpdir).glob(f"{video_id}*"))
        if not actual_files:
            return None
        actual_path = str(actual_files[0])

        # Transcribe
        text = await loop.run_in_executor(
            None, _transcribe_audio, actual_path
        )
        return text
```

- [ ] **Step 2: `youtube.py`의 `extract_subtitle_for_video()`에 STT 폴백 추가**

`backend/services/youtube.py` line 150-161 수정:

```python
async def extract_subtitle_for_video(info: dict) -> tuple[Optional[str], Optional[str]]:
    """Try subtitle first, fallback to STT if no subtitles."""
    # Route A: Subtitles
    pick = _pick_subtitle(info)
    if pick is not None:
        _lang, sub_url = pick
        raw = await download_subtitle_async(sub_url)
        text = _clean_subtitle_text(raw)
        return text, "subtitle"

    # Route B: STT (VibeVoice-ASR)
    video_id = info.get("id", "")
    video_url = info.get("webpage_url") or info.get("url", "")
    if video_url:
        try:
            from services.stt_service import transcribe_video
            text = await transcribe_video(video_url, video_id)
            if text:
                return text, "stt"
        except Exception:
            pass  # STT failed, fall through

    return None, None
```

- [ ] **Step 3: `requirements.txt`에 의존성 추가**

```
transformers>=4.49.0
torch>=2.0.0
librosa>=0.10.0
```

Note: torch는 무거우므로 실제 배포 시에는 첫 사용 시점에 설치하는 방식으로 전환 (Phase D에서 처리).

- [ ] **Step 4: 수동 테스트 — 자막 없는 YouTube 영상으로 수집 테스트**

- [ ] **Step 5: Commit**

```bash
git add backend/services/stt_service.py backend/services/youtube.py backend/requirements.txt
git commit -m "feat: VibeVoice-ASR STT 추가 — 자막 없는 영상 자동 음성 전사"
```

---

## Chunk 3: 학습 기능 (Phase C)

### Task 7: 학습 백엔드 — Unsloth QLoRA 연동

**Files:**
- Create: `backend/services/train_service.py` — 학습 서비스 (subprocess 관리)
- Create: `backend/scripts/train_lora.py` — 실제 학습 스크립트 (Unsloth)
- Modify: `backend/routers/train.py` — placeholder → 실제 학습 API

**Context:** 현재 train.py는 fake progress를 반환하는 placeholder. Unsloth QLoRA로 실제 학습하고 진행률을 리포트해야 함.

- [ ] **Step 1: `backend/scripts/train_lora.py` 생성 — 독립 학습 스크립트**

이 스크립트는 subprocess로 실행됨. 진행 상황을 JSON 파일로 기록.

```python
"""Standalone LoRA training script. Run as subprocess.

Usage: python train_lora.py --config path/to/config.json
"""

import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Path to training config JSON")
    args = parser.parse_args()

    config_path = Path(args.config)
    config = json.loads(config_path.read_text(encoding="utf-8"))

    project_dir = Path(config["project_dir"])
    progress_file = project_dir / "train_progress.json"
    dataset_path = project_dir / "dataset.jsonl"
    output_dir = project_dir / "adapters"
    output_dir.mkdir(parents=True, exist_ok=True)

    base_model = config.get("base_model", "unsloth/gemma-3-4b-it-bnb-4bit")
    num_epochs = config.get("num_epochs", 3)
    learning_rate = config.get("learning_rate", 2e-4)
    batch_size = config.get("batch_size", 4)
    lora_rank = config.get("lora_rank", 16)
    max_seq_length = config.get("max_seq_length", 2048)

    def update_progress(status, epoch=0, total_epochs=0, loss=None, error=None):
        progress = {
            "status": status,
            "epoch": epoch,
            "total_epochs": total_epochs,
            "progress": int(epoch / total_epochs * 100) if total_epochs else 0,
            "loss": loss,
            "error": error,
        }
        progress_file.write_text(json.dumps(progress, ensure_ascii=False), encoding="utf-8")

    try:
        update_progress("installing")

        # Lazy import — auto-installs if needed
        try:
            from unsloth import FastLanguageModel
        except ImportError:
            import subprocess as sp
            sp.check_call([sys.executable, "-m", "pip", "install", "unsloth"])
            from unsloth import FastLanguageModel

        from datasets import load_dataset
        from trl import SFTTrainer
        from transformers import TrainingArguments

        update_progress("loading_model")

        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=base_model,
            max_seq_length=max_seq_length,
            load_in_4bit=True,
        )

        model = FastLanguageModel.get_peft_model(
            model,
            r=lora_rank,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                            "gate_proj", "up_proj", "down_proj"],
            lora_alpha=lora_rank,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
        )

        # Load dataset
        dataset = load_dataset("json", data_files=str(dataset_path), split="train")

        # Format for Alpaca
        alpaca_prompt = """Below is an instruction that describes a task. Write a response that appropriately completes the request.

### Instruction:
{}

### Input:
{}

### Response:
{}"""

        def formatting_func(examples):
            texts = []
            for inst, inp, out in zip(examples["instruction"], examples["input"], examples["output"]):
                text = alpaca_prompt.format(inst, inp, out) + tokenizer.eos_token
                texts.append(text)
            return {"text": texts}

        dataset = dataset.map(formatting_func, batched=True)

        update_progress("training", 0, num_epochs)

        # Custom callback for progress reporting
        from transformers import TrainerCallback

        class ProgressCallback(TrainerCallback):
            def on_epoch_end(self, _args, state, **kwargs):
                current_epoch = int(state.epoch)
                current_loss = state.log_history[-1].get("loss") if state.log_history else None
                update_progress("training", current_epoch, num_epochs, current_loss)

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            dataset_text_field="text",
            max_seq_length=max_seq_length,
            args=TrainingArguments(
                per_device_train_batch_size=batch_size,
                num_train_epochs=num_epochs,
                learning_rate=learning_rate,
                fp16=True,
                logging_steps=1,
                output_dir=str(output_dir / "checkpoints"),
                save_strategy="epoch",
                seed=42,
            ),
            callbacks=[ProgressCallback()],
        )

        trainer.train()

        update_progress("converting", num_epochs, num_epochs)

        # Save LoRA adapter
        model.save_pretrained(str(output_dir / "lora"))
        tokenizer.save_pretrained(str(output_dir / "lora"))

        # Save to GGUF for Ollama
        model.save_pretrained_gguf(
            str(output_dir),
            tokenizer,
            quantization_method="q4_k_m",
        )

        update_progress("registering", num_epochs, num_epochs)

        # Create Ollama Modelfile and register
        project_name = project_dir.name
        gguf_files = list(output_dir.glob("*.gguf"))
        if gguf_files:
            modelfile_path = output_dir / "Modelfile"
            modelfile_path.write_text(
                f"FROM gemma4\nADAPTER {gguf_files[0].name}\n",
                encoding="utf-8",
            )
            import subprocess as sp
            sp.run(
                ["ollama", "create", f"storyforge-{project_name}", "-f", str(modelfile_path)],
                cwd=str(output_dir),
                capture_output=True,
            )

        update_progress("completed", num_epochs, num_epochs)

    except Exception as exc:
        update_progress("failed", error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: `backend/services/train_service.py` 생성 — subprocess 관리**

```python
"""Training service — manages training subprocess lifecycle."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Track running training process per project
_train_processes: dict[str, subprocess.Popen] = {}


def check_gpu() -> dict:
    """Check if NVIDIA GPU is available."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            gpu_info = result.stdout.strip()
            return {"available": True, "info": gpu_info}
    except Exception:
        pass
    return {"available": False, "info": "NVIDIA GPU not detected"}


def start_training(project_id: str, config: dict[str, Any]) -> dict:
    """Start training subprocess for a project."""
    if project_id in _train_processes:
        proc = _train_processes[project_id]
        if proc.poll() is None:  # Still running
            return {"error": "이 프로젝트에서 이미 학습이 진행 중입니다."}

    project_dir = _DATA_DIR / project_id
    dataset_path = project_dir / "dataset.jsonl"
    if not dataset_path.exists():
        return {"error": "dataset.jsonl이 없습니다. 먼저 정제를 완료하세요."}

    # Write config file for subprocess
    config["project_dir"] = str(project_dir)
    config_path = project_dir / "train_config.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

    # Clear previous progress
    progress_path = project_dir / "train_progress.json"
    progress_path.write_text(
        json.dumps({"status": "starting", "progress": 0}),
        encoding="utf-8",
    )

    # Launch subprocess
    proc = subprocess.Popen(
        [sys.executable, str(_SCRIPTS_DIR / "train_lora.py"), "--config", str(config_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    _train_processes[project_id] = proc

    return {"status": "started", "pid": proc.pid}


def get_progress(project_id: str) -> dict:
    """Read training progress from JSON file."""
    progress_path = _DATA_DIR / project_id / "train_progress.json"
    if not progress_path.exists():
        return {"status": "idle", "progress": 0}
    try:
        return json.loads(progress_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, IOError):
        return {"status": "unknown", "progress": 0}


def stop_training(project_id: str) -> dict:
    """Stop a running training process."""
    proc = _train_processes.get(project_id)
    if proc and proc.poll() is None:
        proc.terminate()
        proc.wait(timeout=30)
        return {"status": "stopped"}
    return {"status": "not_running"}
```

- [ ] **Step 3: `backend/routers/train.py` 전면 교체 — 실제 학습 API**

```python
"""Phase 3 - Fine-tuning router with real Unsloth QLoRA training."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from models.schemas import TrainStartRequest
from services.train_service import check_gpu, start_training, get_progress, stop_training

router = APIRouter(prefix="/api/train", tags=["train"])


@router.get("/gpu-check")
async def gpu_check():
    """Check GPU availability before training."""
    return check_gpu()


@router.get("/models")
async def list_models():
    """List available base models for fine-tuning."""
    return [
        {"id": "unsloth/gemma-3-4b-it-bnb-4bit", "name": "Gemma 3 4B (4-bit)", "params": "4B"},
        {"id": "unsloth/llama-3.1-8b-bnb-4bit", "name": "LLaMA 3.1 8B (4-bit)", "params": "8B"},
        {"id": "unsloth/mistral-7b-bnb-4bit", "name": "Mistral 7B (4-bit)", "params": "7B"},
        {"id": "unsloth/Qwen2.5-7B-bnb-4bit", "name": "Qwen2.5 7B (4-bit)", "params": "7B"},
    ]


@router.post("/start")
async def start(req: TrainStartRequest):
    """Start LoRA training for a project."""
    gpu = check_gpu()
    if not gpu["available"]:
        raise HTTPException(
            status_code=400,
            detail="GPU가 감지되지 않습니다. LoRA 학습에는 NVIDIA GPU가 필요합니다.",
        )

    config = {
        "base_model": req.base_model,
        "num_epochs": req.config.get("num_epochs", 3),
        "learning_rate": req.config.get("learning_rate", 2e-4),
        "batch_size": req.config.get("batch_size", 4),
        "lora_rank": req.config.get("lora_rank", 16),
        "max_seq_length": req.config.get("max_seq_length", 2048),
    }
    result = start_training(req.project_id, config)
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.get("/status/{project_id}")
async def status(project_id: str):
    """Get training progress for a project."""
    return get_progress(project_id)


@router.post("/stop/{project_id}")
async def stop(project_id: str):
    """Stop training for a project."""
    return stop_training(project_id)


@router.get("/config")
async def default_config():
    """Return default training configuration."""
    return {
        "num_epochs": 3,
        "learning_rate": 2e-4,
        "batch_size": 4,
        "lora_rank": 16,
        "max_seq_length": 2048,
    }
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/train_lora.py backend/services/train_service.py backend/routers/train.py
git commit -m "feat: Unsloth QLoRA 학습 파이프라인 — subprocess 기반, 실시간 진행률"
```

---

### Task 8: 학습 탭 프론트엔드 리뉴얼

**Files:**
- Modify: `frontend/src/components/train/TrainTab.tsx` — 실제 학습 UI
- Modify: `frontend/src/components/train/TrainConfig.tsx` — 설정 폼 업데이트
- Modify: `frontend/src/api.ts` — 새 API 엔드포인트 연결
- Modify: `frontend/src/types.ts` — 타입 업데이트

**Context:** 현재 TrainTab은 demo 모드. 실제 GPU 체크, 학습 시작/중지, 실시간 진행률 표시로 교체.

- [ ] **Step 1: `api.ts`에 새 엔드포인트 추가**

```typescript
export async function trainGpuCheck(): Promise<{ available: boolean; info: string }> {
  const res = await fetch(`${API}/train/gpu-check`);
  return res.json();
}

export async function trainStop(projectId: string): Promise<any> {
  const res = await fetch(`${API}/train/stop/${projectId}`, { method: "POST" });
  return res.json();
}

// trainStatus 수정: project_id 기반으로 변경
export async function trainStatus(projectId: string): Promise<any> {
  const res = await fetch(`${API}/train/status/${projectId}`);
  return res.json();
}
```

- [ ] **Step 2: `types.ts`에 GPU 체크 타입 추가**

```typescript
export interface GpuInfo {
  available: boolean;
  info: string;
}

export interface TrainProgress {
  status: "idle" | "starting" | "installing" | "loading_model" | "training" | "converting" | "registering" | "completed" | "failed";
  epoch: number;
  total_epochs: number;
  progress: number;
  loss: number | null;
  error: string | null;
}
```

- [ ] **Step 3: `TrainTab.tsx` 리뉴얼**

GPU 체크 → 학습 시작 → 실시간 진행률 → 완료 알림 흐름으로 재구현. 주요 변경:

- 마운트 시 GPU 체크 API 호출하여 GPU 상태 표시
- GPU 없으면 "GPU가 필요합니다" 경고 + 학습 버튼 비활성화
- 학습 시작 시 `trainStart()` → 폴링으로 `trainStatus(projectId)` 주기적 확인
- 상태별 UI: installing → loading_model → training (progress bar + loss) → converting → registering → completed
- 완료 시 "모델이 Ollama에 등록되었습니다!" 표시
- 실패 시 에러 메시지 표시 + "다시 시도" 버튼

- [ ] **Step 4: `TrainConfig.tsx` 업데이트**

기존 설정 폼에 맞게 필드 정리:
- 베이스 모델 선택 (드롭다운)
- Epochs (기본 3)
- Learning Rate (기본 2e-4)
- Batch Size (기본 4)
- LoRA Rank (기본 16)
- 모르면 기본값 그대로 "시작" 누르면 됨

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/train/ frontend/src/api.ts frontend/src/types.ts
git commit -m "feat: 학습 탭 리뉴얼 — GPU 체크, 실제 학습 진행률, Ollama 등록 알림"
```

---

### Task 9: 생성 탭에서 학습된 모델 사용

**Files:**
- Modify: `backend/routers/generate.py:70-85` — 모델 목록에 학습된 모델 포함
- Modify: `frontend/src/components/generate/GenerateTab.tsx` — 모델 선택 UI

**Context:** 학습 완료 후 Ollama에 `storyforge-{프로젝트명}` 으로 등록됨. 생성 탭 모델 목록에 자동으로 나타나야 함.

- [ ] **Step 1: `generate.py`의 `list_models()`가 이미 Ollama에서 모델 목록을 가져오는지 확인**

현재 `generate.py`의 모델 목록 엔드포인트가 Ollama API(`/api/tags`)를 호출하고 있으면 학습된 모델이 자동으로 포함됨. 확인 후 필요한 수정만 진행.

- [ ] **Step 2: 프론트 모델 선택 드롭다운에서 `storyforge-*` 모델에 배지 표시**

학습된 모델은 이름이 `storyforge-`로 시작하므로 드롭다운에서 "(학습됨)" 뱃지 추가:

```typescript
{models.map(m => (
  <option key={m.name} value={m.name}>
    {m.name} {m.name.startsWith("storyforge-") ? " (학습됨)" : ""}
  </option>
))}
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/generate.py frontend/src/components/generate/GenerateTab.tsx
git commit -m "feat: 생성 탭에서 학습된 LoRA 모델 자동 표시"
```

---

## Chunk 4: 배포 패키징 (Phase D)

### Task 10: 프론트엔드 빌드 정리

**Files:**
- Modify: `frontend/vite.config.ts` — API 프록시 설정 확인
- Run: `npm run build` → `frontend/dist/` 생성

- [ ] **Step 1: `vite.config.ts`에 API 프록시 설정 확인/추가**

개발 모드에서 `/api` 요청이 백엔드(8000)로 프록시되는지 확인:

```typescript
server: {
  port: 4000,
  proxy: {
    '/api': 'http://127.0.0.1:8000',
  },
},
```

- [ ] **Step 2: 프론트 빌드**

```bash
cd frontend && npm run build
```

`dist/` 폴더가 생성되면 백엔드 `main.py`의 정적 파일 서빙으로 Node 없이 프론트 제공 가능.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.ts frontend/dist/
git commit -m "build: 프론트엔드 빌드 + 프록시 설정 정리"
```

---

### Task 11: `시작.bat` 개선 — 완전 자동화

**Files:**
- Modify: `시작.bat` — embedded Python 지원, 의존성 자동화 강화

- [ ] **Step 1: `시작.bat` 재작성**

```batch
@echo off
chcp 65001 >nul
title StoryForge - 로컬 AI 파인튜닝 파이프라인

echo.
echo  ╔══════════════════════════════════════╗
echo  ║  StoryForge v0.3                     ║
echo  ║  로컬 AI 파인튜닝 파이프라인          ║
echo  ╚══════════════════════════════════════╝
echo.

set "ROOT=%~dp0"
set "PYTHON=%ROOT%python-embedded\python.exe"

:: ─── Python 확인 ───
echo [1/5] Python 확인 중...
if exist "%PYTHON%" (
    echo   OK 내장 Python 사용
) else (
    where python >nul 2>&1
    if %errorlevel% neq 0 (
        echo   ERROR Python이 없습니다. python-embedded 폴더를 확인하세요.
        pause
        exit /b 1
    )
    set "PYTHON=python"
    echo   OK 시스템 Python 사용
)

:: ─── GPU 확인 ───
echo [2/5] GPU 확인 중...
nvidia-smi >nul 2>&1
if %errorlevel% neq 0 (
    echo   WARN NVIDIA GPU 미감지. 수집/정제/생성은 가능하지만 학습은 불가합니다.
) else (
    echo   OK GPU 확인 완료
)

:: ─── Ollama 확인/설치 ───
echo [3/5] Ollama 확인 중...
where ollama >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%ROOT%setup\ollama-installer.exe" (
        echo   INFO Ollama 설치 중...
        "%ROOT%setup\ollama-installer.exe" /VERYSILENT /NORESTART
    ) else (
        echo   INFO Ollama 자동 설치 중... (winget)
        winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements -s winget
    )
    if %errorlevel% neq 0 (
        echo   ERROR Ollama 설치 실패. https://ollama.com 에서 직접 설치해주세요.
        pause
        exit /b 1
    )
    echo   OK Ollama 설치 완료. 이 창을 닫고 다시 실행해주세요.
    pause
    exit /b 0
)
echo   OK Ollama 확인 완료

:: ─── Ollama 서버 시작 ───
echo [4/5] Ollama 서버 시작 중...
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | findstr /I "ollama.exe" >nul 2>&1
if %errorlevel% neq 0 (
    start /B "" ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul
)

:: Gemma4 모델 확인
ollama list 2>nul | findstr /I "gemma4" >nul 2>&1
if %errorlevel% neq 0 (
    echo   INFO Gemma 4 모델 다운로드 중... (약 9.6GB)
    ollama pull gemma4
    if %errorlevel% neq 0 (
        echo   ERROR 모델 다운로드 실패. 인터넷 연결을 확인해주세요.
        pause
        exit /b 1
    )
)
echo   OK Ollama 서버 + 모델 준비 완료

:: ─── 백엔드 시작 ───
echo [5/5] StoryForge 시작 중...
cd /d "%ROOT%backend"
"%PYTHON%" -m pip install -r requirements.txt -q 2>nul
start /B "" "%PYTHON%" main.py >nul 2>&1
timeout /t 3 /nobreak >nul

:: ─── 브라우저 열기 ───
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  StoryForge 시작 완료!               ║
echo  ║  브라우저에서 자동으로 열립니다.       ║
echo  ║  이 창을 닫으면 서버가 종료됩니다.     ║
echo  ╚══════════════════════════════════════╝
echo.
start http://127.0.0.1:8000
echo 서버 실행 중... (이 창을 닫으면 종료됩니다)
pause >nul
```

핵심 변경:
- `python-embedded/` 우선 사용, 없으면 시스템 Python 폴백
- `setup/ollama-installer.exe` 내장 설치 지원
- 프론트 dev 서버 대신 빌드된 dist를 백엔드가 서빙 (Node 불필요)
- 포트 8000 통합 (프론트+백엔드)

- [ ] **Step 2: Commit**

```bash
git add 시작.bat
git commit -m "feat: 시작.bat 개선 — embedded Python 지원, Node 불필요, 통합 서빙"
```

---

### Task 12: embedded Python 패키징 준비

**Files:**
- Create: `scripts/package.py` — 배포 패키지 빌드 스크립트

**Context:** 이 스크립트는 개발자가 배포 zip을 만들 때 사용. 사용자용이 아님.

- [ ] **Step 1: `scripts/package.py` 생성**

```python
"""Build distributable StoryForge.zip package.

Run: python scripts/package.py
Output: dist/StoryForge.zip
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
STAGE = DIST / "StoryForge"


def main():
    print("=== StoryForge 패키징 시작 ===")

    # Clean
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)

    # 1. Frontend build
    print("[1/5] 프론트엔드 빌드...")
    subprocess.run(["npm", "run", "build"], cwd=str(ROOT / "frontend"), check=True)

    # 2. Copy backend
    print("[2/5] 백엔드 복사...")
    shutil.copytree(ROOT / "backend", STAGE / "backend",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "data"))
    (STAGE / "backend" / "data").mkdir()

    # 3. Copy frontend dist
    print("[3/5] 프론트엔드 dist 복사...")
    shutil.copytree(ROOT / "frontend" / "dist", STAGE / "frontend" / "dist")

    # 4. Copy 시작.bat
    print("[4/5] 시작.bat 복사...")
    shutil.copy2(ROOT / "시작.bat", STAGE / "시작.bat")

    # 5. Setup directory
    print("[5/5] setup 디렉토리 생성...")
    (STAGE / "setup").mkdir()
    # Note: ollama-installer.exe must be manually placed in setup/

    # Create zip
    print("ZIP 생성 중...")
    zip_path = DIST / "StoryForge"
    shutil.make_archive(str(zip_path), "zip", str(DIST), "StoryForge")

    print(f"완료: {zip_path}.zip")
    print(f"크기: {(zip_path.with_suffix('.zip')).stat().st_size / 1024 / 1024:.1f} MB")
    print()
    print("TODO: setup/ollama-installer.exe 수동 추가 필요")
    print("TODO: python-embedded/ 수동 추가 필요 (https://www.python.org/ftp/python/ 에서 embedded zip 다운로드)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/package.py
git commit -m "feat: 배포 패키지 빌드 스크립트 추가"
```

---

## 구현 순서 요약

| Task | 내용 | Phase | 의존성 |
|------|------|-------|--------|
| 1 | 수집 덮어쓰기 버그 수정 + 동시수집 방지 | A | 없음 |
| 2 | SSE 스트리밍 버그 수정 | A | 없음 |
| 3 | job store 메모리 정리 | A | 없음 |
| 4 | 프리셋 시스템 실제 동작 | B | 없음 |
| 5 | 태깅 재시도 로직 | B | 없음 |
| 6 | VibeVoice-ASR STT 추가 | B | 없음 |
| 7 | 학습 백엔드 (Unsloth QLoRA) | C | Task 4 (JSONL 필요) |
| 8 | 학습 탭 프론트엔드 리뉴얼 | C | Task 7 |
| 9 | 생성 탭 학습 모델 표시 | C | Task 7 |
| 10 | 프론트엔드 빌드 정리 | D | Task 8, 9 |
| 11 | 시작.bat 개선 | D | Task 10 |
| 12 | 패키징 스크립트 | D | Task 11 |

**병렬 가능**: Task 1~6은 서로 독립적이므로 동시 진행 가능.
**순차 필수**: Task 7 → 8 → 9 → 10 → 11 → 12.
