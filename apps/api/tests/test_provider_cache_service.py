"""
Unit tests for app.services.provider_cache_service covering LRU eviction,
TTL expiry, Redis mocked paths, and quota status states.
"""

import time
from unittest.mock import MagicMock, patch

from app.services.provider_cache_service import ProviderCacheService


class TestInMemoryCacheBasics:
    def test_set_and_get_hit(self):
        svc = ProviderCacheService()
        svc.set("key1", {"val": 42}, ttl_seconds=3600)
        result = svc.get("key1")
        assert result == {"val": 42}

    def test_cache_miss_returns_none(self):
        svc = ProviderCacheService()
        assert svc.get("nonexistent") is None

    def test_expired_entry_returns_none(self):
        svc = ProviderCacheService()
        svc.set("expiring", "data", ttl_seconds=1)
        # Manually expire by patching cache entry
        svc._cache["expiring"]["expires_at"] = time.time() - 1
        result = svc.get("expiring")
        assert result is None

    def test_lru_eviction_on_overflow(self):
        svc = ProviderCacheService(max_entries=3)
        svc.set("a", "A")
        svc.set("b", "B")
        svc.set("c", "C")
        # 'a' should be evicted when 'd' is added
        svc.set("d", "D")
        assert svc.get("a") is None
        assert svc.get("d") == "D"

    def test_update_existing_key_moves_to_end(self):
        svc = ProviderCacheService(max_entries=3)
        svc.set("a", "A")
        svc.set("b", "B")
        svc.set("c", "C")
        # Re-set 'a' — it should move to end and 'b' should be evicted next
        svc.set("a", "A_updated")
        svc.set("d", "D")
        assert svc.get("a") == "A_updated"
        assert svc.get("d") == "D"
        # 'b' should have been evicted
        assert svc.get("b") is None

    def test_clear_empties_cache(self):
        svc = ProviderCacheService()
        svc.set("x", "data")
        svc.set("y", "data2")
        response = svc.clear()
        assert response.cleared_entries >= 2
        assert response.status == "ok"
        assert svc.get("x") is None

    def test_default_ttl_used_when_none_passed(self):
        svc = ProviderCacheService(default_ttl_seconds=7200)
        svc.set("k", "v")
        entry = svc._cache["k"]
        expected_ttl = entry["expires_at"] - entry["cached_at"]
        assert abs(expected_ttl - 7200) < 2


class TestCacheHitMissStats:
    def test_hit_increments_cache_hits(self):
        svc = ProviderCacheService()
        svc.set("k", {"val": 1}, provider_name="Crossref")
        before = svc._provider_stats["Crossref"]["cache_hits"]
        svc.get("k", provider_name="Crossref")
        after = svc._provider_stats["Crossref"]["cache_hits"]
        assert after == before + 1

    def test_miss_increments_cache_misses(self):
        svc = ProviderCacheService()
        before = svc._provider_stats["Crossref"]["cache_misses"]
        svc.get("nonexistent_key_xyz", provider_name="Crossref")
        after = svc._provider_stats["Crossref"]["cache_misses"]
        assert after == before + 1

    def test_stats_start_at_zero(self):
        svc = ProviderCacheService()
        for stats in svc._provider_stats.values():
            assert stats["requests_made"] == 0
            assert stats["cache_hits"] == 0
            assert stats["cache_misses"] == 0

    def test_unknown_provider_name_no_crash(self):
        svc = ProviderCacheService()
        svc.set("k", "v", provider_name="UnknownProvider")
        result = svc.get("k", provider_name="UnknownProvider")
        assert result == "v"


