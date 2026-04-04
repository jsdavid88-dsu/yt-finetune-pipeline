"""FastAPI application entry point for the YouTube -> LoRA Fine-tune Pipeline backend."""

from __future__ import annotations

import sys
from pathlib import Path

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
    version="0.3.0",
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

# ---------------------------------------------------------------------------
# Health check (before routers is fine, but must be before catch-all)
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "storyforge-backend"}


# Mount routers
app.include_router(collect.router)
app.include_router(refine.router)
app.include_router(train.router)
app.include_router(generate.router)

# Ensure data directory exists
DATA_DIR = _BACKEND_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# SPA fallback — use middleware instead of catch-all route
# ---------------------------------------------------------------------------

_FRONTEND_DIST = _BACKEND_DIR.parent / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    from starlette.middleware.base import BaseHTTPMiddleware
    from fastapi.responses import FileResponse
    from starlette.responses import Response

    class SPAFallbackMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next) -> Response:
            response = await call_next(request)
            # If 404 and not an API route, serve index.html
            if response.status_code == 404 and not request.url.path.startswith("/api"):
                return FileResponse(str(_FRONTEND_DIST / "index.html"))
            return response

    app.add_middleware(SPAFallbackMiddleware)


# ---------------------------------------------------------------------------
# Run with: python main.py
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=9000,
        reload=True,
    )
