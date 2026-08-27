import asyncio
import logging
import threading
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect

from alembic import command
from app.api.v1.api import api_router
from app.core.config import settings
from app.core.database import engine
from app.core.http_client import close_http_client, init_http_client
from app.core.logging_config import setup_logging
from app.core.middleware import (
    GlobalErrorEnvelopeMiddleware,
    RequestTracingMiddleware,
    SecurityHeadersMiddleware,
)

logger = logging.getLogger("openresearch.startup")


def _run_migrations() -> None:
    """Apply Alembic migrations to reach the latest schema (replaces ad-hoc create_all)."""
    base_dir = Path(__file__).resolve().parents[1]
    ini_path = base_dir / "alembic.ini"
    if not ini_path.exists():
        raise RuntimeError(f"alembic.ini not found at {ini_path}; cannot run database migrations")

    alembic_cfg = AlembicConfig(str(ini_path))
    alembic_cfg.set_main_option("script_location", str(base_dir / "alembic"))

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "alembic_version" in tables:
        command.upgrade(alembic_cfg, "head")
    elif tables:
        logger.info(
            "Existing pre-Alembic database detected (%d tables); stamping baseline revision",
            len(tables),
        )
        command.stamp(alembic_cfg, "head")
    else:
        command.upgrade(alembic_cfg, "head")


def _start_tabby_if_enabled() -> None:
    """Fire-and-forget local Tabby launch; start_if_enabled no-ops unless autocomplete is on."""
    try:
        from app.services import tabby_setup_service
        from app.services.llm_service import llm_service

        tabby_setup_service.start_if_enabled(lambda: llm_service.probe_tabby(force=True))
    except Exception:
        logger.warning("Background Tabby autostart failed", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup: configure structured logging, then apply schema migrations.
    # NOTE: _run_migrations is CPU/IO-bound and would block the event loop
    # if called directly; it is offloaded to a thread pool below.
    # For multi-worker deployments where concurrent startup is possible, an
    # advisory lock (e.g. pg_advisory_lock) should be added to prevent
    # concurrent migration runs across workers.
    setup_logging()
    await asyncio.to_thread(_run_migrations)
    await init_http_client()
    if settings.ENVIRONMENT.strip().lower() != "test":
        threading.Thread(
            target=_start_tabby_if_enabled, name="tabby-autostart", daemon=True
        ).start()
    yield
    # Shutdown: cancel collaboration relay task, stop Tabby child, then close HTTP clients
    try:
        from app.api.v1.endpoints.collaboration import collab_manager

        if collab_manager._relay_task is not None and not collab_manager._relay_task.done():
            collab_manager._relay_task.cancel()
    except Exception:
        pass
    try:
        from app.services.tabby_setup_service import stop_server

        stop_server()
    except Exception:
        pass
    await close_http_client()


_is_production = settings.ENVIRONMENT.strip().lower() == "production"

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Open-Source AI Academic Research & Writing Assistant Backend API",
    openapi_url=None if _is_production else f"{settings.API_V1_STR}/openapi.json",
    docs_url=None if _is_production else f"{settings.API_V1_STR}/docs",
    redoc_url=None if _is_production else f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# Resilience & Observability middleware (§3.5)
app.add_middleware(GlobalErrorEnvelopeMiddleware)
app.add_middleware(RequestTracingMiddleware)

# CORS configuration for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)
app.add_middleware(SecurityHeadersMiddleware)


# ---------------------------------------------------------------------------
# Unified error envelope (H1) — consistent shape for all error responses.
# Matches the existing GlobalErrorEnvelopeMiddleware 500 shape so clients
# only need one parser: {"error": {"code", "message", "request_id"}}
# ---------------------------------------------------------------------------

_ERROR_CODE_MAP: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    422: "VALIDATION_ERROR",
    429: "TOO_MANY_REQUESTS",
    500: "INTERNAL_SERVER_ERROR",
    502: "BAD_GATEWAY",
    503: "SERVICE_UNAVAILABLE",
}


def _error_envelope(request: Request, code: str, message: str, status: int) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "request_id": request_id}},
        headers={"X-Request-ID": request_id},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    code = _ERROR_CODE_MAP.get(exc.status_code, f"HTTP_{exc.status_code}")
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    headers: dict[str, str] = {"X-Request-ID": request_id}
    if exc.headers:
        headers.update(exc.headers)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": detail, "request_id": request_id}},
        headers=headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    details: list[dict[str, object]] = []
    for err in exc.errors():
        loc = [str(x) for x in err.get("loc", ())]
        details.append({"loc": loc, "msg": err.get("msg", ""), "type": err.get("type", "")})
    return _error_envelope(request, "VALIDATION_ERROR", str(details), 422)


app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Welcome to OpenResearch API", "docs": f"{settings.API_V1_STR}/docs"}
