"""Story generation service — chain generation pipeline.

Supports a 2-phase workflow:
  Phase 1: Generate outline → user reviews/edits
  Phase 2: Generate scenes one by one based on approved outline
"""
from __future__ import annotations

import json
import re
from typing import AsyncIterator

from services.ollama import generate as ollama_generate


# ---------------------------------------------------------------------------
# Outline parsing
# ---------------------------------------------------------------------------

def parse_outline(outline_text: str) -> list[dict]:
    """Parse generated outline into scene list.

    Expected: "장면 {N}/{total} ({position}): {description}"
    """
    scenes = []
    pattern = re.compile(
        r"장면\s+(\d+)/(\d+)\s*\(([^)]+)\)\s*:\s*(.+?)(?=\n\s*장면\s+\d+/|\Z)",
        re.DOTALL,
    )
    for m in pattern.finditer(outline_text):
        num, total, position, desc = m.groups()
        core = desc.strip().split("\n")[0].strip()
        scenes.append({
            "num": int(num),
            "total": int(total),
            "position": position.strip(),
            "description": core,
            "full_block": desc.strip(),
        })

    if not scenes:
        # Fallback: numbered lines
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

    if scenes and scenes[0]["total"] > 0:
        total = scenes[0]["total"]
        for s in scenes:
            s["total"] = total

    return scenes


# ---------------------------------------------------------------------------
# Phase 1: Outline generation
# ---------------------------------------------------------------------------

async def generate_outline(
    model: str,
    genre: str,
    topic: str,
    num_scenes: int = 12,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str:
    """Generate a story outline. Returns raw outline text for user review."""
    prompt = (
        f"장르: {genre} / 주제: {topic}\n"
        f"1시간 분량 스크립트의 전체 아웃라인을 작성해줘\n"
        f"약 {num_scenes}개 장면으로 구성하고, 각 장면마다 핵심 사건과 감정 변화를 포함해줘.\n"
        f"형식: 장면 1/{num_scenes} (도입): 설명\n  감정: ...\n  떡밥: ..."
    )

    return await ollama_generate(
        model=model,
        prompt=prompt,
        system=f"당신은 {genre} 장르의 스토리 기획자입니다.",
        temperature=temperature,
        max_tokens=max_tokens,
    )


# ---------------------------------------------------------------------------
# Phase 2: Scene-by-scene generation
# ---------------------------------------------------------------------------

async def generate_scenes(
    model: str,
    genre: str,
    topic: str,
    outline: str,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> AsyncIterator[dict]:
    """Generate scenes based on user-approved outline.

    Yields:
      {"step": "scene", "scene_num": N, "total": T, "content": "..."}
      {"step": "error", "scene_num": N, "error": "..."}
      {"step": "done", "full_text": "..."}
    """
    scenes = parse_outline(outline)
    if not scenes:
        yield {"step": "error", "scene_num": 0, "error": "아웃라인 파싱 실패"}
        return

    total = len(scenes)
    generated: list[str] = []
    summaries: list[str] = []

    for i, scene in enumerate(scenes):
        scene_text = await _generate_single_scene(
            model=model,
            genre=genre,
            topic=topic,
            scene_num=i + 1,
            total=total,
            scene_description=scene["description"],
            prev_summaries=summaries,
            prev_tail=_tail(generated[-1]) if generated else "",
            temperature=temperature,
            max_tokens=max_tokens,
        )

        if scene_text:
            generated.append(scene_text)
            summaries.append(scene_text.split("\n")[0][:80])
            yield {"step": "scene", "scene_num": i + 1, "total": total, "content": scene_text}
        else:
            yield {"step": "error", "scene_num": i + 1, "error": "생성 실패"}

    full_text = "\n\n---\n\n".join(generated)
    yield {"step": "done", "full_text": full_text}


async def regenerate_scene(
    model: str,
    genre: str,
    topic: str,
    outline: str,
    scene_num: int,
    scene_description: str,
    prev_scenes: list[str],
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str:
    """Regenerate a single scene. Returns scene text."""
    scenes = parse_outline(outline)
    total = len(scenes) if scenes else scene_num

    summaries = [s.split("\n")[0][:80] for s in prev_scenes]
    prev_tail = _tail(prev_scenes[-1]) if prev_scenes else ""

    result = await _generate_single_scene(
        model=model,
        genre=genre,
        topic=topic,
        scene_num=scene_num,
        total=total,
        scene_description=scene_description,
        prev_summaries=summaries,
        prev_tail=prev_tail,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return result or ""


# ---------------------------------------------------------------------------
# Internal
# ---------------------------------------------------------------------------

def _tail(text: str, max_chars: int = 500) -> str:
    return text[-max_chars:] if len(text) > max_chars else text


async def _generate_single_scene(
    model: str,
    genre: str,
    topic: str,
    scene_num: int,
    total: int,
    scene_description: str,
    prev_summaries: list[str],
    prev_tail: str,
    temperature: float = 0.7,
    max_tokens: int = 2048,
) -> str:
    """Generate one scene with retry."""
    start = max(0, len(prev_summaries) - 5)
    prev_flow = " → ".join(
        f"[{j+1}] {prev_summaries[j][:60]}"
        for j in range(start, len(prev_summaries))
    )

    prompt = (
        f"장르: {genre}\n"
        f"주제: {topic}\n"
        f"장면 {scene_num}/{total}\n"
        f"현재 장면: {scene_description}\n"
        + (f"이전 흐름: {prev_flow}\n" if prev_flow else "")
        + "이 장면을 써줘"
    )
    if prev_tail:
        prompt += f"\n\n[이전 장면 끝부분]\n{prev_tail}"

    for attempt in range(2):
        try:
            return await ollama_generate(
                model=model,
                prompt=prompt,
                system=f"당신은 {genre} 장르의 스토리 작가입니다. 몰입감 있는 장면을 작성하세요.",
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception:
            if attempt == 1:
                return ""
    return ""
