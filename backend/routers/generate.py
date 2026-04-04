"""Phase 4 - Generation & testing router (fully working with Ollama)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import (
    BatchGenerateRequest,
    ChatRequest,
    ExportRequest,
    PromptTemplate,
)
from services.ollama import generate as ollama_generate
from services.ollama import generate_stream as ollama_stream
from services.ollama import list_models as ollama_list_models

router = APIRouter(prefix="/api/generate", tags=["generate"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEMPLATES_PATH = DATA_DIR / "templates.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_templates() -> list[dict[str, Any]]:
    if not TEMPLATES_PATH.exists():
        return []
    with open(TEMPLATES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_templates(templates: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(TEMPLATES_PATH, "w", encoding="utf-8") as f:
        json.dump(templates, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Chat (SSE streaming)
# ---------------------------------------------------------------------------

@router.post("/chat")
async def chat(req: ChatRequest):
    if req.stream:
        async def event_generator():
            try:
                async for token in ollama_stream(
                    model=req.model,
                    prompt=req.prompt,
                    system=req.system,
                    temperature=req.temperature,
                    max_tokens=req.max_tokens,
                ):
                    data = json.dumps({"token": token}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as exc:
                error_data = json.dumps({"error": str(exc)})
                yield f"data: {error_data}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # non-streaming
    try:
        text = await ollama_generate(
            model=req.model,
            prompt=req.prompt,
            system=req.system,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ollama error: {exc}")
    return {"response": text}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

@router.get("/models")
async def models():
    try:
        model_list = await ollama_list_models()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot reach Ollama: {exc}. Is it running on localhost:11434?",
        )
    return {"models": model_list}


# ---------------------------------------------------------------------------
# Batch generate
# ---------------------------------------------------------------------------

@router.post("/batch")
async def batch_generate(req: BatchGenerateRequest):
    results: list[dict[str, str]] = []
    for prompt in req.prompts:
        try:
            text = await ollama_generate(
                model=req.model,
                prompt=prompt,
                system=req.system,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            )
            results.append({"prompt": prompt, "response": text})
        except Exception as exc:
            results.append({"prompt": prompt, "response": "", "error": str(exc)})
    return {"results": results}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@router.post("/export")
async def export_results(req: ExportRequest):
    project_dir = DATA_DIR / req.project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    if req.format == "md":
        lines: list[str] = ["# Generation Results\n"]
        for i, r in enumerate(req.results, 1):
            lines.append(f"## Prompt {i}\n")
            lines.append(f"**Prompt:** {r.get('prompt', '')}\n")
            lines.append(f"**Response:**\n\n{r.get('response', '')}\n")
            lines.append("---\n")
        content = "\n".join(lines)
        filename = "generation_results.md"
    else:
        parts: list[str] = []
        for i, r in enumerate(req.results, 1):
            parts.append(f"[Prompt {i}]\n{r.get('prompt', '')}\n\n[Response {i}]\n{r.get('response', '')}")
        content = "\n\n" + "=" * 60 + "\n\n".join(parts)
        filename = "generation_results.txt"

    out = project_dir / filename
    out.write_text(content, encoding="utf-8")
    return {"filename": filename, "path": str(out), "length": len(content)}


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

@router.get("/templates")
async def get_templates():
    return _load_templates()


@router.post("/templates")
async def save_template(tpl: PromptTemplate):
    templates = _load_templates()
    # update if same id exists, else append
    found = False
    for i, t in enumerate(templates):
        if t["id"] == tpl.id:
            templates[i] = tpl.model_dump()
            found = True
            break
    if not found:
        templates.append(tpl.model_dump())
    _save_templates(templates)
    return tpl.model_dump()
