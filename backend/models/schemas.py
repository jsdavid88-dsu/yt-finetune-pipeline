from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class VideoStatus(str, Enum):
    waiting = "waiting"
    processing = "processing"
    done = "done"
    error = "error"


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class SubtitleRoute(str, Enum):
    subtitle = "subtitle"   # Route A  – subtitles available
    ocr = "ocr"             # Route B  – OCR (placeholder)
    stt = "stt"             # Route C  – Speech-to-Text


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------

class CollectRequest(BaseModel):
    url: str
    project_id: str


class VideoInfo(BaseModel):
    video_id: str
    title: str = ""
    status: VideoStatus = VideoStatus.waiting
    route: Optional[SubtitleRoute] = None
    text: str = ""
    error: Optional[str] = None


class CollectJob(BaseModel):
    job_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    project_id: str
    url: str
    status: JobStatus = JobStatus.pending
    videos: list[VideoInfo] = []
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectPreset(BaseModel):
    name: str
    genre: str = ""
    chunk_size: int = 1500
    tagging_prompt: str = (
        "다음 텍스트를 분석하고 JSON으로 응답해줘. "
        '{{"genre": "장르", "topic": "주제", "mood": "분위기", "scene_type": "장면유형"}} 형태로. '
        "텍스트: {chunk}"
    )
    jsonl_template: str = (
        '{{"instruction": "{instruction}", "input": "", "output": "{output}"}}'
    )
    base_model: str = "gemma4"
    generation_prompt: str = "다음 에피소드를 이어서 써줘."


# Built-in presets
DEFAULT_PRESETS: list[dict[str, Any]] = [
    {
        "name": "막장드라마",
        "genre": "막장드라마",
        "chunk_size": 1500,
        "tagging_prompt": (
            "다음 텍스트는 막장드라마 대본/시놉시스의 일부야. "
            "분석하고 JSON으로 응답해줘. "
            '{{"genre": "막장드라마", "topic": "주제 (예: 불륜, 복수, 출생의비밀)", '
            '"mood": "분위기 (예: 긴장, 충격, 슬픔)", '
            '"scene_type": "장면유형 (예: 대화, 독백, 갈등)"}} 형태로. '
            "텍스트: {chunk}"
        ),
        "base_model": "gemma4",
        "generation_prompt": "막장드라마 스타일로 다음 에피소드를 이어서 써줘.",
    },
    {
        "name": "판타지소설",
        "genre": "판타지소설",
        "chunk_size": 2000,
        "tagging_prompt": (
            "다음 텍스트는 판타지소설의 일부야. "
            "분석하고 JSON으로 응답해줘. "
            '{{"genre": "판타지", "topic": "주제 (예: 모험, 전투, 마법)", '
            '"mood": "분위기 (예: 긴박, 웅장, 신비)", '
            '"scene_type": "장면유형 (예: 전투씬, 대화, 여정)"}} 형태로. '
            "텍스트: {chunk}"
        ),
        "base_model": "gemma4",
        "generation_prompt": "판타지소설 스타일로 다음 장면을 이어서 써줘.",
    },
    {
        "name": "일반",
        "genre": "일반",
        "chunk_size": 1500,
        "tagging_prompt": (
            "다음 텍스트를 분석하고 JSON으로 응답해줘. "
            '{{"genre": "장르", "topic": "주제", "mood": "분위기", "scene_type": "장면유형"}} 형태로. '
            "텍스트: {chunk}"
        ),
        "base_model": "gemma4",
        "generation_prompt": "다음 에피소드를 이어서 써줘.",
    },
]


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    preset: str = "일반"


class Project(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    description: str = ""
    preset: str = "일반"
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


# ---------------------------------------------------------------------------
# Refinement
# ---------------------------------------------------------------------------

class DeduplicateRequest(BaseModel):
    project_id: str
    text: str


class RewriteRequest(BaseModel):
    project_id: str
    text: str
    model: str = "llama3"
    system_prompt: str = "You are a helpful text editor. Clean up and rewrite the following text, fixing grammar and removing artifacts while preserving the original meaning. Output only the cleaned text."


class ToJsonlRequest(BaseModel):
    project_id: str
    text: str
    instruction_template: str = "Based on the following context, respond appropriately."


class TextSaveRequest(BaseModel):
    project_id: str
    text: str
    filename: str = "refined.txt"


class AutoProcessRequest(BaseModel):
    project_id: str
    chunk_size: int = 1500
    model: str = "gemma4"


class ChunkTag(BaseModel):
    genre: str = ""
    topic: str = ""
    mood: str = ""
    scene_type: str = ""


class ChunkData(BaseModel):
    index: int
    text: str
    tags: Optional[ChunkTag] = None


class RefineJob(BaseModel):
    job_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    project_id: str
    status: JobStatus = JobStatus.pending
    total: int = 0
    processed: int = 0
    chunks: list[ChunkData] = []
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Train (placeholder)
# ---------------------------------------------------------------------------

class TrainStartRequest(BaseModel):
    project_id: str
    base_model: str = "unsloth/llama-3-8b-bnb-4bit"
    config: dict[str, Any] = {}


class TrainConfig(BaseModel):
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    learning_rate: float = 2e-4
    num_epochs: int = 3
    batch_size: int = 4
    max_seq_length: int = 2048
    gradient_accumulation_steps: int = 4


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    model: str
    prompt: str
    system: str = ""
    temperature: float = 0.7
    max_tokens: int = 2048
    stream: bool = True


class BatchGenerateRequest(BaseModel):
    model: str
    prompts: list[str]
    system: str = ""
    temperature: float = 0.7
    max_tokens: int = 2048


class ExportRequest(BaseModel):
    project_id: str
    results: list[dict[str, str]]
    format: str = "txt"  # txt or md


class PromptTemplate(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str
    system: str = ""
    prompt: str
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
