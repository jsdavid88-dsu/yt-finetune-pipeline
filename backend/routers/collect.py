"""Phase 1 - YouTube data collection router."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from models.schemas import (
    CollectJob,
    CollectRequest,
    DEFAULT_PRESETS,
    JobStatus,
    Project,
    ProjectCreate,
    SubtitleRoute,
    VideoInfo,
    VideoStatus,
)
from services.youtube import extract_subtitle_for_video, get_video_entries

router = APIRouter(prefix="/api/collect", tags=["collect"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# In-memory job store (keyed by job_id)
_jobs: dict[str, CollectJob] = {}


# ---------------------------------------------------------------------------
# Helpers – JSON-file based project persistence
# ---------------------------------------------------------------------------

def _projects_path() -> Path:
    return DATA_DIR / "projects.json"


def _load_projects() -> list[dict[str, Any]]:
    p = _projects_path()
    if not p.exists():
        return []
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_projects(projects: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_projects_path(), "w", encoding="utf-8") as f:
        json.dump(projects, f, ensure_ascii=False, indent=2)


def _ensure_project_dir(project_id: str) -> Path:
    d = DATA_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# Background task: process collection job
# ---------------------------------------------------------------------------

async def _run_collect_job(job: CollectJob) -> None:
    job.status = JobStatus.running
    try:
        entries = await get_video_entries(job.url)
        if not entries:
            job.status = JobStatus.failed
            return

        # populate video list
        job.videos = [
            VideoInfo(
                video_id=e.get("id", f"unknown_{i}"),
                title=e.get("title", "Untitled"),
                status=VideoStatus.waiting,
            )
            for i, e in enumerate(entries)
        ]

        # process each video sequentially
        for idx, entry in enumerate(entries):
            vid = job.videos[idx]
            vid.status = VideoStatus.processing
            try:
                text, route = await extract_subtitle_for_video(entry)
                if text:
                    vid.text = text
                    vid.route = SubtitleRoute(route)
                    vid.status = VideoStatus.done
                else:
                    # Route B placeholder
                    vid.route = SubtitleRoute.ocr
                    vid.status = VideoStatus.error
                    vid.error = "No subtitles available. OCR route not yet implemented."
            except Exception as exc:
                vid.status = VideoStatus.error
                vid.error = str(exc)

        # persist collected text to project directory
        project_dir = _ensure_project_dir(job.project_id)
        all_text_parts: list[str] = []
        for vid in job.videos:
            if vid.text:
                all_text_parts.append(
                    f"--- VIDEO: {vid.title} ---\n{vid.text}\n--- END VIDEO ---"
                )
        combined = "\n\n".join(all_text_parts)
        (project_dir / "raw.txt").write_text(combined, encoding="utf-8")

        # save per-video JSON
        videos_data = [v.model_dump() for v in job.videos]
        (project_dir / "videos.json").write_text(
            json.dumps(videos_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        job.status = JobStatus.completed
    except Exception as exc:
        job.status = JobStatus.failed
        # store error on first video slot if available
        if job.videos:
            job.videos[0].error = str(exc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/playlist-info")
async def playlist_info(req: CollectRequest):
    """Get video count from a URL without starting collection."""
    try:
        entries = await get_video_entries(req.url)
        videos = [
            {"video_id": e.get("id", ""), "title": e.get("title", "Untitled")}
            for e in (entries or [])
        ]
        return {"count": len(videos), "videos": videos}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/start")
async def start_collection(req: CollectRequest):
    # verify project exists
    projects = _load_projects()
    if not any(p["id"] == req.project_id for p in projects):
        raise HTTPException(status_code=404, detail="Project not found")

    job = CollectJob(project_id=req.project_id, url=req.url)
    _jobs[job.job_id] = job

    # fire and forget
    asyncio.create_task(_run_collect_job(job))

    return {"job_id": job.job_id, "status": job.status}


@router.get("/status/{job_id}")
async def collection_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.job_id,
        "status": job.status,
        "total_videos": len(job.videos),
        "videos": [
            {
                "video_id": v.video_id,
                "title": v.title,
                "status": v.status,
                "route": v.route,
                "text": v.text,
                "error": v.error,
            }
            for v in job.videos
        ],
    }


@router.get("/result/{job_id}")
async def collection_result(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.completed, JobStatus.failed):
        raise HTTPException(status_code=409, detail="Job not finished yet")
    return {
        "job_id": job.job_id,
        "status": job.status,
        "videos": [v.model_dump() for v in job.videos],
    }


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------

@router.get("/projects")
async def list_projects():
    return _load_projects()


@router.post("/projects")
async def create_project(req: ProjectCreate):
    projects = _load_projects()
    project = Project(name=req.name, description=req.description, preset=req.preset)
    _ensure_project_dir(project.id)
    data = project.model_dump()
    projects.append(data)
    _save_projects(projects)
    return data


@router.get("/presets")
async def list_presets():
    """Return available project presets."""
    return DEFAULT_PRESETS


@router.get("/video-count/{project_id}")
async def get_video_count(project_id: str):
    """Return the count of videos from a playlist URL before collecting."""
    proj = DATA_DIR / project_id / "videos.json"
    if not proj.exists():
        return {"count": 0}
    with open(proj, "r", encoding="utf-8") as f:
        videos = json.load(f)
    return {"count": len(videos)}
