import asyncio
import logging

import httpx

logger = logging.getLogger("openresearch.http_client")

# Shared connection limits for HTTP connection pooling
HTTP_LIMITS = httpx.Limits(max_keepalive_connections=20, max_connections=100, keepalive_expiry=30.0)
DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=10.0)
DEFAULT_HEADERS = {"User-Agent": "OpenResearch/1.0 (mailto:dev@openresearch.org)"}

_async_client: httpx.AsyncClient | None = None
_async_client_loop_id: int | None = None
_sync_client: httpx.Client | None = None


def _current_loop_id() -> int | None:
    """Return the id of the currently running event loop, if any."""
    try:
        return id(asyncio.get_running_loop())
    except RuntimeError:
        return None


def _async_client_stale(loop_id: int | None) -> bool:
    """
    True when the cached async client must be replaced: it is missing/closed,
    or it belongs to a different (likely already closed) event loop.
    """
    if _async_client is None or _async_client.is_closed:
        return True
    return (
        loop_id is not None
        and _async_client_loop_id is not None
        and loop_id != _async_client_loop_id
    )


async def init_http_client() -> None:
    """Initialize shared async and sync HTTP client connection pools."""
    global _async_client, _async_client_loop_id, _sync_client
    loop_id = _current_loop_id()
    if _async_client_stale(loop_id):
        _async_client = httpx.AsyncClient(
            limits=HTTP_LIMITS, timeout=DEFAULT_TIMEOUT, headers=DEFAULT_HEADERS
        )
        _async_client_loop_id = loop_id
    if _sync_client is None or _sync_client.is_closed:
        _sync_client = httpx.Client(
            limits=HTTP_LIMITS, timeout=DEFAULT_TIMEOUT, headers=DEFAULT_HEADERS
        )
    logger.info("Shared HTTP client connection pools initialized.")


async def close_http_client() -> None:
    """Close shared HTTP client connection pools and release sockets."""
    global _async_client, _async_client_loop_id, _sync_client
    if _async_client is not None and not _async_client.is_closed:
        try:
            await _async_client.aclose()
        except Exception as exc:
            logger.warning("Async HTTP client close failed (%s); discarding reference.", exc)
    _async_client = None
    _async_client_loop_id = None
    if _sync_client is not None and not _sync_client.is_closed:
        await asyncio.to_thread(_sync_client.close)
    _sync_client = None
    logger.info("Shared HTTP client connection pools closed.")


def get_async_http_client() -> httpx.AsyncClient:
    """
    Get the shared singleton AsyncClient.
    Initializes (or re-binds) the client if missing, closed, or tied to a
    different event loop than the one currently running (e.g. during tests).
    """
    global _async_client, _async_client_loop_id
    loop_id = _current_loop_id()
    existing = _async_client
    if (
        existing is not None
        and not existing.is_closed
        and (loop_id is None or _async_client_loop_id is None or loop_id == _async_client_loop_id)
    ):
        return existing
    stale = existing
    fresh = httpx.AsyncClient(limits=HTTP_LIMITS, timeout=DEFAULT_TIMEOUT, headers=DEFAULT_HEADERS)
    _async_client = fresh
    _async_client_loop_id = loop_id
    if stale is not None and not stale.is_closed and loop_id is not None:

        def _log_close(task):
            try:
                task.result()
            except Exception:
                logger.warning("Async HTTP client stale close failed", exc_info=True)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                _stale_close_task = loop.create_task(stale.aclose())
                _stale_close_task.add_done_callback(_log_close)
        except RuntimeError:
            pass
    return fresh


def get_sync_http_client() -> httpx.Client:
    """
    Get the shared singleton sync Client.
    Initializes a client if not yet created (e.g. during test executions).
    """
    global _sync_client
    if _sync_client is None or _sync_client.is_closed:
        _sync_client = httpx.Client(
            limits=HTTP_LIMITS, timeout=DEFAULT_TIMEOUT, headers=DEFAULT_HEADERS
        )
    return _sync_client
