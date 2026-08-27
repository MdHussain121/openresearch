"""
In-process sliding-window rate limiting for abuse-sensitive endpoints.

Counts requests per client key within a fixed window. State is local to the
worker process; run a single API worker or front this with a gateway-level
limiter when scaling horizontally.
"""

import ipaddress
import os
import time
from collections import defaultdict, deque
from collections.abc import Callable

from fastapi import HTTPException, Request, status

from app.core.config import settings


def _is_trusted_proxy(ip_str: str) -> bool:
    """Check if an IP is in the OPENRESEARCH_TRUSTED_PROXIES comma-separated list."""
    trusted_raw = os.environ.get("OPENRESEARCH_TRUSTED_PROXIES", "").strip()
    if not trusted_raw:
        return False
    try:
        candidate = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    for entry in trusted_raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if candidate in ipaddress.ip_network(entry, strict=False):
                    return True
            elif candidate == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False


def get_client_ip(request: Request) -> str:
    peer_ip = request.client.host if request.client else "unknown"

    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for and _is_trusted_proxy(peer_ip):
        return forwarded_for.split(",")[0].strip()

    return peer_ip


class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._last_sweep: float = 0.0
        self._sweep_interval: float = max(window_seconds, 60.0)

    def _sweep_stale_keys(self, now: float) -> None:
        """Remove keys whose deques are entirely expired to prevent unbounded growth."""
        if now - self._last_sweep < self._sweep_interval:
            return
        self._last_sweep = now
        stale = [
            k for k, hits in self._hits.items() if not hits or now - hits[-1] > self.window_seconds
        ]
        for k in stale:
            del self._hits[k]

    def check(self, key: str) -> None:
        if settings.ENVIRONMENT.strip().lower() == "test":
            return
        now = time.monotonic()
        self._sweep_stale_keys(now)
        hits = self._hits[key]
        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()
        if len(hits) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - hits[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(max(retry_after, 1))},
            )
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


def rate_limit_dependency(
    limiter: SlidingWindowRateLimiter, include_ip: bool = True
) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        key = get_client_ip(request) if include_ip else "global"
        limiter.check(key)

    return dependency
