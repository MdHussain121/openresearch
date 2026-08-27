"""Tests for app.core.rate_limit — proxy trust, sweep, and get_client_ip."""

import time
from unittest.mock import MagicMock

from fastapi import Request

from app.core.rate_limit import (
    SlidingWindowRateLimiter,
    _is_trusted_proxy,
    get_client_ip,
    rate_limit_dependency,
)


class TestIsTrustedProxy:
    def test_no_env_returns_false(self, monkeypatch):
        monkeypatch.delenv("OPENRESEARCH_TRUSTED_PROXIES", raising=False)
        assert _is_trusted_proxy("10.0.0.1") is False

    def test_empty_env_returns_false(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "  ")
        assert _is_trusted_proxy("10.0.0.1") is False

    def test_exact_match(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "10.0.0.1")
        assert _is_trusted_proxy("10.0.0.1") is True
        assert _is_trusted_proxy("10.0.0.2") is False

    def test_cidr_match(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "10.0.0.0/24")
        assert _is_trusted_proxy("10.0.0.5") is True
        assert _is_trusted_proxy("10.0.1.5") is False

    def test_invalid_ip_returns_false(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "10.0.0.1")
        assert _is_trusted_proxy("not-an-ip") is False

    def test_invalid_cidr_entry_skipped(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "bad-cidr/abc,10.0.0.1")
        assert _is_trusted_proxy("10.0.0.1") is True

    def test_multiple_entries(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "192.168.1.1,10.0.0.0/8")
        assert _is_trusted_proxy("192.168.1.1") is True
        assert _is_trusted_proxy("10.1.2.3") is True
        assert _is_trusted_proxy("172.16.0.1") is False


class TestGetClientIp:
    def _make_request(self, client_host="127.0.0.1", xff=None):
        mock_client = MagicMock()
        mock_client.host = client_host
        request = MagicMock(spec=Request)
        request.client = mock_client
        headers = {}
        if xff:
            headers["x-forwarded-for"] = xff
        request.headers = headers
        return request

    def test_no_forwarding(self, monkeypatch):
        monkeypatch.delenv("OPENRESEARCH_TRUSTED_PROXIES", raising=False)
        req = self._make_request(client_host="1.2.3.4")
        assert get_client_ip(req) == "1.2.3.4"

    def test_forwarded_trusted_proxy(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "10.0.0.1")
        req = self._make_request(client_host="10.0.0.1", xff="203.0.113.5, 70.41.3.18")
        assert get_client_ip(req) == "203.0.113.5"

    def test_forwarded_untrusted_ignored(self, monkeypatch):
        monkeypatch.delenv("OPENRESEARCH_TRUSTED_PROXIES", raising=False)
        req = self._make_request(client_host="5.6.7.8", xff="203.0.113.5")
        assert get_client_ip(req) == "5.6.7.8"

    def test_no_client(self):
        request = MagicMock(spec=Request)
        request.client = None
        request.headers = {}
        assert get_client_ip(request) == "unknown"


class TestSlidingWindowRateLimiter:
    def test_bypass_in_test_environment(self):
        limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=10)
        limiter.check("key1")
        limiter.check("key1")
        limiter.check("key1")

    def test_sweep_removes_stale_keys(self):
        limiter = SlidingWindowRateLimiter(max_requests=100, window_seconds=1)
        limiter._hits["old_key"].append(time.monotonic() - 10)
        limiter._sweep_stale_keys(time.monotonic())
        assert "old_key" not in limiter._hits

    def test_sweep_skipped_if_interval_not_elapsed(self):
        limiter = SlidingWindowRateLimiter(max_requests=100, window_seconds=60)
        limiter._last_sweep = time.monotonic()
        limiter._hits["k"].append(time.monotonic() - 100)
        limiter._sweep_stale_keys(time.monotonic())
        assert "k" in limiter._hits

    def test_reset_clears_all(self):
        limiter = SlidingWindowRateLimiter(max_requests=100, window_seconds=10)
        limiter._hits["a"].append(time.monotonic())
        limiter._hits["b"].append(time.monotonic())
        limiter.reset()
        assert len(limiter._hits) == 0


class TestRateLimitDependency:
    def test_include_ip_false_uses_global_key(self):
        limiter = SlidingWindowRateLimiter(max_requests=100, window_seconds=10)
        dep = rate_limit_dependency(limiter, include_ip=False)
        mock_request = MagicMock(spec=Request)
        mock_request.client = MagicMock()
        mock_request.client.host = "1.2.3.4"
        mock_request.headers = {}
        dep(mock_request)
