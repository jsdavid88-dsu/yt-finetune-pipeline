"""Phase 2 - Text refinement router with auto-processing pipeline."""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from models.schemas import (
    AutoProcessRequest,
    ChunkData,
    ChunkTag,
    DEFAULT_PRESETS,
    DeduplicateRequest,
    JobStatus,
    ProjectPreset,
    RefineJob,
    RewriteRequest,
    TextSaveRequest,
    ToJsonlRequest,
)
from services.ollama import generate as ollama_generate
from services.refine import build_jsonl, chunk_text as legacy_chunk_text, tag_chunk as legacy_tag_chunk
from services.refine_service import (
    chunk_text as rs_chunk_text,
    tag_chunk as rs_tag_chunk,
    build_jsonl_line,
    summarize_episode,
    build_hierarchical_jsonl,
)

router = APIRouter(prefix="/api/refine", tags=["refine"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# In-memory job store for auto-process jobs
_refine_jobs: dict[str, RefineJob] = {}

_JOB_TTL = 3600  # seconds – remove finished jobs older than 1 hour
_JOB_MAX = 100   # hard cap on total jobs kept in memory


def _cleanup_jobs() -> None:
    """Remove completed/failed jobs older than TTL and enforce hard cap."""
    now = time.time()
    expired = [
        jid
        for jid, j in _refine_jobs.items()
        if j.status in (JobStatus.completed, JobStatus.failed)
        and hasattr(j, "_finished_at")
        and now - j._finished_at > _JOB_TTL
    ]
    for jid in expired:
        del _refine_jobs[jid]

    # Hard cap: remove oldest finished jobs first
    while len(_refine_jobs) > _JOB_MAX:
        finished = [
            (jid, getattr(j, "_finished_at", float("inf")))
            for jid, j in _refine_jobs.items()
            if j.status in (JobStatus.completed, JobStatus.failed)
        ]
        if not finished:
            break
        oldest_id = min(finished, key=lambda x: x[1])[0]
        del _refine_jobs[oldest_id]


def _project_dir(project_id: str) -> Path:
    d = DATA_DIR / project_id
    if not d.exists():
        raise HTTPException(status_code=404, detail="Project directory not found")
    return d


def _load_project_preset(project_id: str) -> dict[str, Any]:
    """Load the preset for a project from projects.json."""
    projects_path = DATA_DIR / "projects.json"
    if not projects_path.exists():
        return DEFAULT_PRESETS[-1]  # 일반

    with open(projects_path, "r", encoding="utf-8") as f:
        projects = json.load(f)

    preset_name = "일반"
    for p in projects:
        if p["id"] == project_id:
            preset_name = p.get("preset", "일반")
            break

    for preset in DEFAULT_PRESETS:
        if preset["name"] == preset_name:
            return preset

    return DEFAULT_PRESETS[-1]


# ---------------------------------------------------------------------------
# Auto-process pipeline
# ---------------------------------------------------------------------------

async def _run_auto_process(
    job: RefineJob,
    chunk_size: int | None = None,
    model: str | None = None,
) -> None:
    """Background: split episodes → chunk → tag → summarize → build hierarchical JSONL."""
    job.status = JobStatus.running
    try:
        # Load preset defaults for this project
        preset = _load_project_preset(job.project_id)
        effective_chunk_size = chunk_size if chunk_size is not None else preset.get("chunk_size", 1500)
        effective_model = model if model is not None else preset.get("tag_model", "gemma4")
        tag_prompt: str | None = preset.get("tag_prompt")

        proj_dir = DATA_DIR / job.project_id
        raw_path = proj_dir / "raw.txt"
        if not raw_path.exists():
            job.status = JobStatus.failed
            job._finished_at = time.time()
            job.error = "raw.txt 파일을 찾을 수 없습니다. 먼저 데이터를 수집하세요."
            return

        raw_text = raw_path.read_text(encoding="utf-8")
        if not raw_text.strip():
            job.status = JobStatus.failed
            job._finished_at = time.time()
            job.error = "raw.txt가 비어 있습니다."
            return

        # Split raw text into episodes by VIDEO markers
        episode_pattern = re.compile(
            r"--- VIDEO: (.+?) ---\n(.*?)(?=--- END VIDEO ---|$)",
            re.DOTALL,
        )
        episodes = episode_pattern.findall(raw_text)

        if not episodes:
            # Fallback: treat entire text as one episode
            episodes = [("전체", raw_text)]

        # First pass: chunk all episodes to determine total count
        episode_chunks_map: list[tuple[str, list[str]]] = []
        total_chunks = 0
        for ep_title, ep_text in episodes:
            ep_chunks = rs_chunk_text(ep_text.strip(), effective_chunk_size)
            episode_chunks_map.append((ep_title, ep_chunks))
            total_chunks += len(ep_chunks)

        job.total = total_chunks
        job.chunks = []

        # Step 1 & 2: For each episode, chunk → tag
        global_index = 0
        all_episode_data: list[dict] = []  # Per-episode collected data

        for ep_title, ep_chunks in episode_chunks_map:
            episode_tagged_chunks: list[dict] = []

            for chunk_text in ep_chunks:
                chunk_obj = ChunkData(index=global_index, text=chunk_text)
                job.chunks.append(chunk_obj)

                try:
                    tags = await rs_tag_chunk(chunk_obj.text, model=effective_model, prompt_template=tag_prompt)
                    chunk_obj.tags = ChunkTag(**tags)
                except RuntimeError as exc:
                    # Ollama not running
                    job.status = JobStatus.failed
                    job._finished_at = time.time()
                    job.error = str(exc)
                    return
                except Exception:
                    chunk_obj.tags = ChunkTag(
                        genre="미분류", topic="미분류", mood="미분류", scene_type="미분류"
                    )

                global_index += 1
                job.processed = global_index

                tags_dict = chunk_obj.tags.model_dump() if chunk_obj.tags else {}
                episode_tagged_chunks.append({
                    "text": chunk_obj.text,
                    "tags": tags_dict,
                })

            # Step 3: Summarize each episode (one Ollama call per episode)
            ep_full_text = "\n\n".join(ep_chunks)
            episode_summary = await summarize_episode(ep_full_text, ep_title, model=effective_model)

            all_episode_data.append({
                "title": ep_title,
                "summary": episode_summary,
                "chunks": episode_tagged_chunks,
            })

        # Step 4: Build hierarchical JSONL and chunks.json
        jsonl_lines: list[str] = []
        chunks_json: list[dict] = []
        chunk_idx = 0

        for ep_data in all_episode_data:
            # Build 3-level hierarchical JSONL for this episode
            ep_lines = build_hierarchical_jsonl(
                ep_data["title"],
                ep_data["summary"],
                ep_data["chunks"],
            )
            jsonl_lines.extend(ep_lines)

            # Build chunks.json with episode field
            for c in ep_data["chunks"]:
                chunks_json.append({
                    "index": chunk_idx,
                    "text": c["text"],
                    "tags": c["tags"],
                    "episode": ep_data["title"],
                })
                chunk_idx += 1

        # Save outputs
        proj_dir.mkdir(parents=True, exist_ok=True)

        (proj_dir / "chunks.json").write_text(
            json.dumps(chunks_json, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (proj_dir / "dataset.jsonl").write_text(
            "\n".join(jsonl_lines), encoding="utf-8"
        )

        job.status = JobStatus.completed
        job._finished_at = time.time()

    except Exception as exc:
        job.status = JobStatus.failed
        job._finished_at = time.time()
        job.error = str(exc)


@router.post("/auto-process")
async def auto_process(req: AutoProcessRequest):
    """Start the auto-process pipeline: chunk → tag → JSONL."""
    proj_dir = DATA_DIR / req.project_id
    if not proj_dir.exists():
        raise HTTPException(status_code=404, detail="Project directory not found")

    _cleanup_jobs()
    job = RefineJob(project_id=req.project_id)
    _refine_jobs[job.job_id] = job

    asyncio.create_task(
        _run_auto_process(job, chunk_size=req.chunk_size, model=req.model)  # None = use preset
    )

    return {"job_id": job.job_id, "status": job.status}


@router.get("/auto-status/{job_id}")
async def auto_status(job_id: str):
    """Get auto-process job progress."""
    job = _refine_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Current chunk preview
    current_chunk_preview = None
    if job.chunks and 0 < job.processed <= len(job.chunks):
        last = job.chunks[job.processed - 1].text
        current_chunk_preview = last[:200] if len(last) > 200 else last

    return {
        "job_id": job.job_id,
        "status": job.status,
        "total": job.total,
        "processed": job.processed,
        "current_chunk_preview": current_chunk_preview,
        "error": job.error,
    }


@router.get("/chunks/{project_id}")
async def get_chunks(project_id: str):
    """Return chunked and tagged data for a project."""
    proj_dir = _project_dir(project_id)
    chunks_path = proj_dir / "chunks.json"
    if not chunks_path.exists():
        return {"chunks": []}
    with open(chunks_path, "r", encoding="utf-8") as f:
        chunks = json.load(f)
    return {"chunks": chunks}


@router.get("/jsonl/{project_id}")
async def get_jsonl(project_id: str):
    """Return generated JSONL for a project."""
    proj_dir = _project_dir(project_id)
    jsonl_path = proj_dir / "dataset.jsonl"
    if not jsonl_path.exists():
        return {"jsonl": "", "count": 0}
    content = jsonl_path.read_text(encoding="utf-8")
    count = len([l for l in content.strip().splitlines() if l.strip()])
    return {"jsonl": content, "count": count}


@router.put("/chunk-tag/{project_id}/{chunk_index}")
async def update_chunk_tag(project_id: str, chunk_index: int, tags: dict[str, str]):
    """Manually update tags for a specific chunk and regenerate JSONL."""
    proj_dir = _project_dir(project_id)
    chunks_path = proj_dir / "chunks.json"
    if not chunks_path.exists():
        raise HTTPException(status_code=404, detail="No chunks found")

    with open(chunks_path, "r", encoding="utf-8") as f:
        chunks = json.load(f)

    if chunk_index < 0 or chunk_index >= len(chunks):
        raise HTTPException(status_code=404, detail="Chunk index out of range")

    chunks[chunk_index]["tags"] = {
        "genre": tags.get("genre", ""),
        "topic": tags.get("topic", ""),
        "mood": tags.get("mood", ""),
        "scene_type": tags.get("scene_type", ""),
    }

    (chunks_path).write_text(
        json.dumps(chunks, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Regenerate JSONL
    preset = _load_project_preset(project_id)
    generation_prompt = preset.get("generation_prompt", "다음 에피소드를 이어서 써줘.")
    jsonl_str = build_jsonl(
        [{"text": c["text"], "tags": c.get("tags", {})} for c in chunks],
        generation_prompt,
    )
    (proj_dir / "dataset.jsonl").write_text(jsonl_str, encoding="utf-8")

    return {"ok": True, "chunk_index": chunk_index}


# ---------------------------------------------------------------------------
# Legacy endpoints (preserved)
# ---------------------------------------------------------------------------

@router.post("/deduplicate")
async def deduplicate(req: DeduplicateRequest):
    lines = req.text.splitlines()
    seen: set[str] = set()
    deduped: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if deduped and deduped[-1] != "":
                deduped.append("")
            continue
        if stripped not in seen:
            seen.add(stripped)
            deduped.append(line)

    result = "\n".join(deduped).strip()

    proj = _project_dir(req.project_id)
    (proj / "deduped.txt").write_text(result, encoding="utf-8")

    return {
        "text": result,
        "original_lines": len(lines),
        "result_lines": len(result.splitlines()),
        "removed": len(lines) - len(result.splitlines()),
    }


@router.post("/rewrite")
async def rewrite(req: RewriteRequest):
    try:
        rewritten = await ollama_generate(
            model=req.model,
            prompt=req.text,
            system=req.system_prompt,
            temperature=0.3,
            max_tokens=4096,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama request failed: {exc}. Is Ollama running on localhost:11434?",
        )

    proj = _project_dir(req.project_id)
    (proj / "rewritten.txt").write_text(rewritten, encoding="utf-8")

    return {"text": rewritten}


@router.post("/to-jsonl")
async def to_jsonl(req: ToJsonlRequest):
    paragraphs = [p.strip() for p in req.text.split("\n\n") if p.strip()]
    jsonl_lines: list[str] = []

    for para in paragraphs:
        entry = {
            "instruction": req.instruction_template,
            "input": "",
            "output": para,
        }
        jsonl_lines.append(json.dumps(entry, ensure_ascii=False))

    result = "\n".join(jsonl_lines)

    proj = _project_dir(req.project_id)
    (proj / "dataset.jsonl").write_text(result, encoding="utf-8")

    return {
        "jsonl": result,
        "count": len(jsonl_lines),
    }


@router.put("/text")
async def save_text(req: TextSaveRequest):
    proj = _project_dir(req.project_id)
    target = proj / req.filename
    if ".." in req.filename or req.filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    target.write_text(req.text, encoding="utf-8")
    return {"saved": str(target.name), "length": len(req.text)}
