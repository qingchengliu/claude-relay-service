import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse

sys.path.insert(0, str(Path(__file__).parent.parent))

from server.database import init_db, engine, async_session
from server.models import Team, gen_uuid
from server.config import DEFAULT_API_KEY
from server.auth_deps import require_auth
from server.prompt_metrics_backfill import backfill_prompt_metrics
from server.routers.auth import router as auth_router
from server.routers.cas import router as cas_router
from server.routers.metrics import router as metrics_router
from server.routers.bundles import router as bundles_router
from server.routers.stats import router as stats_router
from server.routers.admin import router as admin_router
from server.routers.install import router as install_router
from sqlalchemy import select


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with async_session() as db:
        result = await db.execute(select(Team).limit(1))
        if not result.scalar_one_or_none():
            db.add(Team(id=gen_uuid(), name="风控研发中心", api_key=DEFAULT_API_KEY))
            await db.commit()
        await backfill_prompt_metrics(db)
    yield
    await engine.dispose()


app = FastAPI(
    title="Git-AI Collector",
    description="Self-hosted collection server compatible with git-ai API protocol",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ====== 公开接口 (无需认证) ======
for r in [auth_router, cas_router, metrics_router, bundles_router, install_router]:
    app.include_router(r)

# ====== 管理接口 (需要 Basic Auth) ======
for r in [stats_router, admin_router]:
    app.include_router(r, dependencies=[Depends(require_auth)])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "git-ai-collector"}


@app.get("/api/check-auth")
async def check_auth(username: str = Depends(require_auth)):
    return {"status": "ok", "username": username}


@app.get("/dashboard", response_class=HTMLResponse)
async def serve_dashboard():
    """管理看板 - 页面公开，数据接口仍需登录。"""
    frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
    return FileResponse(os.path.join(frontend_path, "dashboard.html"))


@app.get("/{path:path}", response_class=HTMLResponse)
async def serve_frontend(path: str):
    """公开页面 - 安装指南."""
    frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
    if not os.path.exists(frontend_path):
        return HTMLResponse("<h1>Frontend not found</h1>", status_code=404)

    file_path = os.path.join(frontend_path, path) if path else os.path.join(frontend_path, "index.html")
    if path and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(frontend_path, "index.html"))
