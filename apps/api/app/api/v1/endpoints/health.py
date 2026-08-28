import logging
import threading
import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.services.provider_cache_service import provider_cache_service

router = APIRouter()
logger = logging.getLogger("openresearch.health")

_redis_status_cache: tuple[bool, float] | None = None
_REDIS_CACHE_TTL_SECONDS = 5.0
_redis_cache_lock = threading.Lock()


def _check_redis() -> tuple[bool, str]:
    """Check Redis connectivity with thread-safe caching."""
    global _redis_status_cache
    now = time.monotonic()
    with _redis_cache_lock:
        if (
            _redis_status_cache is not None
            and (now - _redis_status_cache[1]) < _REDIS_CACHE_TTL_SECONDS
        ):
            redis_ok = _redis_status_cache[0]
        else:
            redis_ok = provider_cache_service.redis_ping()
            _redis_status_cache = (redis_ok, now)
    return redis_ok, "healthy" if redis_ok else "degraded"


@router.get("/health/live")
def liveness():
    """Liveness probe - returns 200 OK immediately (process is alive)."""
    return {"status": "ok"}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    """
    Readiness probe - checks DB + Redis, returns 503 if not ready.

    - database: required component; failure yields HTTP 503.
    - redis: optional accelerator; failure degrades status but keeps the API serving.
    """
    components: dict[str, str] = {}
    overall = "healthy"

    try:
        db.execute(text("SELECT 1"))
        components["database"] = "healthy"
    except Exception:
        logger.exception("Health check: database probe failed")
        components["database"] = "unhealthy"
        overall = "unhealthy"

    if settings.REDIS_URL:
        redis_ok, redis_status = _check_redis()
        components["redis"] = redis_status
        if not redis_ok:
            logger.warning("Health check: Redis probe failed")
            overall = "degraded"

    payload = {
        "status": overall,
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "components": components,
        "environment": settings.ENVIRONMENT,
        "local_first_default": True,
    }

    if overall in ("unhealthy", "degraded"):
        return JSONResponse(status_code=503, content=payload)
    return payload


# Backward compat
@router.get("/health", response_model=None)
def get_health(db: Session = Depends(get_db)):
    """Legacy health endpoint - behaves like /health/ready for existing tooling."""
    return readiness(db)
