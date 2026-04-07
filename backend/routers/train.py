"""Phase 3 - Fine-tuning router with real Unsloth QLoRA training."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from models.schemas import TrainStartRequest
from services.train_service import check_gpu, start_training, get_progress, stop_training

router = APIRouter(prefix="/api/train", tags=["train"])


@router.get("/gpu-check")
async def gpu_check():
    return check_gpu()


@router.get("/models")
async def list_models():
    return [
        {"id": "unsloth/gemma-4-E4B-it", "name": "Gemma 4 8B (16bit LoRA)", "params": "8B", "vram": "~17GB"},
        {"id": "unsloth/gemma-4-31B-it", "name": "Gemma 4 31B (16bit LoRA)", "params": "31B", "vram": "~34GB+"},
        {"id": "unsloth/gemma-4-26B-A4B-it", "name": "Gemma 4 26B MoE (16bit)", "params": "26B/4B", "vram": "~28GB"},
    ]


@router.post("/start")
async def start(req: TrainStartRequest):
    gpu = check_gpu()
    if not gpu["available"]:
        raise HTTPException(
            status_code=400,
            detail="GPU가 감지되지 않습니다. LoRA 학습에는 NVIDIA GPU가 필요합니다.",
        )
    config = {
        "base_model": req.base_model,
        "num_epochs": req.config.get("num_epochs", 2),
        "learning_rate": req.config.get("learning_rate", 1e-4),
        "batch_size": req.config.get("batch_size", 2),
        "gradient_accumulation_steps": req.config.get("gradient_accumulation_steps", 16),
        "lora_rank": req.config.get("lora_rank", 32),
        "lora_alpha": req.config.get("lora_alpha", 64),
        "max_seq_length": req.config.get("max_seq_length", 4096),
        "warmup_ratio": req.config.get("warmup_ratio", 0.05),
        "weight_decay": req.config.get("weight_decay", 0.01),
        "eval_split": req.config.get("eval_split", 0.05),
    }
    result = start_training(req.project_id, config)
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@router.get("/status/{project_id}")
async def status(project_id: str):
    return get_progress(project_id)


@router.post("/stop/{project_id}")
async def stop(project_id: str):
    return stop_training(project_id)


@router.get("/config")
async def default_config():
    return {
        "num_epochs": 2,
        "learning_rate": 1e-4,
        "batch_size": 2,
        "gradient_accumulation_steps": 16,
        "lora_rank": 32,
        "lora_alpha": 64,
        "max_seq_length": 4096,
        "warmup_ratio": 0.05,
        "weight_decay": 0.01,
        "eval_split": 0.05,
    }
