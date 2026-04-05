# 정제 파이프라인 v2 + 연쇄 생성 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2-pass 정제(STT교정+상세분석)로 4-Task 학습 데이터를 생성하고, 학습된 모델로 긴 스토리를 연쇄 생성하는 파이프라인 구현

**Architecture:** 기존 `refine_service.py`의 tag/JSONL 로직을 2-pass(교정→분석)로 교체하고, 새 `story_service.py`에 연쇄 생성 로직 추가. 프론트엔드 GenerateTab에 스토리 생성 UI 추가.

**Tech Stack:** FastAPI, Ollama API (httpx), React/TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-05-refine-pipeline-v2-design.md`

---

## Chunk 1: 백엔드 — 정제 파이프라인 v2

### Task 1: 스키마 업데이트

**Files:**
- Modify: `backend/models/schemas.py`

- [ ] **Step 1: ChunkAnalysis 모델 추가**

`schemas.py` 끝에 추가:

```python
class ChunkAnalysis(BaseModel):
    genre: str = "미분류"
    core_event: str = ""
    characters: list[str] = []
    emotional_arc: str = ""
    hook: str = ""
    summary: str = ""
    narrative_technique: str = ""
    is_content: bool = True


class ChunkDataV2(BaseModel):
    index: int
    text: str
    corrected_text: str = ""
    analysis: Optional[ChunkAnalysis] = None
    episode: str = ""
```

- [ ] **Step 2: StoryGenerateRequest 모델 추가**

```python
class StoryGenerateRequest(BaseModel):
    model: str
    genre: str
    topic: str
    num_scenes: int = 12
    temperature: float = 0.7
    max_tokens: int = 2048
```

- [ ] **Step 3: Commit**

```bash
git add backend/models/schemas.py
git commit -m "feat: ChunkAnalysis, ChunkDataV2, StoryGenerateRequest 스키마 추가"
```

---

### Task 2: refine_service.py — Pass 1 STT 교정 함수

**Files:**
- Modify: `backend/services/refine_service.py`

- [ ] **Step 1: correct_chunk 함수 추가**

`refine_service.py`에 추가. 기존 함수들은 건드리지 않음:

```python
CORRECT_PROMPT = """다음은 유튜브 영상의 한국어 음성 자동 전사(STT/자막) 텍스트야.
음성 인식 오류로 인해 동음이의어 혼동, 받침 탈락, 단어 경계 오류가 많아.

예시:
- "사진과" → "사진관" (동음이의어)
- "현상행" → "현상액" (동음이의어)
- "많치" → "많지" (받침 오류)
- "시공 불리" → "시공 불량" (동음이의어)

위와 같은 STT 전사 오류를 맥락에 맞게 교정해서, 교정된 전체 텍스트만 출력해줘.
원문의 줄바꿈 구조는 그대로 유지하고, 확신이 없으면 원문 그대로 둬.

텍스트:
"""


async def correct_chunk(text: str, model: str = "gemma4") -> str:
    """Pass 1: STT 오타 교정. 자유 텍스트 출력 (format: json 미사용)."""
    payload = {
        "model": model,
        "prompt": CORRECT_PROMPT + text,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 4096},
    }
    try:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
            resp = await client.post("/api/generate", json=payload)
            resp.raise_for_status()
            corrected = resp.json().get("response", "").strip()
            # 교정 결과가 너무 짧으면 (모델 실패) 원문 반환
            if len(corrected) < len(text) * 0.5:
                return text
            return corrected
    except Exception:
        return text  # 실패 시 원문 유지
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/refine_service.py
git commit -m "feat: correct_chunk — STT 오타 교정 (Pass 1)"
```

---

### Task 3: refine_service.py — Pass 2 상세 분석 함수

**Files:**
- Modify: `backend/services/refine_service.py`

- [ ] **Step 1: analyze_chunk 함수 추가**

```python
ANALYZE_PROMPT = """다음 텍스트를 분석해서 반드시 JSON만 응답해.

키:
- genre: 세부 장르 (막장드라마, 복수극, 불륜미스터리 등 구체적)
- core_event: 이 장면의 핵심 사건 (1문장, 구체적으로)
- characters: 등장인물과 관계 (배열)
- emotional_arc: 이 장면의 감정 변화 흐름 (시작 감정 → 끝 감정)
- hook: 다음 장면으로 이어지는 궁금증/떡밥 (1문장)
- summary: 무슨 일이 벌어지는지 2~3문장 요약
- narrative_technique: 사용된 서사 기법 (예: 1인칭 회상, 반전, 복선, 클리프행어)
- is_content: true면 실제 스토리 내용, false면 방송 인트로/아웃트로/광고/구독유도

텍스트:
"""

