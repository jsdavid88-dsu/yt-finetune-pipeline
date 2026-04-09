"""Refine service: chunk text, tag with Ollama, build JSONL lines."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

import httpx

OLLAMA_BASE = "http://localhost:11434"
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)

DEFAULT_TAGS = {
    "genre": "미분류",
    "topic": "미분류",
    "mood": "미분류",
    "scene_type": "미분류",
}

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


def is_korean_text(text: str, threshold: float = 0.3) -> bool:
    """Check if text is predominantly Korean (at least threshold ratio of Korean chars)."""
    if not text.strip():
        return False
    korean_count = sum(1 for c in text if '\uac00' <= c <= '\ud7a3' or '\u3131' <= c <= '\u3163')
    alpha_count = sum(1 for c in text if c.isalpha())
    if alpha_count == 0:
        return False
    return (korean_count / alpha_count) >= threshold


# ---------------------------------------------------------------------------
# 1. chunk_text
# ---------------------------------------------------------------------------

def chunk_text(text: str, chunk_size: int = 1500) -> list[str]:
    """Split *text* into chunks.

    - Split on 2+ consecutive blank lines first.
    - Sub-split paragraphs exceeding *chunk_size* at sentence boundaries.
    - Drop empty chunks.
    """
    raw_paragraphs = re.split(r"\n\s*\n", text.strip())
    chunks: list[str] = []

    for para in raw_paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para) <= chunk_size:
            chunks.append(para)
        else:
            _split_long(para, chunk_size, chunks)

    return chunks


def _split_long(text: str, max_len: int, out: list[str]) -> None:
    """Split a long block at sentence boundaries."""
    # Korean + English sentence endings
    sent_end = re.compile(r"(?<=[.!?。])\s+|(?<=[다요죠네까])[.\s]+")

    sentences = sent_end.split(text)
    buf = ""
    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
        candidate = (buf + " " + sent).strip() if buf else sent
        if len(candidate) <= max_len:
            buf = candidate
        else:
            if buf:
                out.append(buf)
            # Force-split if single sentence exceeds max_len
            if len(sent) > max_len:
                while len(sent) > max_len:
                    out.append(sent[:max_len])
                    sent = sent[max_len:]
                buf = sent
            else:
                buf = sent
    if buf:
        out.append(buf)


# ---------------------------------------------------------------------------
# 2. tag_chunk
# ---------------------------------------------------------------------------

async def tag_chunk(chunk: str, model: str = "gemma4", max_retries: int = 3, prompt_template: str | None = None) -> dict:
    """Call Ollama to tag a chunk. Returns {genre, topic, mood, scene_type}."""
    if prompt_template:
        prompt = f"{prompt_template}\n\n텍스트:\n{chunk}"
    else:
        prompt = (
            "다음 텍스트를 분석하고 반드시 JSON만 응답해. "
            "키: genre, topic, mood, scene_type\n\n"
            f"텍스트:\n{chunk}"
        )

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 512},
        "format": "json",
    }

    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
                resp = await client.post("/api/generate", json=payload)
                resp.raise_for_status()
                raw_response = resp.json().get("response", "{}")

            tags = _extract_json(raw_response)
            result = {
                "genre": tags.get("genre", "미분류"),
                "topic": tags.get("topic", "미분류"),
                "mood": tags.get("mood", "미분류"),
                "scene_type": tags.get("scene_type", "미분류"),
            }
            # Success if at least one tag has a non-default value
            if any(v != "미분류" for v in result.values()):
                return result
        except httpx.ConnectError:
            raise RuntimeError("Ollama 서버에 연결할 수 없습니다. localhost:11434에서 Ollama가 실행 중인지 확인하세요.")
        except Exception:
            pass  # will retry

        if attempt < max_retries - 1:
            await asyncio.sleep(1)

    return dict(DEFAULT_TAGS)


def _extract_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from LLM output."""
    text = text.strip()
    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try ```json ... ``` block
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # Find first { ... }
    m = re.search(r"\{[^{}]*\}", text)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return {}


# ---------------------------------------------------------------------------
# 2b. correct_chunk (Pass 1: STT correction)
# ---------------------------------------------------------------------------

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
            if len(corrected) < len(text) * 0.5:
                return text
            return corrected
    except Exception:
        return text


# ---------------------------------------------------------------------------
# 2c. analyze_chunk (Pass 2: detailed analysis)
# ---------------------------------------------------------------------------

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
        for key, default in DEFAULT_ANALYSIS.items():
            if key not in result:
                result[key] = default
        return result
    except Exception:
        return dict(DEFAULT_ANALYSIS)


# ---------------------------------------------------------------------------
# 3. build_jsonl_line
# ---------------------------------------------------------------------------

