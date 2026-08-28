import asyncio
import json
import logging
import threading
import time
from collections import OrderedDict
from typing import Any

from app.core.config import settings
from app.schemas.models import (
    CacheClearResponse,
    ProviderQuotaResponse,
    ProviderStatusItem,
)

logger = logging.getLogger("openresearch.provider_cache")

try:
    import redis
except ImportError:
    redis = None  # type: ignore[assignment]


class ProviderCacheService:
    """
    Provider Query Caching & Usage-Tier Quota Protection (Phase 8.6).
    - Bounded LRU cache with max_entries (default 2,000) to eliminate memory leaks.
    - Caches metadata lookups & search queries with TTL (default 24 hours).
    - Protects free-tier usage limits (e.g. OpenAlex 100k requests/month).
    - Connects to Redis when available, with transparent in-memory fallback.
    - Surfaces real-time quota status & hit rates.
    """

    def __init__(self, default_ttl_seconds: int = 86400, max_entries: int = 2000):
        self.default_ttl = default_ttl_seconds
        self.max_entries = max_entries
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._redis_client: Any | None = None
        self._redis_checked = False
        self._redis_lock = threading.Lock()

        # Provider metrics tracking (starts at zero; only real lookups mutate it)
        self._provider_stats: dict[str, dict[str, Any]] = {
            name: {
                "tier": "free",
                "is_usage_based": False,
                "monthly_quota": None,
                "requests_made": 0,
                "cache_hits": 0,
                "cache_misses": 0,
            }
            for name in ("Crossref", "arXiv", "PubMed")
        }

    def _get_redis(self) -> Any | None:
        if self._redis_checked:
            return self._redis_client
        with self._redis_lock:
            if self._redis_checked:
                return self._redis_client
            self._redis_checked = True
            if redis and settings.REDIS_URL:
                try:
                    client = redis.Redis.from_url(
                        settings.REDIS_URL,
                        decode_responses=True,
                        socket_timeout=settings.PROVIDER_SOCKET_TIMEOUT_SECONDS,
                        socket_connect_timeout=settings.PROVIDER_SOCKET_CONNECT_TIMEOUT_SECONDS,
                    )
                    client.ping()
                    self._redis_client = client
                    logger.info("Connected to Redis provider cache at %s", settings.REDIS_URL)
                except Exception as e:
                    logger.warning("Redis not available, using in-memory LRU cache: %s", e)
                    self._redis_client = None
        return self._redis_client

    def redis_ping(self) -> bool:
        """Return True when the shared Redis instance answers a health ping."""
        client = self._get_redis()
        if client is None:
            return False
        try:
            client.ping()
            return True
        except Exception as e:
            logger.warning("Redis health ping failed: %s", e)
            return False

    def get(self, key: str, provider_name: str = "OpenAlex") -> Any | None:
        now = time.time()

        # 1. Check in-memory LRU cache
        with self._cache_lock:
            if key in self._cache:
                entry = self._cache[key]
                if now < entry["expires_at"]:
                    self._cache.move_to_end(key)
                    if provider_name in self._provider_stats:
                        self._provider_stats[provider_name]["cache_hits"] += 1
                    return entry["data"]
                del self._cache[key]

        # 2. Check Redis if available
        r = self._get_redis()
        if r:
            try:
                raw_val = r.get(f"provider_cache:{key}")
                if raw_val:
                    data = json.loads(raw_val)
                    # Populate in-memory LRU cache
                    self.set(key, data, provider_name=provider_name)
                    if provider_name in self._provider_stats:
                        self._provider_stats[provider_name]["cache_hits"] += 1
                    return data
            except Exception as e:
                logger.warning("Redis get error for key %s: %s", key, e)

        if provider_name in self._provider_stats:
            self._provider_stats[provider_name]["cache_misses"] += 1
            self._provider_stats[provider_name]["requests_made"] += 1
        return None

    def set(
        self, key: str, data: Any, ttl_seconds: int | None = None, provider_name: str = "OpenAlex"
    ):
        ttl = ttl_seconds or self.default_ttl
        now = time.time()

        # Maintain bounded capacity using LRU eviction
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            else:
                while len(self._cache) >= self.max_entries:
                    self._cache.popitem(last=False)

            self._cache[key] = {
                "data": data,
                "cached_at": now,
                "expires_at": now + ttl,
                "provider": provider_name,
            }

        # Store to Redis if available
        r = self._get_redis()
        if r:
            try:
                r.setex(f"provider_cache:{key}", int(ttl), json.dumps(data))
            except Exception as e:
                logger.warning("Redis set error for key %s: %s", key, e)

    async def aget(self, key: str, provider_name: str = "OpenAlex") -> Any | None:
        return await asyncio.to_thread(self.get, key, provider_name=provider_name)

    async def aset(
        self, key: str, data: Any, ttl_seconds: int | None = None, provider_name: str = "OpenAlex"
    ) -> None:
        await asyncio.to_thread(
            self.set, key, data, ttl_seconds=ttl_seconds, provider_name=provider_name
        )

    def clear(self) -> CacheClearResponse:
        with self._cache_lock:
            count = len(self._cache)
            self._cache.clear()

        r = self._get_redis()
        if r:
            try:
                keys = r.keys("provider_cache:*")
                if keys:
                    r.delete(*keys)
                    count += len(keys)
            except Exception as e:
                logger.warning("Redis clear error: %s", e)

        return CacheClearResponse(cleared_entries=count, status="ok")

    def get_quota_status(self) -> ProviderQuotaResponse:
        items: list[ProviderStatusItem] = []
        total_hits = 0
        total_misses = 0

        for name, stats in self._provider_stats.items():
            hits = stats["cache_hits"]
            misses = stats["cache_misses"]
            total_hits += hits
            total_misses += misses

            total_reqs = hits + misses
            hit_rate = round(hits / total_reqs, 3) if total_reqs > 0 else 0.0

            monthly_quota = stats["monthly_quota"]
            reqs_made = stats["requests_made"]
            remaining = (monthly_quota - reqs_made) if monthly_quota else None

            status = "healthy"
            if monthly_quota:
                if reqs_made >= monthly_quota:
                    status = "exceeded"
                elif reqs_made >= monthly_quota * 0.8:
                    status = "warning"

            items.append(
                ProviderStatusItem(
                    provider_name=name,
                    tier=stats["tier"],
                    is_usage_based=stats["is_usage_based"],
                    requests_made=reqs_made,
                    requests_remaining=remaining,
                    monthly_quota=monthly_quota,
                    cache_hits=hits,
                    cache_misses=misses,
                    cache_hit_rate=hit_rate,
                    status=status,
                )
            )

        overall_total = total_hits + total_misses
        overall_hit_rate = round(total_hits / overall_total, 3) if overall_total > 0 else 0.0

        return ProviderQuotaResponse(
            providers=items,
            total_cached_queries=len(self._cache),
            overall_cache_hit_rate=overall_hit_rate,
            notice="Provider lookups are cached for 24h to protect upstream rate limits.",
        )


provider_cache_service = ProviderCacheService()
