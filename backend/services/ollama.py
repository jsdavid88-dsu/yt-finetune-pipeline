"""Ollama API client using httpx (async)."""

from __future__ import annotations

from typing import Any, AsyncIterator, Optional

import httpx

OLLAMA_BASE = "http://localhost:11434"
TIMEOUT = httpx.Timeout(connect=10.0, read=600.0, write=10.0, pool=10.0)


async def list_models() -> list[dict[str, Any]]:
    """GET /api/tags - list locally available Ollama models."""
    async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
        resp = await client.get("/api/tags")
        resp.raise_for_status()
        data = resp.json()
        return data.get("models", [])


async def generate(
    model: str,
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str:
    """Non-streaming generation. Returns the full response text."""
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }
    if system:
        payload["system"] = system

    async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
        resp = await client.post("/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "")


async def generate_stream(
    model: str,
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> AsyncIterator[str]:
    """Streaming generation. Yields response token chunks."""
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }
    if system:
        payload["system"] = system

    async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
        async with client.stream("POST", "/api/generate", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                import json as _json
                try:
                    chunk = _json.loads(line)
                except _json.JSONDecodeError:
                    continue
                token = chunk.get("response", "")
                if token:
                    yield token
                if chunk.get("done"):
                    break


async def chat(
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.7,
    max_tokens: int = 2048,
    stream: bool = False,
) -> str | AsyncIterator[str]:
    """Chat endpoint wrapper. Returns full text or async iterator."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }

    if not stream:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
            resp = await client.post("/api/chat", json=payload)
            resp.raise_for_status()
            return resp.json().get("message", {}).get("content", "")

    async def _stream() -> AsyncIterator[str]:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE, timeout=TIMEOUT) as client:
            async with client.stream("POST", "/api/chat", json=payload) as resp:
                resp.raise_for_status()
                import json as _json
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = _json.loads(line)
                    except _json.JSONDecodeError:
                        continue
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                    if chunk.get("done"):
                        break

    return _stream()
