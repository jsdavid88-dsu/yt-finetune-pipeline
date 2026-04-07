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
    top_percent: Optional[int] = None  # None=전체, 10=상위10%, 25=상위25% 등
    max_count: Optional[int] = None    # None=전체, 100=최대100개


class VideoInfo(BaseModel):
    video_id: str
    title: str = ""
    view_count: int = 0
    duration: int = 0
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
    description: str = ""
    tag_prompt: str = "다음 텍스트를 분석하고 반드시 JSON만 응답해. 키: genre, topic, mood, scene_type"
    tag_model: str = "gemma4"
    chunk_size: int = 1500
    jsonl_template: str = "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘"
    base_model: str = "gemma4"
    generation_prompt: str = "다음 에피소드를 이어서 써줘."


# Built-in presets
DEFAULT_PRESETS: list[dict[str, Any]] = [
    {
        "name": "막장드라마",
        "description": "막장 드라마/실화사연 스타일",
        "tag_prompt": "이 텍스트의 장르, 주제, 분위기, 장면유형을 분류해줘. 반드시 JSON만 응답. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 1500,
        "jsonl_template": "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘",
        "base_model": "gemma4",
        "generation_prompt": "다음 설정으로 막장 드라마 스타일 이야기를 써줘: {입력}",
    },
    {
        "name": "판타지소설",
        "description": "판타지/이세계 소설 스타일",
        "tag_prompt": "이 텍스트의 장르, 주제, 분위기, 장면유형을 분류해줘. 반드시 JSON만 응답. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 2000,
        "jsonl_template": "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘",
        "base_model": "gemma4",
        "generation_prompt": "다음 설정으로 판타지 소설을 써줘: {입력}",
    },
    {
        "name": "기술문서",
        "description": "기술 블로그/문서 스타일",
        "tag_prompt": "이 텍스트의 주제, 난이도, 기술스택, 문서유형을 분류해줘. 반드시 JSON만 응답. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 2000,
        "jsonl_template": "주제: {topic} / 난이도: {mood} / 유형: {scene_type} 스타일로 기술 문서를 써줘",
        "base_model": "gemma4",
        "generation_prompt": "다음 주제로 기술 문서를 써줘: {입력}",
    },
    {
        "name": "일반",
        "description": "커스텀 용도",
        "tag_prompt": "다음 텍스트를 분석하고 반드시 JSON만 응답해. 키: genre, topic, mood, scene_type",
        "tag_model": "gemma4",
        "chunk_size": 1500,
        "jsonl_template": "장르: {genre} / 주제: {topic} / 분위기: {mood} / 장면: {scene_type} 스타일로 이야기를 써줘",
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
    chunk_size: Optional[int] = None
    model: Optional[str] = None


class ChunkTag(BaseModel):
    genre: str = ""
    topic: str = ""
    mood: str = ""
    scene_type: str = ""


class ChunkAnalysis(BaseModel):
    genre: str = "미분류"
    core_event: str = ""
    characters: list[str] = []
    emotional_arc: str = ""
    hook: str = ""
    summary: str = ""
    narrative_technique: str = ""
    is_content: bool = True


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
    base_model: str = "unsloth/gemma-4-E4B-it-unsloth-bnb-4bit"
    config: dict[str, Any] = {}


class TrainConfig(BaseModel):
    lora_r: int = 32
    lora_alpha: int = 64
    lora_dropout: float = 0.0
    learning_rate: float = 1e-4
    num_epochs: int = 2
    batch_size: int = 2
    max_seq_length: int = 4096
    gradient_accumulation_steps: int = 16
    warmup_ratio: float = 0.05
    weight_decay: float = 0.01
    eval_split: float = 0.05


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


class StoryOutlineRequest(BaseModel):
    model: str
    genre: str
    topic: str
    num_scenes: int = 12
    temperature: float = 0.7
    max_tokens: int = 2048


class StoryGenerateRequest(BaseModel):
    model: str
    genre: str
    topic: str
    outline: str  # 사용자가 확인/수정한 아웃라인
    temperature: float = 0.7
    max_tokens: int = 2048


class SceneRegenerateRequest(BaseModel):
    model: str
    genre: str
    topic: str
    outline: str
    scene_num: int
    scene_description: str
    prev_scenes: list[str] = []  # 이전 장면 텍스트들
    temperature: float = 0.7
    max_tokens: int = 2048


class StoryChatContext(BaseModel):
    phase: str                             # "outline" | "generating" | "review"
    outline: str = ""
    selected_scene: Optional[int] = None
    selected_text: Optional[str] = None
    genre: str = ""
    topic: str = ""


class StoryChatRequest(BaseModel):
    model: str
    message: str
    history: list[dict[str, str]] = []
    context: StoryChatContext
    temperature: float = 0.7


class PromptTemplate(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    name: str
    system: str = ""
    prompt: str
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