DEFAULT_ANALYSIS = {
    "genre": "미분류",
    "core_event": "",
    "characters": [],
    "emotional_arc": "",
    "hook": "",
    "summary": "",
    "narrative_technique": "",
    "is_content": True,
}


async def analyze_chunk(text: str, model: str = "gemma4") -> dict:
    """Pass 2: 상세 분석. JSON format 사용."""
    payload = {
        "model": model,
        "prompt": ANALYZE_PROMPT + text,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 1024},
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
            resp = await client.post("/api/generate", json=payload)
            resp.raise_for_status()
            raw = resp.json().get("response", "{}")
        result = _extract_json(raw)
        # 필수 키 보장
        for key, default in DEFAULT_ANALYSIS.items():
            if key not in result:
                result[key] = default
        return result
    except Exception:
        return dict(DEFAULT_ANALYSIS)
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/refine_service.py
git commit -m "feat: analyze_chunk — 8-key 상세 분석 (Pass 2)"
```

---

### Task 4: refine_service.py — 4-Task JSONL 빌더

**Files:**
- Modify: `backend/services/refine_service.py`

- [ ] **Step 1: build_4task_jsonl 함수 추가**

```python
def _get_position(index: int, total: int) -> str:
    ratio = index / total
    if ratio < 0.15:
        return "도입"
    elif ratio < 0.6:
        return "전개"
    elif ratio < 0.85:
        return "절정"
    return "결말"


def _tail(text: str, max_chars: int = 500) -> str:
    return text[-max_chars:] if len(text) > max_chars else text