class TestGetQuotaStatus:
    def test_returns_provider_quota_response(self):
        svc = ProviderCacheService()
        response = svc.get_quota_status()
        assert response.overall_cache_hit_rate >= 0
        assert len(response.providers) > 0

    def test_status_exceeded_when_quota_reached(self):
        svc = ProviderCacheService()
        svc._provider_stats["Crossref"]["requests_made"] = 100001
        svc._provider_stats["Crossref"]["monthly_quota"] = 100000
        response = svc.get_quota_status()
        crossref = next(p for p in response.providers if p.provider_name == "Crossref")
        assert crossref.status == "exceeded"

    def test_status_warning_when_near_quota(self):
        svc = ProviderCacheService()
        # 85% used → warning
        svc._provider_stats["Crossref"]["requests_made"] = 85000
        svc._provider_stats["Crossref"]["monthly_quota"] = 100000
        response = svc.get_quota_status()
        crossref = next(p for p in response.providers if p.provider_name == "Crossref")
        assert crossref.status == "warning"

    def test_status_healthy_when_under_80_percent(self):
        svc = ProviderCacheService()
        svc._provider_stats["Crossref"]["requests_made"] = 50000
        svc._provider_stats["Crossref"]["monthly_quota"] = 100000
        response = svc.get_quota_status()
        crossref = next(p for p in response.providers if p.provider_name == "Crossref")
        assert crossref.status == "healthy"

    def test_unlimited_quota_provider_no_remaining(self):
        svc = ProviderCacheService()
        response = svc.get_quota_status()
        crossref = next(p for p in response.providers if p.provider_name == "Crossref")
        assert crossref.requests_remaining is None


class TestRedisPaths:
    def _make_mock_redis(
        self,
        ping_raises=False,
        get_value=None,
        get_raises=False,
        set_raises=False,
        keys_return=None,
        delete_raises=False,
    ):
        mock_redis_module = MagicMock()
        mock_client = MagicMock()
        if ping_raises:
            mock_client.ping.side_effect = Exception("Redis unavailable")
        else:
            mock_client.ping.return_value = True
        if get_raises:
            mock_client.get.side_effect = Exception("Redis get error")
        else:
            import json

            mock_client.get.return_value = json.dumps(get_value) if get_value is not None else None
        if set_raises:
            mock_client.setex.side_effect = Exception("Redis set error")
        mock_client.keys.return_value = keys_return or []
        if delete_raises:
            mock_client.delete.side_effect = Exception("Redis delete error")
        mock_redis_module.Redis.from_url.return_value = mock_client
        return mock_redis_module, mock_client

    def test_redis_connected_successfully(self):
        mock_redis_module, mock_client = self._make_mock_redis()
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            r = svc._get_redis()
        assert r is mock_client

    def test_redis_ping_fails_falls_back_to_none(self):
        mock_redis_module, _ = self._make_mock_redis(ping_raises=True)
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            r = svc._get_redis()
        assert r is None

    def test_redis_get_returns_cached_value(self):
        mock_redis_module, mock_client = self._make_mock_redis(get_value={"result": "from_redis"})
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            svc._redis_client = mock_client
            svc._redis_checked = True
            result = svc.get("test_key")
        assert result == {"result": "from_redis"}

    def test_redis_get_error_falls_back_gracefully(self):
        mock_redis_module, mock_client = self._make_mock_redis(get_raises=True)
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            svc._redis_client = mock_client
            svc._redis_checked = True
            result = svc.get("error_key")
        assert result is None

    def test_redis_set_called_when_redis_available(self):
        mock_redis_module, mock_client = self._make_mock_redis()
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            svc._redis_client = mock_client
            svc._redis_checked = True
            svc.set("set_key", {"data": 1}, ttl_seconds=60)
        mock_client.setex.assert_called_once()

    def test_redis_set_error_does_not_raise(self):
        mock_redis_module, mock_client = self._make_mock_redis(set_raises=True)
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            svc._redis_client = mock_client
            svc._redis_checked = True
            # Should not raise
            svc.set("bad_key", {"data": 1})

    def test_redis_clear_deletes_keys(self):
        mock_redis_module, mock_client = self._make_mock_redis(
            keys_return=["provider_cache:a", "provider_cache:b"]
        )
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            svc._redis_client = mock_client
            svc._redis_checked = True
            svc.set("a", "data_a")
            response = svc.clear()
        mock_client.delete.assert_called_once()
        assert response.status == "ok"

    def test_redis_clear_error_does_not_raise(self):
        mock_redis_module, mock_client = self._make_mock_redis(
            keys_return=["provider_cache:x"], delete_raises=True
        )
        with (
            patch("app.services.provider_cache_service.redis", mock_redis_module),
            patch("app.services.provider_cache_service.settings") as mock_settings,
        ):
            mock_settings.REDIS_URL = "redis://localhost:6379"
            svc = ProviderCacheService()
            svc._redis_client = mock_client
            svc._redis_checked = True
            response = svc.clear()
        assert response.status == "ok"
