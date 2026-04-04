"""FastAPI application entry point for the YouTube -> LoRA Fine-tune Pipeline backend."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure the backend package root is on sys.path so that absolute imports
# like `from models.schemas import ...` work when running with uvicorn from
# the backend/ directory.
_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import collect, generate, refine, train

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="StoryForge API",
    version="0.2.0",
    description="Backend for the StoryForge local fine-tuning pipeline.",
)

# CORS - allow everything for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(collect.router)
app.include_router(refine.router)
app.include_router(train.router)
app.include_router(generate.router)

# Ensure data directory exists
DATA_DIR = _BACKEND_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Serve frontend static files (built with `npm run build`)
_FRONTEND_DIST = _BACKEND_DIR.parent / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    # Serve static assets
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    # Serve index.html for SPA fallback
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA - any non-API route returns index.html."""
        file_path = _FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_FRONTEND_DIST / "index.html"))


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "storyforge-backend"}


# ---------------------------------------------------------------------------
# Run with: python main.py
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
