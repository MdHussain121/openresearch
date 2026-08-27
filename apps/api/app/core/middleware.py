"""
Observability and resilience middleware for OpenResearch API.
Provides correlation IDs (X-Request-ID), structured logging, and global error envelope handling.
"""

import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging_config import request_id_var

logger = logging.getLogger("openresearch.middleware")

_SAFE_REQUEST_ID = re.compile(r"[^A-Za-z0-9_\-]")


class RequestTracingMiddleware(BaseHTTPMiddleware):
    """
    Attaches unique correlation ID (X-Request-ID) to incoming requests
    and propagates it into response headers and logging context (§3.5).
    Client-supplied IDs are sanitized to a safe charset to prevent log injection.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        supplied_id = request.headers.get("X-Request-ID") or ""
        request_id = _SAFE_REQUEST_ID.sub("", supplied_id)[:64] or str(uuid.uuid4())
        request.state.request_id = request_id
        token = request_id_var.set(request_id)
        start_time = time.monotonic()

        response = await call_next(request)

        duration_ms = (time.monotonic() - start_time) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-MS"] = f"{duration_ms:.2f}"

        logger.info(
            "[%s] %s %s status=%s latency=%.2fms",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        request_id_var.reset(token)
        return response


class GlobalErrorEnvelopeMiddleware(BaseHTTPMiddleware):
    """
    Catches unhandled exceptions and formats them into a predictable JSON envelope (§3.5).
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
            logger.exception("[%s] Unhandled server exception: %s", request_id, exc)
            return JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "INTERNAL_SERVER_ERROR",
                        "message": "An unexpected internal server error occurred.",
                        "request_id": request_id,
                    }
                },
                headers={"X-Request-ID": request_id},
            )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Injects standard security headers into every response."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response
