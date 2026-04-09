"""YouTube subtitle extraction service using yt-dlp Python API."""

from __future__ import annotations

import asyncio
import html
import re
from typing import Optional

import yt_dlp


# ---------------------------------------------------------------------------
# Subtitle language preference (descending priority)
# ---------------------------------------------------------------------------
LANG_PREF = [
    ("ko", False),   # manual Korean
    ("ko", True),    # auto Korean
    ("en", False),   # manual English
    ("en", True),    # auto English
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pick_subtitle(info: dict) -> Optional[tuple[str, str]]:
    """Return (lang_key, url) for the best subtitle track, or None."""
    subs: dict = info.get("subtitles") or {}
    auto_subs: dict = info.get("automatic_captions") or {}

    for lang, is_auto in LANG_PREF:
        source = auto_subs if is_auto else subs
        if lang in source:
            formats = source[lang]
            # prefer vtt, then srt, then first available
            for fmt_name in ("vtt", "srt"):
                for f in formats:
                    if f.get("ext") == fmt_name:
                        return (lang, f["url"])
            if formats:
                return (lang, formats[0]["url"])
    # fallback: any manual sub, then any auto sub
    for source in (subs, auto_subs):
        for lang_key, formats in source.items():
            if formats:
                for fmt_name in ("vtt", "srt"):
                    for f in formats:
                        if f.get("ext") == fmt_name:
                            return (lang_key, f["url"])
                return (lang_key, formats[0]["url"])
    return None


def _clean_subtitle_text(raw: str) -> str:
    """Strip timestamps, HTML tags, metadata lines and deduplicate consecutive lines."""
    # Remove VTT header lines
    lines = raw.splitlines()
    cleaned: list[str] = []
    for line in lines:
        line = line.strip()
        # skip WEBVTT header, Kind/Language metadata, cue id lines (numeric only)
        if not line:
            continue
        if line.startswith("WEBVTT"):
            continue
        if line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if re.match(r"^\d+$", line):
            continue
        # skip SRT / VTT timestamp lines
        if re.match(r"\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->", line):
            continue
        # strip HTML tags
        line = re.sub(r"<[^>]+>", "", line)
        # strip [Music], [Applause], etc.
        line = re.sub(r"\[.*?\]", "", line).strip()
        # unescape HTML entities
        line = html.unescape(line)
        if not line:
            continue
        cleaned.append(line)

    # deduplicate consecutive identical lines
    deduped: list[str] = []
    for line in cleaned:
        if not deduped or line != deduped[-1]:
            deduped.append(line)
    return "\n".join(deduped)


# ---------------------------------------------------------------------------
# yt-dlp wrappers (run in thread to keep async)
# ---------------------------------------------------------------------------

def _extract_info(url: str, *, playlist: bool = True) -> dict:
    """Extract info dict(s) using yt-dlp. Does NOT download media."""
    ydl_opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitlesformat": "vtt",
        "ignoreerrors": True,
        "sleep_interval": 1,
        "max_sleep_interval": 3,
    }
    if not playlist:
        ydl_opts["noplaylist"] = True

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(url, download=False)


def _download_subtitle_text(url: str) -> str:
    """Download a subtitle file from URL and return raw text."""
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


async def extract_info_async(url: str, *, playlist: bool = True) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _extract_info(url, playlist=playlist))


async def download_subtitle_async(url: str) -> str:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _download_subtitle_text, url)


# ---------------------------------------------------------------------------
# High-level API
# ---------------------------------------------------------------------------

def _extract_flat(url: str) -> list[dict]:
    """Fast extraction — gets only video IDs, titles, view counts. No subtitle info."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "ignoreerrors": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info is None:
        return []
    if info.get("_type") == "playlist" or "entries" in info:
        return [e for e in (info.get("entries") or []) if e is not None]
    return [info]


async def get_video_entries(url: str) -> list[dict]:
    """Return a list of video info dicts (flat/fast mode for playlists)."""
    loop = asyncio.get_event_loop()
    entries = await loop.run_in_executor(None, lambda: _extract_flat(url))
    return entries


async def get_video_full_info(video_id: str) -> dict | None:
    """Get full info for a single video (including subtitles)."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        return await extract_info_async(url, playlist=False)
    except Exception:
        return None


async def extract_subtitle_for_video(info: dict) -> tuple[Optional[str], Optional[str]]:
    """Try to extract subtitle text for a single video.

    Returns (text, route) where route is 'subtitle', 'stt', or None if unavailable.
    """
    # Route A: Subtitles (prefer native subs)
    pick = _pick_subtitle(info)
    if pick is not None:
        _lang, sub_url = pick
        raw = await download_subtitle_async(sub_url)
        text = _clean_subtitle_text(raw)
        return text, "subtitle"

    # Route B: STT fallback via VibeVoice-ASR
    video_id = info.get("id", "")
    video_url = info.get("webpage_url") or info.get("url", "")
    if video_url:
        try:
            from services.stt_service import transcribe_video
            text = await transcribe_video(video_url, video_id)
            if text:
                return text, "stt"
        except Exception:
            pass

    return None, None
