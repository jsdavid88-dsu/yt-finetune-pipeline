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
