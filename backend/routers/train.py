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
        {"id": "unsloth/gemma-4-12b-it-bnb-4bit", "name": "Gemma 4 12B (4-bit) [추천]", "params": "12B"},
        {"id": "unsloth/gemma-4-27b-it-bnb-4bit", "name": "Gemma 4 27B (4-bit)", "params": "27B"},
        {"id": "unsloth/gemma-3-4b-it-bnb-4bit", "name": "Gemma 3 4B (4-bit)", "params": "4B"},
        {"id": "unsloth/llama-3.1-8b-bnb-4bit", "name": "LLaMA 3.1 8B (4-bit)", "params": "8B"},
        {"id": "unsloth/mistral-7b-bnb-4bit", "name": "Mistral 7B (4-bit)", "params": "7B"},
        {"id": "unsloth/Qwen2.5-7B-bnb-4bit", "name": "Qwen2.5 7B (4-bit)", "params": "7B"},
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
        "num_epochs": req.config.get("num_epochs", 3),
        "learning_rate": req.config.get("learning_rate", 2e-4),
        "batch_size": req.config.get("batch_size", 4),
        "lora_rank": req.config.get("lora_rank", 16),
        "max_seq_length": req.config.get("max_seq_length", 2048),
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
        "num_epochs": 3,
        "learning_rate": 2e-4,
        "batch_size": 4,
        "lora_rank": 16,
        "max_seq_length": 2048,
    }