def build_4task_jsonl(
    episode_title: str,
    chunks: list[dict],
) -> tuple[list[str], dict]:
    """Build 4-Task JSONL lines + outline for one episode.

    chunks: list of {text, corrected_text, analysis, episode}
    Returns (jsonl_lines, outline_dict)
    """
    # Filter content-only chunks
    content_chunks = [
        c for c in chunks
        if c.get("analysis", {}).get("is_content", True)
    ]
    if not content_chunks:
        return [], {}

    total = len(content_chunks)
    genre = content_chunks[0].get("analysis", {}).get("genre", "미분류")
    lines: list[str] = []

    # Build outline from analyses
    outline_scenes = []
    for i, c in enumerate(content_chunks):
        a = c.get("analysis", {})
        position = _get_position(i, total)
        outline_scenes.append({
            "index": i + 1,
            "position": position,
            "core_event": a.get("core_event", ""),
            "emotional_arc": a.get("emotional_arc", ""),
            "hook": a.get("hook", ""),
            "summary": a.get("summary", ""),
        })

    outline_dict = {
        "episode": episode_title,
        "genre": genre,
        "scenes": outline_scenes,
    }

    # --- Task 1: Outline ---
    outline_text = "\n\n".join(
        f"장면 {s['index']}/{total} ({s['position']}): {s['core_event']}\n"
        f"  감정: {s['emotional_arc']}\n"
        f"  떡밥: {s['hook']}"
        for s in outline_scenes
    )
    lines.append(json.dumps({
        "instruction": f"장르: {genre} / 제목: {episode_title[:60]}\n1시간 분량 스크립트의 전체 아웃라인을 작성해줘",
        "input": "",
        "output": outline_text,
    }, ensure_ascii=False))

    # --- Task 2: Scene expansion with context ---
    for i, c in enumerate(content_chunks):
        a = c.get("analysis", {})
        text = c.get("corrected_text") or c.get("text", "")

        # 이전 흐름: core_event 연결 (최근 5개까지)
        prev_start = max(0, i - 5)
        prev_flow = " → ".join(
            f"[{j+1}] {content_chunks[j].get('analysis', {}).get('core_event', '')[:60]}"
            for j in range(prev_start, i)
        )

        prev_input = _tail(content_chunks[i-1].get("corrected_text") or content_chunks[i-1].get("text", "")) if i > 0 else ""

        lines.append(json.dumps({
            "instruction": (
                f"장르: {genre}\n"
                f"에피소드: {episode_title[:60]}\n"
                f"장면 {i+1}/{total}\n"
                f"현재 장면: {a.get('core_event', '')}\n"
                + (f"이전 흐름: {prev_flow}\n" if prev_flow else "")
                + "이 장면을 써줘"
            ),
            "input": prev_input,
            "output": text,
        }, ensure_ascii=False))

    # --- Task 3: Continuation (adjacent pairs) ---
    for i in range(1, len(content_chunks)):
        prev_c = content_chunks[i - 1]
        curr_c = content_chunks[i]
        curr_a = curr_c.get("analysis", {})
        prev_text = prev_c.get("corrected_text") or prev_c.get("text", "")
        curr_text = curr_c.get("corrected_text") or curr_c.get("text", "")

        lines.append(json.dumps({
            "instruction": (
                f"장르: {genre}\n"
                f"에피소드: {episode_title[:60]}\n"
                f"장면 위치: {i+1}/{total}\n"
                f"감정 흐름: {curr_a.get('emotional_arc', '')}\n"
                "이어서 써줘"
            ),
            "input": _tail(prev_text),
            "output": curr_text,
        }, ensure_ascii=False))

    # --- Task 4: Style ---
    for c in content_chunks:
        a = c.get("analysis", {})
        text = c.get("corrected_text") or c.get("text", "")

        lines.append(json.dumps({
            "instruction": (
                f"장르: {a.get('genre', '미분류')} / "
                f"핵심사건: {a.get('core_event', '')} / "
                f"감정: {a.get('emotional_arc', '')} / "
                f"기법: {a.get('narrative_technique', '')}\n"
                "이 장면을 써줘"
            ),
            "input": "",
            "output": text,
        }, ensure_ascii=False))

    return lines, outline_dict
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/refine_service.py
git commit -m "feat: build_4task_jsonl — 4-Task 학습 데이터 생성기"
```

---

### Task 5: routers/refine.py — auto-process v2 통합

**Files:**
- Modify: `backend/routers/refine.py`

- [ ] **Step 1: import 추가**

기존 import에 추가:

```python
from services.refine_service import (
    # ... 기존 import 유지 ...
    correct_chunk,
    analyze_chunk,
    build_4task_jsonl,
)
```

- [ ] **Step 2: _run_auto_process 함수 교체**

기존 `_run_auto_process` 함수 전체를 새 버전으로 교체. 핵심 변경:
- Step 1: 청킹 (기존과 동일)
- Step 2: **각 청크에 대해 correct_chunk → analyze_chunk 순차 호출**
- Step 3: `build_4task_jsonl`로 JSONL 생성
- Step 4: chunks.json (corrected_text + analysis 포함), outlines.json, dataset.jsonl 저장

```python
async def _run_auto_process(
    job: RefineJob,
    chunk_size: int | None = None,
    model: str | None = None,
) -> None:
    """Background: split episodes → chunk → correct → analyze → build 4-Task JSONL."""
    job.status = JobStatus.running
    try:
        preset = _load_project_preset(job.project_id)
        effective_chunk_size = chunk_size if chunk_size is not None else preset.get("chunk_size", 1500)
        effective_model = model if model is not None else preset.get("tag_model", "gemma4")

        proj_dir = DATA_DIR / job.project_id
        raw_path = proj_dir / "raw.txt"
        if not raw_path.exists():
            job.status = JobStatus.failed
            job._finished_at = time.time()
            job.error = "raw.txt 파일을 찾을 수 없습니다. 먼저 데이터를 수집하세요."
            return

        raw_text = raw_path.read_text(encoding="utf-8")
        if not raw_text.strip():
            job.status = JobStatus.failed
            job._finished_at = time.time()
            job.error = "raw.txt가 비어 있습니다."
            return

        # Split into episodes
        episode_pattern = re.compile(
            r"--- VIDEO: (.+?) ---\n(.*?)(?=--- END VIDEO ---|$)",
            re.DOTALL,
        )
        episodes = episode_pattern.findall(raw_text)
        if not episodes:
            episodes = [("전체", raw_text)]

        # Count total chunks
        episode_chunks_map: list[tuple[str, list[str]]] = []
        total_chunks = 0
        for ep_title, ep_text in episodes:
            ep_chunks = rs_chunk_text(ep_text.strip(), effective_chunk_size)
            episode_chunks_map.append((ep_title, ep_chunks))
            total_chunks += len(ep_chunks)

        job.total = total_chunks
        job.chunks = []

        # Process each episode
        all_jsonl_lines: list[str] = []
        all_outlines: list[dict] = []
        all_chunks_json: list[dict] = []
        global_index = 0

        for ep_title, ep_chunks in episode_chunks_map:
            episode_chunk_data: list[dict] = []

            for chunk_text_raw in ep_chunks:
                # UI tracking
                chunk_obj = ChunkData(index=global_index, text=chunk_text_raw)
                job.chunks.append(chunk_obj)

                # Pass 1: STT correction
                try:
                    corrected = await correct_chunk(chunk_text_raw, model=effective_model)
                except Exception:
                    corrected = chunk_text_raw

                # Pass 2: Detailed analysis
                try:
                    analysis = await analyze_chunk(corrected, model=effective_model)
                except RuntimeError as exc:
                    job.status = JobStatus.failed
                    job._finished_at = time.time()
                    job.error = str(exc)
                    return
                except Exception:
                    analysis = dict(DEFAULT_ANALYSIS)

                # Back-fill ChunkData for UI compatibility
                chunk_obj.tags = ChunkTag(
                    genre=analysis.get("genre", "미분류"),
                    topic=analysis.get("core_event", "미분류"),
                    mood=analysis.get("emotional_arc", "미분류"),
                    scene_type=analysis.get("narrative_technique", "미분류"),
                )

                chunk_data = {
                    "text": chunk_text_raw,
                    "corrected_text": corrected,
                    "analysis": analysis,
                    "episode": ep_title,
                }
                episode_chunk_data.append(chunk_data)

                global_index += 1
                job.processed = global_index

            # Build 4-Task JSONL + outline for this episode
            ep_lines, ep_outline = build_4task_jsonl(ep_title, episode_chunk_data)
            all_jsonl_lines.extend(ep_lines)
            if ep_outline:
                all_outlines.append(ep_outline)

            # Accumulate chunks.json data
            for c in episode_chunk_data:
                all_chunks_json.append({
                    "index": len(all_chunks_json),
                    "text": c["text"],
                    "corrected_text": c["corrected_text"],
                    "analysis": c["analysis"],
                    "episode": c["episode"],
                })

        # Save outputs
        proj_dir.mkdir(parents=True, exist_ok=True)

        (proj_dir / "chunks.json").write_text(
            json.dumps(all_chunks_json, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (proj_dir / "outlines.json").write_text(
            json.dumps(all_outlines, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (proj_dir / "dataset.jsonl").write_text(
            "\n".join(all_jsonl_lines), encoding="utf-8"
        )

        job.status = JobStatus.completed
        job._finished_at = time.time()

    except Exception as exc:
        job.status = JobStatus.failed
        job._finished_at = time.time()
        job.error = str(exc)
```

- [ ] **Step 3: `DEFAULT_ANALYSIS` import 추가**

```python
from services.refine_service import (
    # ... existing ...
    DEFAULT_ANALYSIS,
)
```

- [ ] **Step 4: Commit**

```bash
git add backend/routers/refine.py
git commit -m "feat: auto-process v2 — 2-pass 정제 + 4-Task JSONL 생성"
```

---

### Task 6: max_seq_length 상향

**Files:**
- Modify: `backend/scripts/train_lora.py`

- [ ] **Step 1: max_seq_length 2048 → 4096으로 변경**

`train_lora.py`의 `max_seq_length` 값을 찾아서 4096으로 변경.

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/train_lora.py
git commit -m "feat: max_seq_length 2048→4096 상향"
```

---

## Chunk 2: 백엔드 — 연쇄 생성 파이프라인

### Task 7: story_service.py 생성

**Files:**
- Create: `backend/services/story_service.py`

- [ ] **Step 1: 아웃라인 파서 + 장면 생성 로직 작성**

```python
"""Story generation service — chain generation pipeline."""
from __future__ import annotations

import json
import re
from typing import AsyncIterator

from services.ollama import generate as ollama_generate


def parse_outline(outline_text: str) -> list[dict]:
    """Parse generated outline into scene list.

    Expected format: "장면 {N}/{total} ({position}): {description}"
    """
    scenes = []
    # Primary pattern
    pattern = re.compile(
        r"장면\s+(\d+)/(\d+)\s*\(([^)]+)\)\s*:\s*(.+?)(?=\n\s*장면\s+\d+/|\n\s*$|$)",
        re.DOTALL,
    )
    for m in pattern.finditer(outline_text):
        num, total, position, desc = m.groups()
        # Extract core description (first line)
        core = desc.strip().split("\n")[0].strip()
        scenes.append({
            "num": int(num),
            "total": int(total),
            "position": position.strip(),
            "description": core,
            "full_block": desc.strip(),
        })

    if not scenes:
        # Fallback: split by numbered lines
        for i, line in enumerate(outline_text.strip().split("\n"), 1):
            line = line.strip()
            if line and not line.startswith("감정:") and not line.startswith("떡밥:"):
                scenes.append({
                    "num": i,
                    "total": 0,
                    "position": "",
                    "description": line,
                    "full_block": line,
                })

    # Update total if parsed from regex
    if scenes and scenes[0]["total"] > 0:
        total = scenes[0]["total"]
        for s in scenes:
            s["total"] = total

    return scenes


async def generate_story(
    model: str,
    genre: str,
    topic: str,
    num_scenes: int = 12,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> AsyncIterator[dict]:
    """Chain generation: outline → scenes → full story.

    Yields SSE-compatible dicts:
      {"step": "outline", "content": "..."}
      {"step": "scene", "scene_num": N, "total": T, "content": "..."}
      {"step": "error", "scene_num": N, "error": "..."}
      {"step": "done", "full_text": "..."}
    """
    # Step 1: Generate outline
    outline_prompt = (
        f"장르: {genre} / 주제: {topic}\n"
        f"1시간 분량 스크립트의 전체 아웃라인을 작성해줘\n"
        f"약 {num_scenes}개 장면으로 구성하고, 각 장면마다 핵심 사건과 감정 변화를 포함해줘.\n"
        f"형식: 장면 1/{num_scenes} (도입): 설명\\n  감정: ...\\n  떡밥: ..."
    )

    outline_text = await ollama_generate(
        model=model,
        prompt=outline_prompt,
        system=f"당신은 {genre} 장르의 스토리 기획자입니다.",
        temperature=temperature,
        max_tokens=max_tokens,
    )
    yield {"step": "outline", "content": outline_text}

    # Step 2: Parse outline
    scenes = parse_outline(outline_text)
    if not scenes:
        yield {"step": "error", "scene_num": 0, "error": "아웃라인 파싱 실패"}
        return

    total = len(scenes)

    # Step 3: Generate each scene
    generated_scenes: list[str] = []
    scene_summaries: list[str] = []

    for i, scene in enumerate(scenes):
        # Build previous flow (last 5)
        start = max(0, len(scene_summaries) - 5)
        prev_flow = " → ".join(
            f"[{j+1}] {scene_summaries[j][:60]}"
            for j in range(start, len(scene_summaries))
        )

        # Build input (tail of previous scene)
        prev_tail = ""
        if generated_scenes:
            prev = generated_scenes[-1]
            prev_tail = prev[-500:] if len(prev) > 500 else prev

        scene_prompt = (
            f"장르: {genre}\n"
            f"주제: {topic}\n"
            f"장면 {i+1}/{total}\n"
            f"현재 장면: {scene['description']}\n"
            + (f"이전 흐름: {prev_flow}\n" if prev_flow else "")
            + "이 장면을 써줘"
        )
        if prev_tail:
            scene_prompt += f"\n\n[이전 장면 끝부분]\n{prev_tail}"

        # Try generation with 1 retry
        scene_text = ""
        for attempt in range(2):
            try:
                scene_text = await ollama_generate(
                    model=model,
                    prompt=scene_prompt,
                    system=f"당신은 {genre} 장르의 스토리 작가입니다. 몰입감 있는 장면을 작성하세요.",
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                break
            except Exception as exc:
                if attempt == 1:
                    yield {"step": "error", "scene_num": i + 1, "error": str(exc)}

        if scene_text:
            generated_scenes.append(scene_text)
            # Use first sentence as summary for context
            first_sentence = scene_text.split("\n")[0][:80]
            scene_summaries.append(first_sentence)
            yield {"step": "scene", "scene_num": i + 1, "total": total, "content": scene_text}

    # Step 4: Concatenate
    full_text = "\n\n---\n\n".join(generated_scenes)
    yield {"step": "done", "full_text": full_text}
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/story_service.py
git commit -m "feat: story_service — 연쇄 생성 파이프라인 (아웃라인→장면→완성)"
```

---

### Task 8: routers/generate.py — /story 엔드포인트

**Files:**
- Modify: `backend/routers/generate.py`

- [ ] **Step 1: import 추가**

```python
from models.schemas import StoryGenerateRequest
from services.story_service import generate_story
```

- [ ] **Step 2: /story SSE 엔드포인트 추가**

기존 엔드포인트 아래에 추가:

```python
@router.post("/story")
async def story_generate(req: StoryGenerateRequest):
    """Chain generation: outline → scene-by-scene → full story. SSE streaming."""
    async def event_generator():
        try:
            async for event in generate_story(
                model=req.model,
                genre=req.genre,
                topic=req.topic,
                num_scenes=req.num_scenes,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            ):
                data = json.dumps(event, ensure_ascii=False)
                yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            error_data = json.dumps({"step": "error", "error": str(exc)})
            yield f"data: {error_data}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 3: Commit**

```bash
git add backend/routers/generate.py
git commit -m "feat: /api/generate/story — 연쇄 생성 SSE 엔드포인트"
```

---

## Chunk 3: 프론트엔드 — 스토리 생성 UI

### Task 9: StoryGenerator 컴포넌트

**Files:**
- Create: `frontend/src/components/generate/StoryGenerator.tsx`

- [ ] **Step 1: 스토리 생성 컴포넌트 작성**

```tsx
import { useState, useRef } from "react";

interface StoryEvent {
  step: string;
  content?: string;
  scene_num?: number;
  total?: number;
  full_text?: string;
  error?: string;
}

export default function StoryGenerator() {
  const [genre, setGenre] = useState("");
  const [topic, setTopic] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [numScenes, setNumScenes] = useState(12);
  const [generating, setGenerating] = useState(false);
  const [outline, setOutline] = useState("");
  const [scenes, setScenes] = useState<string[]>([]);
  const [currentScene, setCurrentScene] = useState(0);
  const [totalScenes, setTotalScenes] = useState(0);
  const [fullText, setFullText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Load models on mount
  useState(() => {
    fetch("/api/generate/models")
      .then((r) => r.json())
      .then((data) => {
        const names = (data.models || []).map((m: any) => m.name || m.model);
        setModels(names);
        if (names.length > 0) setModel(names[0]);
      })
      .catch(() => {});
  });

  const startGeneration = async () => {
    if (!genre.trim() || !topic.trim() || !model) return;

    setGenerating(true);
    setOutline("");
    setScenes([]);
    setCurrentScene(0);
    setTotalScenes(0);
    setFullText("");
    setErrors([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/generate/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          genre: genre.trim(),
          topic: topic.trim(),
          num_scenes: numScenes,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const event: StoryEvent = JSON.parse(line.slice(6));
            if (event.step === "outline") {
              setOutline(event.content || "");
            } else if (event.step === "scene") {
              setCurrentScene(event.scene_num || 0);
              setTotalScenes(event.total || 0);
              setScenes((prev) => [...prev, event.content || ""]);
            } else if (event.step === "error") {
              setErrors((prev) => [...prev, `장면 ${event.scene_num}: ${event.error}`]);
            } else if (event.step === "done") {
              setFullText(event.full_text || "");
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setErrors((prev) => [...prev, err.message]);
      }
    } finally {
      setGenerating(false);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setGenerating(false);
  };

  const exportText = () => {
    if (!fullText) return;
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${genre}_${topic}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">전체 스크립트 생성</h3>

      {/* Input form */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-gray-400 mb-1">장르</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            placeholder="예: 막장드라마"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            disabled={generating}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">주제</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            placeholder="예: 재산다툼"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={generating}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">모델</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={generating}
          >
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">장면 수</label>
          <input
            type="number"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            value={numScenes}
            onChange={(e) => setNumScenes(Number(e.target.value))}
            min={4}
            max={20}
            disabled={generating}
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {!generating ? (
          <button
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium disabled:opacity-50"
            onClick={startGeneration}
            disabled={!genre.trim() || !topic.trim() || !model}
          >
            스크립트 생성
          </button>
        ) : (
          <button
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium"
            onClick={stopGeneration}
          >
            중지
          </button>
        )}
        {fullText && (
          <button
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            onClick={exportText}
          >
            내보내기 (.txt)
          </button>
        )}
      </div>

      {/* Progress */}
      {generating && (
        <div className="text-sm text-gray-400">
          {!outline
            ? "아웃라인 생성 중..."
            : `장면 ${currentScene}/${totalScenes} 생성 중...`}
        </div>
      )}
      {totalScenes > 0 && (
        <div className="w-full bg-gray-800 rounded h-2">
          <div
            className="bg-blue-500 rounded h-2 transition-all"
            style={{ width: `${(currentScene / totalScenes) * 100}%` }}
          />
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="text-sm text-red-400 space-y-1">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {/* Outline */}
      {outline && (
        <details className="bg-gray-800 rounded p-3" open={!fullText}>
          <summary className="text-sm font-medium cursor-pointer">
            아웃라인
          </summary>
          <pre className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">
            {outline}
          </pre>
        </details>
      )}

      {/* Generated scenes */}
      {scenes.length > 0 && !fullText && (
        <div className="space-y-3">
          {scenes.map((s, i) => (
            <div key={i} className="bg-gray-800 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">장면 {i + 1}</div>
              <div className="text-sm text-gray-200 whitespace-pre-wrap">{s}</div>
            </div>
          ))}
        </div>
      )}

      {/* Full text result */}
      {fullText && (
        <div className="bg-gray-800 rounded p-4">
          <div className="text-sm font-medium mb-2">
            완성된 스크립트 ({fullText.length.toLocaleString()}자)
          </div>
          <div className="text-sm text-gray-200 whitespace-pre-wrap max-h-[600px] overflow-y-auto">
            {fullText}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/generate/StoryGenerator.tsx
git commit -m "feat: StoryGenerator 컴포넌트 — 스토리 연쇄 생성 UI"
```

---

### Task 10: GenerateTab에 StoryGenerator 통합

**Files:**
- Modify: `frontend/src/components/generate/GenerateTab.tsx`

- [ ] **Step 1: GenerateTab 읽고 구조 파악**

현재 GenerateTab에 탭/모드 전환이 있는지 확인. ChatInterface와 BatchGenerate가 이미 있음.

- [ ] **Step 2: StoryGenerator import 및 탭 추가**

GenerateTab에 "채팅 / 배치 / 스크립트 생성" 탭 전환 추가:

```tsx
import StoryGenerator from "./StoryGenerator";
```

기존 탭 구조에 세 번째 탭으로 StoryGenerator 추가. 구체적 코드는 기존 탭 구조에 맞춰 작성.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/generate/GenerateTab.tsx
git commit -m "feat: GenerateTab에 스크립트 생성 탭 추가"
```

---

### Task 11: 프론트엔드 빌드 + 통합 테스트

- [ ] **Step 1: 프론트엔드 빌드**

```bash
cd frontend && npm run build
```

빌드 에러 있으면 수정.

- [ ] **Step 2: 전체 서버 시작 테스트**

```bash
cd backend && python main.py
```

`http://127.0.0.1:8000` 접속하여:
1. 생성 탭에 "스크립트 생성" 탭이 보이는지 확인
2. 정제 탭에서 auto-process 시작 가능한지 확인

- [ ] **Step 3: Commit (빌드 결과)**

```bash
git add frontend/dist/
git commit -m "build: 프론트엔드 빌드 — 스토리 생성 UI 포함"
```