def build_jsonl_line(chunk: str, tags: dict) -> str:
    """Build a single JSONL line for fine-tuning."""
    entry = {
        "instruction": (
            f"장르: {tags.get('genre', '미분류')} / "
            f"주제: {tags.get('topic', '미분류')} / "
            f"분위기: {tags.get('mood', '미분류')} / "
            f"장면: {tags.get('scene_type', '미분류')} "
            "스타일로 이야기를 써줘"
        ),
        "input": "",
        "output": chunk,
    }
    return json.dumps(entry, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 4. Episode-level processing (hierarchical data)
# ---------------------------------------------------------------------------

async def summarize_episode(episode_text: str, title: str, model: str = "gemma4") -> dict:
    """Call Ollama to generate episode summary and scene list."""
    prompt = (
        "다음은 하나의 에피소드 전체 텍스트야. 분석해서 반드시 JSON만 응답해.\n"
        "키:\n"
        "- summary: 전체 줄거리 요약 (3~5문장)\n"
        "- genre: 장르\n"
        "- theme: 핵심 주제\n"
        "- scenes: 장면 목록 (배열, 각 항목은 {순서번호, 장면설명, 분위기} 객체)\n\n"
        f"에피소드 제목: {title}\n\n"
        f"텍스트:\n{episode_text[:6000]}"  # Limit to avoid token overflow
    )

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 2048},
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
            resp = await client.post("/api/generate", json=payload)
            resp.raise_for_status()
            raw_response = resp.json().get("response", "{}")
        return _extract_json(raw_response)
    except Exception:
        return {"summary": "", "genre": "미분류", "theme": "미분류", "scenes": []}


def build_hierarchical_jsonl(
    episode_title: str,
    episode_summary: dict,
    chunks: list[dict],
) -> list[str]:
    """Build multi-level JSONL lines for an episode.

    Returns 3 levels of training data:
    - Level 1: Episode summary → full outline
    - Level 2: Scene-level with position markers
    - Level 3: Chunk-level with tags (existing format)
    """
    lines: list[str] = []
    genre = episode_summary.get("genre", "미분류")
    theme = episode_summary.get("theme", "미분류")
    summary_text = episode_summary.get("summary", "")
    scenes = episode_summary.get("scenes", [])

    total_chunks = len(chunks)

    # Level 1: Episode summary → outline
    if summary_text and scenes:
        scene_outline = " → ".join(
            f"[{s.get('순서번호', i+1)}] {s.get('장면설명', '')}"
            for i, s in enumerate(scenes)
        )
        lines.append(json.dumps({
            "instruction": f"장르: {genre} / 주제: {theme}\n전체 에피소드의 줄거리와 흐름을 써줘",
            "input": "",
            "output": f"줄거리: {summary_text}\n\n흐름: {scene_outline}",
        }, ensure_ascii=False))

    # Level 2: Scene-level chunks with position
    for i, chunk_data in enumerate(chunks):
        text = chunk_data.get("text", "")
        position = "도입" if i < total_chunks * 0.2 else "전개" if i < total_chunks * 0.7 else "절정" if i < total_chunks * 0.9 else "결말"

        lines.append(json.dumps({
            "instruction": (
                f"장르: {genre} / 주제: {theme} / "
                f"에피소드: {episode_title} / "
                f"장면 {i+1}/{total_chunks} ({position})\n"
                f"이 장면을 써줘"
            ),
            "input": "",
            "output": text,
        }, ensure_ascii=False))

    # Level 3: Chunk-level with tags (existing format)
    for chunk_data in chunks:
        text = chunk_data.get("text", "")
        tags = chunk_data.get("tags", {})
        lines.append(json.dumps({
            "instruction": (
                f"장르: {tags.get('genre', '미분류')} / "
                f"주제: {tags.get('topic', '미분류')} / "
                f"분위기: {tags.get('mood', '미분류')} / "
                f"장면: {tags.get('scene_type', '미분류')} "
                "스타일로 이야기를 써줘"
            ),
            "input": "",
            "output": text,
        }, ensure_ascii=False))

    return lines


# ---------------------------------------------------------------------------
# 5. 4-Task JSONL builder (v2)
# ---------------------------------------------------------------------------

def _get_position(index: int, total: int) -> str:
    ratio = index / total if total > 0 else 0
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
    content_chunks = [
        c for c in chunks
        if c.get("analysis", {}).get("is_content", True)
    ]
    if not content_chunks:
        return [], {}

    total = len(content_chunks)
    genre = content_chunks[0].get("analysis", {}).get("genre", "미분류")
    lines: list[str] = []

    # Build outline scenes
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
        "instruction": (
            f"장르: {genre} / 제목: {episode_title[:60]}\n"
            "1시간 분량 스크립트의 전체 아웃라인을 작성해줘"
        ),
        "input": "",
        "output": outline_text,
    }, ensure_ascii=False))

    # --- Task 2: Scene expansion with context ---
    for i, c in enumerate(content_chunks):
        a = c.get("analysis", {})
        text = c.get("corrected_text") or c.get("text", "")

        prev_start = max(0, i - 5)
        prev_flow = " → ".join(
            f"[{j+1}] {content_chunks[j].get('analysis', {}).get('core_event', '')[:60]}"
            for j in range(prev_start, i)
        )
        prev_input = (
            _tail(content_chunks[i - 1].get("corrected_text") or content_chunks[i - 1].get("text", ""))
            if i > 0 else ""
        )

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

    # --- Task 3: Continuation (adjacent content pairs) ---
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
