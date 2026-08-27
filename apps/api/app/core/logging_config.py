"""Structured JSON logging configuration for OpenResearch API.

Configures stdlib logging to emit JSON lines in production for machine parsing
and human-readable format in development. All log records carry a request_id
contextvar so that per-request logs can be correlated via X-Request-ID.
"""

import json
import logging
import os
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any, ClassVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="")


class JSONFormatter(logging.Formatter):
    """Emits each log record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        req_id = request_id_var.get("")
        if req_id:
            payload["request_id"] = req_id
        if record.exc_info and record.exc_info[0] is not None:
            payload["exception"] = self.formatException(record.exc_info)
        # Merge any extra fields attached via logger.info("...", extra={...})
        for key in ("status", "method", "path", "latency_ms", "component"):
            val = getattr(record, key, None)
            if val is not None:
                payload[key] = val
        return json.dumps(payload, default=str)


class DevFormatter(logging.Formatter):
    """Human-readable coloured output for local development."""

    COLORS: ClassVar[dict[str, str]] = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[1;31m",
    }
    RESET: ClassVar[str] = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        req_id = request_id_var.get("")
        prefix = f"[{req_id}] " if req_id else ""
        msg = (
            f"{color}{record.levelname:<8}{self.RESET} {prefix}{record.name}: {record.getMessage()}"
        )
        if record.exc_info and record.exc_info[0] is not None:
            msg += "\n" + self.formatException(record.exc_info)
        return msg


def setup_logging() -> None:
    """Configure root logger.  Called once during application startup."""
    env = os.environ.get("ENVIRONMENT", "development").strip().lower()
    json_mode = env in ("production", "staging")

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    # Remove any pre-configured handlers (e.g. uvicorn defaults)
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stderr)
    if json_mode:
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(DevFormatter())
    root.addHandler(handler)

    # Quiet noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
