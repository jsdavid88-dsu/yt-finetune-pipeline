"""OCR service placeholder for Route B (video frame extraction + OCR)."""

from __future__ import annotations


async def extract_text_from_video(video_path: str) -> str:
    """Placeholder: extract on-screen text from video frames via OCR.

    Route B flow:
    1. Use ffmpeg to detect scene changes
    2. Extract key frames at scene boundaries
    3. Run OCR (e.g., Tesseract or PaddleOCR) on each frame
    4. Aggregate and deduplicate text

    This is not yet implemented.
    """
    raise NotImplementedError(
        "OCR-based text extraction (Route B) is not yet implemented. "
        "Please use videos that have subtitles available."
    )
