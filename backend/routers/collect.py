"""Phase 1 - YouTube data collection router."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
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
from services.youtube import extract_subtitle_for_video, get_video_entries, get_video_full_info

logger = logging.getLogger("storyforge.collect")

router = APIRouter(prefix="/api/collect", tags=["collect"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# In-memory job store (keyed by job_id)
_jobs: dict[str, CollectJob] = {}

# Track projects with a running collection to prevent concurrent runs
_running_projects: set[str] = set()

# Track cancelled jobs
_cancelled_jobs: set[str] = set()

# Delay between video requests (seconds) to avoid YouTube rate limiting
_COLLECT_DELAY = 2.0
_RATE_LIMIT_WAIT = 60

_JOB_TTL = 3600
_JOB_MAX = 100


def _cleanup_jobs() -> None:
    now = time.time()
    expired = [
        jid for jid, j in _jobs.items()
        if j.status in (JobStatus.completed, JobStatus.failed)
        and hasattr(j, "_finished_at")
        and now - j._finished_at > _JOB_TTL
    ]
    for jid in expired:
        del _jobs[jid]
    while len(_jobs) > _JOB_MAX:
        finished = [
            (jid, getattr(j, "_finished_at", float("inf")))
            for jid, j in _jobs.items()
            if j.status in (JobStatus.completed, JobStatus.failed)
        ]
        if not finished:
            break
        oldest_id = min(finished, key=lambda x: x[1])[0]
        del _jobs[oldest_id]


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
# Video list management (saved to project dir)
# ---------------------------------------------------------------------------

def _load_video_list(project_dir: Path) -> list[dict]:
    """Load the full video list (flat metadata) for a project."""
    vlist_path = project_dir / "video_list.json"
    if not vlist_path.exists():
        return []
    with open(vlist_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_video_list(project_dir: Path, video_list: list[dict]) -> None:
    """Save the full video list."""
    with open(project_dir / "video_list.json", "w", encoding="utf-8") as f:
        json.dump(video_list, f, ensure_ascii=False, indent=2)


def _load_collected_ids(project_dir: Path) -> set[str]:
    """Get IDs of already collected videos."""
    videos_path = project_dir / "videos.json"
    if not videos_path.exists():
        return set()
    with open(videos_path, "r", encoding="utf-8") as f:
        return {v["video_id"] for v in json.load(f)}


# ---------------------------------------------------------------------------
# Background task: process collection job
# ---------------------------------------------------------------------------

async def _run_collect_job(job: CollectJob, top_percent: int | None = None, max_count: int | None = None) -> None:
    job.status = JobStatus.running
    try:
        project_dir = _ensure_project_dir(job.project_id)

        # --- Step 1: Get or load video list (flat, fast) ---
        video_list = _load_video_list(project_dir)

        if not video_list:
            logger.info(f"[수집] 영상 목록 가져오는 중...")
            urls = [u.strip() for u in job.url.split('\n') if u.strip()]
            for single_url in urls:
                try:
                    result = await get_video_entries(single_url)
                    if result:
                        video_list.extend(result)
                except Exception:
                    pass

            if not video_list:
                job.status = JobStatus.failed
                job._finished_at = time.time()
                job.error = "영상 목록을 가져올 수 없습니다."
                return

            # Save full list
            _save_video_list(project_dir, video_list)
            logger.info(f"[수집] 영상 목록 {len(video_list)}개 저장 완료")

        # --- Step 2: Filter ---
        entries = list(video_list)

        if top_percent and 0 < top_percent < 100 and len(entries) > 1:
            entries.sort(key=lambda e: e.get("view_count", 0) or 0, reverse=True)
            cutoff = max(1, len(entries) * top_percent // 100)
            entries = entries[:cutoff]

        # --- Step 3: Skip already collected ---
        collected_ids = _load_collected_ids(project_dir)
        uncollected = [e for e in entries if e.get("id", "") not in collected_ids]

        if not uncollected:
            logger.info(f"[수집] 모든 영상이 이미 수집됨")
            job.status = JobStatus.completed
            job._finished_at = time.time()
            return

        # Apply max_count to uncollected only
        if max_count and max_count > 0:
            uncollected = uncollected[:max_count]

        logger.info(f"[수집] {len(uncollected)}개 영상 수집 시작 (전체: {len(video_list)}, 이미 수집: {len(collected_ids)})")

        # Populate job video list
        job.videos = [
            VideoInfo(
                video_id=e.get("id", f"unknown_{i}"),
                title=e.get("title", "Untitled"),
                view_count=e.get("view_count", 0) or 0,
                duration=e.get("duration", 0) or 0,
                status=VideoStatus.waiting,
            )
            for i, e in enumerate(uncollected)
        ]
        job.total = len(uncollected)

        # Load existing videos.json for incremental save
        videos_json_path = project_dir / "videos.json"
        raw_path = project_dir / "raw.txt"
        existing_videos: list[dict[str, Any]] = []
        if videos_json_path.exists():
            with open(videos_json_path, "r", encoding="utf-8") as f:
                existing_videos = json.load(f)

        # --- Step 4: Collect subtitles one by one ---
        for idx, entry in enumerate(uncollected):
            if job.job_id in _cancelled_jobs:
                _cancelled_jobs.discard(job.job_id)
                job.status = JobStatus.failed
                job._finished_at = time.time()
                job.error = f"사용자가 수집을 중지했습니다. ({idx}/{len(uncollected)} 완료)"
                return

            vid = job.videos[idx]
            vid.status = VideoStatus.processing
            logger.info(f"[수집] {idx+1}/{len(uncollected)} 처리 중: {vid.title[:50]}")

            try:
                full_entry = await get_video_full_info(vid.video_id)
                if full_entry is None:
                    full_entry = entry
                text, route = await extract_subtitle_for_video(full_entry)
                if text:
                    vid.text = text
                    vid.route = SubtitleRoute(route)
                    vid.status = VideoStatus.done
                else:
                    vid.status = VideoStatus.error
                    vid.error = "자막 없음"
            except Exception as exc:
                error_msg = str(exc)
                if "rate-limit" in error_msg.lower() or "rate_limit" in error_msg.lower() or "try again later" in error_msg.lower():
                    vid.error = f"Rate limited, {_RATE_LIMIT_WAIT}초 대기 후 재시도..."
                    logger.info(f"[수집] Rate limit 감지, {_RATE_LIMIT_WAIT}초 대기...")
                    await asyncio.sleep(_RATE_LIMIT_WAIT)
                    try:
                        full_entry2 = await get_video_full_info(vid.video_id)
                        text, route = await extract_subtitle_for_video(full_entry2 or entry)
                        if text:
                            vid.text = text
                            vid.route = SubtitleRoute(route)
                            vid.status = VideoStatus.done
                            vid.error = None
                        else:
                            vid.status = VideoStatus.error
                            vid.error = "재시도 후에도 자막 없음"
                    except Exception as exc2:
                        vid.status = VideoStatus.error
                        vid.error = f"재시도 실패: {exc2}"
                else:
                    vid.status = VideoStatus.error
                    vid.error = error_msg

            # Incremental save
            if vid.status == VideoStatus.done and vid.text and vid.text != "(already collected)":
                video_block = f"--- VIDEO: {vid.title} ---\n{vid.text}\n--- END VIDEO ---"
                with open(raw_path, "a", encoding="utf-8") as f:
                    prefix = "\n\n" if raw_path.stat().st_size > 0 else ""
                    f.write(prefix + video_block)

                existing_videos.append(vid.model_dump())
                videos_json_path.write_text(
                    json.dumps(existing_videos, ensure_ascii=False, indent=2), encoding="utf-8"
                )

            job.processed = idx + 1

            # Delay between requests
            if idx < len(uncollected) - 1:
                await asyncio.sleep(_COLLECT_DELAY)

        job.status = JobStatus.completed
        job._finished_at = time.time()

        done_count = len([v for v in job.videos if v.status == VideoStatus.done])
        remaining = len(video_list) - len(collected_ids) - done_count
        logger.info(f"[수집] 완료: {done_count}개 수집, 남은 영상: {remaining}개")

    except Exception as exc:
        job.status = JobStatus.failed
        job._finished_at = time.time()
        job.error = str(exc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/playlist-info")
async def playlist_info(req: CollectRequest):
    """Get video list with view counts from a URL without starting collection."""
    try:
        entries = await get_video_entries(req.url)
        videos = [
            {
                "video_id": e.get("id", ""),
                "title": e.get("title", "Untitled"),
                "view_count": e.get("view_count", 0) or 0,
                "duration": e.get("duration", 0) or 0,
            }
            for e in (entries or [])
        ]
        videos.sort(key=lambda v: v["view_count"], reverse=True)

        # Also save the list to project dir for later use
        if req.project_id:
            project_dir = _ensure_project_dir(req.project_id)
            _save_video_list(project_dir, entries)

        return {"count": len(videos), "videos": videos}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/start")
async def start_collection(req: CollectRequest):
    projects = _load_projects()
    if not any(p["id"] == req.project_id for p in projects):
        raise HTTPException(status_code=404, detail="Project not found")

    if req.project_id in _running_projects:
        raise HTTPException(status_code=409, detail="Collection already running for this project")

    _cleanup_jobs()
    job = CollectJob(project_id=req.project_id, url=req.url)
    _jobs[job.job_id] = job
    _running_projects.add(req.project_id)

    async def _guarded_collect(j: CollectJob, pct: int | None, mc: int | None) -> None:
        try:
            await _run_collect_job(j, top_percent=pct, max_count=mc)
        finally:
            _running_projects.discard(j.project_id)

    asyncio.create_task(_guarded_collect(job, req.top_percent, req.max_count))
    return {"job_id": job.job_id, "status": job.status}


@router.post("/stop/{job_id}")
async def stop_collection(job_id: str):
    """Cancel a running collection job."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.running:
        return {"status": "not_running"}
    _cancelled_jobs.add(job_id)
    return {"status": "stopping"}


