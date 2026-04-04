"""Phase 3 - Fine-tuning router (placeholder)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from models.schemas import TrainConfig, TrainStartRequest

router = APIRouter(prefix="/api/train", tags=["train"])

BASE_MODELS = [
    {"id": "unsloth/llama-3-8b-bnb-4bit", "name": "LLaMA 3 8B (4-bit)", "params": "8B"},
    {"id": "unsloth/mistral-7b-bnb-4bit", "name": "Mistral 7B (4-bit)", "params": "7B"},
    {"id": "unsloth/gemma-2b-bnb-4bit", "name": "Gemma 2B (4-bit)", "params": "2B"},
    {"id": "unsloth/phi-3-mini-4k-instruct-bnb-4bit", "name": "Phi-3 Mini (4-bit)", "params": "3.8B"},
    {"id": "unsloth/qwen2-7b-bnb-4bit", "name": "Qwen2 7B (4-bit)", "params": "7B"},
]

# Fake in-memory job store
_train_jobs: dict[str, dict] = {}


@router.get("/models")
async def list_models():
    return BASE_MODELS


@router.post("/start")
async def start_training(req: TrainStartRequest):
    job_id = uuid.uuid4().hex[:12]
    _train_jobs[job_id] = {
        "job_id": job_id,
        "project_id": req.project_id,
        "base_model": req.base_model,
        "status": "running",
        "progress": 0,
        "epoch": 0,
        "total_epochs": req.config.get("num_epochs", 3),
        "loss": None,
    }
    return {"job_id": job_id, "status": "running", "message": "Training started (placeholder)."}


@router.get("/status/{job_id}")
async def training_status(job_id: str):
    job = _train_jobs.get(job_id)
    if not job:
        # return a fake completed job rather than 404 for placeholder purposes
        return {
            "job_id": job_id,
            "status": "completed",
            "progress": 100,
            "epoch": 3,
            "total_epochs": 3,
            "loss": 0.42,
            "message": "Placeholder: training would be done.",
        }
    # simulate progress bump
    if job["progress"] < 100:
        job["progress"] = min(job["progress"] + 10, 100)
        job["epoch"] = int(job["total_epochs"] * job["progress"] / 100)
        job["loss"] = round(2.5 - (job["progress"] / 100) * 2.0, 4)
    if job["progress"] >= 100:
        job["status"] = "completed"
    return job


@router.get("/config")
async def default_config():
    return TrainConfig().model_dump()
