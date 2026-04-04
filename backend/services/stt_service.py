"""STT service using Microsoft VibeVoice-ASR for subtitle-less videos."""

from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

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
    _model = AutoModelForSpeechSeq2Seq.from_pretrained(MODEL_ID, torch_dtype=dtype).to(device)


def _extract_audio(video_url: str, output_path: str) -> bool:
    """Use yt-dlp to download audio from a YouTube video."""
    try:
        result = subprocess.run(
            ["yt-dlp", "-x", "--audio-format", "wav", "--audio-quality", "0",
             "-o", output_path, video_url],
            capture_output=True, text=True, timeout=600,
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
    return _processor.batch_decode(generated_ids, skip_special_tokens=True)[0]


async def transcribe_video(video_url: str, video_id: str) -> Optional[str]:
    """Full pipeline: download audio -> transcribe -> return text."""
    loop = asyncio.get_event_loop()
    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = str(Path(tmpdir) / f"{video_id}.wav")
        success = await loop.run_in_executor(None, _extract_audio, video_url, audio_path)
        if not success:
            return None
        actual_files = list(Path(tmpdir).glob(f"{video_id}*"))
        if not actual_files:
            return None
        text = await loop.run_in_executor(None, _transcribe_audio, str(actual_files[0]))
        return text