@router.get("/status/{job_id}")
async def collection_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.job_id,
        "status": job.status,
        "total_videos": len(job.videos),
        "processed": getattr(job, 'processed', 0),
        "videos": [
            {
                "video_id": v.video_id,
                "title": v.title,
                "status": v.status,
                "route": v.route,
                "text": v.text[:200] if v.text else "",
                "error": v.error,
            }
            for v in job.videos
        ],
        "error": job.error if hasattr(job, 'error') else None,
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


@router.get("/video-list/{project_id}")
async def get_video_list(project_id: str):
    """Get saved video list (flat metadata) for a project."""
    project_dir = DATA_DIR / project_id
    video_list = _load_video_list(project_dir) if project_dir.exists() else []
    collected_ids = _load_collected_ids(project_dir) if project_dir.exists() else set()
    return {
        "total": len(video_list),
        "collected": len(collected_ids),
        "remaining": len(video_list) - len(collected_ids),
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


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete a project and all its data."""
    projects = _load_projects()
    if not any(p["id"] == project_id for p in projects):
        raise HTTPException(status_code=404, detail="Project not found")
    projects = [p for p in projects if p["id"] != project_id]
    _save_projects(projects)
    project_dir = DATA_DIR / project_id
    if project_dir.exists():
        import shutil
        shutil.rmtree(project_dir, ignore_errors=True)
    return {"status": "deleted"}


@router.get("/presets")
async def list_presets():
    """Return available project presets."""
    return DEFAULT_PRESETS


@router.get("/video-count/{project_id}")
async def get_video_count(project_id: str):
    proj = DATA_DIR / project_id / "videos.json"
    if not proj.exists():
        return {"count": 0}
    with open(proj, "r", encoding="utf-8") as f:
        videos = json.load(f)
    return {"count": len(videos)}


@router.get("/videos/{project_id}")
async def get_videos(project_id: str):
    """Return all collected videos for a project."""
    proj = DATA_DIR / project_id / "videos.json"
    if not proj.exists():
        return {"videos": []}
    with open(proj, "r", encoding="utf-8") as f:
        videos = json.load(f)
    return {"videos": videos}
