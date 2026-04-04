"""Refine service: chunk text, tag with Ollama, build JSONL."""

from __future__ import annotations

import json
import re
from typing import Any, Optional

import httpx

OLLAMA_BASE = "http://localhost:11434"
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)


# ---------------------------------------------------------------------------
# 1. chunk_text – 텍스트를 단락 기준으로 쪼개기
# ---------------------------------------------------------------------------

def chunk_text(text: str, chunk_size: int = 1500) -> list[str]:
    """Split *text* into chunks by double-newline boundaries.

    Rules:
    - Split on blank lines (2+ consecutive newlines).
    - If a resulting paragraph exceeds *chunk_size* characters, split it
      further at sentence boundaries (. ! ? 다 요 죠 etc.) closest to chunk_size.
    - Never produce empty chunks.
    """
    # Split on two-or-more consecutive newlines
    raw_paragraphs = re.split(r"\n\s*\n", text.strip())
    chunks: list[str] = []

    for para in raw_paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para) <= chunk_size:
            chunks.append(para)
        else:
            # Sub-split long paragraphs at sentence boundaries
            _split_long(para, chunk_size, chunks)

    return chunks


def _split_long(text: str, max_len: int, out: list[str]) -> None:
    """Split a long text block into <=max_len pieces at sentence boundaries."""
    # Sentence-ending patterns (Korean + English)
    sentence_end = re.compile(r"[.!?。]\s+|[다요죠네까][\.\s]+|[.!?]\s*\n")

    buf = ""
    for line in text.split("\n"):
        candidate = (buf + "\n" + line).strip() if buf else line.strip()
        if len(candidate) <= max_len:
            buf = candidate
        else:
            if buf:
                out.append(buf)
            # If the single line itself exceeds max_len, force-split
            if len(line) > max_len:
                while len(line) > max_len:
                    out.append(line[:max_len])
                    line = line[max_len:]
                buf = line
            else:
                buf = line
    if buf:
        out.append(buf)


# ---------------------------------------------------------------------------
# 2. tag_chunk – Ollama로 청크 태깅
# ---------------------------------------------------------------------------

async def tag_chunk(
    chunk: str,
    tagging_prompt: str,
    model: str = "gemma4",
) -> dict[str, str]:
    """Call Ollama to tag a single chunk. Returns {genre, topic, mood, scene_type}."""
    prompt = tagging_prompt.replace("{chunk}", chunk)

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 512},
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
            resp = await client.post("/api/generate", json=payload)
            resp.raise_for_status()
            raw_response = resp.json().get("response", "{}")

        # Parse JSON from response
        tags = _extract_json(raw_response)
        return {
            "genre": tags.get("genre", ""),
            "topic": tags.get("topic", ""),
            "mood": tags.get("mood", ""),
            "scene_type": tags.get("scene_type", ""),
        }
    except Exception:
        # Return empty tags on failure rather than crashing the pipeline
        return {"genre": "", "topic": "", "mood": "", "scene_type": ""}


def _extract_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from LLM output."""
    text = text.strip()
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try to find JSON object in text
    match = re.search(r"\{[^{}]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


# ---------------------------------------------------------------------------
# 3. build_jsonl – 태깅된 청크들을 JSONL 문자열로 변환
# ---------------------------------------------------------------------------

def build_jsonl(
    chunks_with_tags: list[dict[str, Any]],
    generation_prompt: str = "다음 에피소드를 이어서 써줘.",
) -> str:
    """Convert tagged chunks into a JSONL string for fine-tuning.

    Each entry:
      {"instruction": "<generation_prompt> [태그정보]", "input": "", "output": "<chunk text>"}
    """
    lines: list[str] = []
    for item in chunks_with_tags:
        text = item.get("text", "")
        tags = item.get("tags", {})

        # Build instruction with tag context
        tag_parts = []
        if tags.get("genre"):
            tag_parts.append(f"장르: {tags['genre']}")
        if tags.get("mood"):
            tag_parts.append(f"분위기: {tags['mood']}")
        if tags.get("scene_type"):
            tag_parts.append(f"장면: {tags['scene_type']}")

        instruction = generation_prompt
        if tag_parts:
            instruction += " [" + ", ".join(tag_parts) + "]"

        entry = {
            "instruction": instruction,
            "input": "",
            "output": text,
        }
        lines.append(json.dumps(entry, ensure_ascii=False))

    return "\n".join(lines)
