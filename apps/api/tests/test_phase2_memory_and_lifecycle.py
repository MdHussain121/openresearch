import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.collaboration import collab_manager
from app.core.http_client import (
    close_http_client,
    get_async_http_client,
    get_sync_http_client,
    init_http_client,
)
from app.services.identifier_resolver import identifier_resolver
from app.services.provider_cache_service import ProviderCacheService


def test_provider_cache_bounded_lru_eviction():
    """Test that ProviderCacheService strictly bounds capacity and evicts LRU items."""
    cache = ProviderCacheService(default_ttl_seconds=300, max_entries=3)

    # Fill cache up to capacity
    cache.set("key1", {"val": 1})
    cache.set("key2", {"val": 2})
    cache.set("key3", {"val": 3})
    assert len(cache._cache) == 3

    # Access key1 so key2 becomes least recently used
    res1 = cache.get("key1")
    assert res1 == {"val": 1}

    # Insert key4 -> key2 should be evicted (LRU)
    cache.set("key4", {"val": 4})
    assert len(cache._cache) == 3
    assert cache.get("key2") is None  # Evicted
    assert cache.get("key1") == {"val": 1}  # Kept
    assert cache.get("key3") == {"val": 3}  # Kept
    assert cache.get("key4") == {"val": 4}  # Kept


def test_provider_cache_ttl_expiration():
    """Test that expired cache entries are removed on get."""
    cache = ProviderCacheService(default_ttl_seconds=1, max_entries=10)
    cache.set("short_key", {"status": "fresh"}, ttl_seconds=1)

    # Immediately accessible
    assert cache.get("short_key") == {"status": "fresh"}

    # Override expires_at to simulate time passage
    cache._cache["short_key"]["expires_at"] = time.time() - 1.0

    # Expired entry should return None and be removed
    assert cache.get("short_key") is None
    assert "short_key" not in cache._cache


def test_provider_cache_clear_and_quota_status():
    """Test clearing cache and quota status metrics reporting."""
    cache = ProviderCacheService(default_ttl_seconds=300, max_entries=10)
    cache.set("k1", "v1", provider_name="Crossref")
    cache.set("k2", "v2", provider_name="Crossref")
    assert len(cache._cache) == 2

    # Hit and miss
    assert cache.get("k1", provider_name="Crossref") == "v1"
    assert cache.get("nonexistent", provider_name="Crossref") is None

    status = cache.get_quota_status()
    assert status.total_cached_queries == 2
    assert len(status.providers) == 3

    clear_res = cache.clear()
    assert clear_res.cleared_entries == 2
    assert len(cache._cache) == 0


@pytest.mark.asyncio
async def test_pooled_http_client_lifecycle():
    """Test shared HTTP client pool initialization, retrieval, and closing."""
    await init_http_client()
    async_client = get_async_http_client()
    sync_client = get_sync_http_client()

    assert async_client is not None
    assert not async_client.is_closed
    assert sync_client is not None
    assert not sync_client.is_closed

    # Consecutive calls return singleton
    assert get_async_http_client() is async_client
    assert get_sync_http_client() is sync_client

    await close_http_client()

    # Re-initializes on demand after close
    new_client = get_async_http_client()
    assert not new_client.is_closed
    await close_http_client()


def test_get_async_client_without_running_loop():
    """Sync context (no running loop) still yields a usable pooled client."""
    client = get_async_http_client()
    assert client is not None
    assert not client.is_closed
    # Drop the singleton so later loop-bound tests start clean.
    import app.core.http_client as http_client_module

    http_client_module._async_client = None
    http_client_module._async_client_loop_id = None


@pytest.mark.asyncio
async def test_close_http_client_survives_dead_loop(monkeypatch):
    """A failing aclose (e.g. event loop closed mid-flight) must not raise."""
    await init_http_client()
    client = get_async_http_client()

    async def boom():
        raise RuntimeError("Event loop is closed")

    monkeypatch.setattr(client, "aclose", boom)
    await close_http_client()  # must swallow the RuntimeError

    # State fully reset: next access re-creates the pool.
    fresh = get_async_http_client()
    assert fresh is not None and fresh is not client
    assert not fresh.is_closed
    await close_http_client()


@pytest.mark.asyncio
async def test_get_async_client_rebinds_after_loop_change(monkeypatch):
    """A client tied to a previous event loop is replaced on the new loop."""
    await init_http_client()
    first = get_async_http_client()

    fake_other_loop = object()  # distinct id simulates a foreign loop
    monkeypatch.setattr("app.core.http_client.asyncio.get_running_loop", lambda: fake_other_loop)
    second = get_async_http_client()

    assert second is not first
    assert not second.is_closed

    monkeypatch.undo()
    await close_http_client()


@pytest.mark.asyncio
async def test_identifier_resolver_uses_pooled_client():
    """identifier_resolver resolves DOI/arXiv metadata through the shared HTTP client boundary."""
    crossref_resp = MagicMock()
    crossref_resp.status_code = 200
    crossref_resp.json.return_value = {
        "message": {
            "title": ["Measurements of the Higgs boson"],
            "author": [{"family": "Sirunyan", "given": "A."}],
            "issued": {"date-parts": [[2020]]},
            "container-title": ["Physics Letters B"],
        }
    }
    arxiv_resp = MagicMock()
    arxiv_resp.status_code = 200
    arxiv_resp.text = (
        "<feed><entry>"
        "<title>Pooled Client Resolution Paper</title>"
        "<published>2024-01-15T00:00:00Z</published>"
        "<summary>Hermetic pooled client check.</summary>"
        "<author><name>Ada Lovelace</name></author>"
        "</entry></feed>"
    )

    pooled_client = MagicMock()
    pooled_client.get = AsyncMock(side_effect=[crossref_resp, arxiv_resp])

    with patch(
        "app.services.identifier_resolver.get_async_http_client", return_value=pooled_client
    ):
        res = await identifier_resolver.resolve("10.5555/pooled-client-doi", "doi")
        assert res is not None
        assert res["id_type"] == "doi"
        assert res["title"] == "Measurements of the Higgs boson"
        assert res["authors"][0]["familyName"] == "Sirunyan"
        assert res["year"] == 2020

        res_arxiv = await identifier_resolver.resolve("2401.12345", "arxiv")
        assert res_arxiv is not None
        assert res_arxiv["id_type"] == "arxiv"
        assert res_arxiv["title"] == "Pooled Client Resolution Paper"
        assert res_arxiv["authors"][0]["literal"] == "Ada Lovelace"

    # Both resolutions went through one shared pooled client.
    assert pooled_client.get.await_count == 2


def test_collaboration_manager_lifecycle():
    """Test CollaborationRoomManager presence lifecycle (accept happens in the WS endpoint)."""
    doc_id = "doc-test-lifecycle-123"

    class MockWebSocket:
        def __init__(self):
            self.accepted = False
            self.sent_messages = []

        async def accept(self):
            self.accepted = True

        async def send_json(self, data):
            self.sent_messages.append(data)

    ws = MockWebSocket()
    user_info = {"user_id": "u1", "name": "Alice"}

    import asyncio

    # The WS endpoint performs the accept handshake before registering presence.
    asyncio.run(ws.accept())
    assert ws.accepted is True

    asyncio.run(collab_manager.connect(ws, doc_id, user_info))
    assert len(collab_manager.get_room_users(doc_id)) == 1

    # Disconnect
    collab_manager.disconnect(ws, doc_id)
    assert len(collab_manager.get_room_users(doc_id)) == 0
    assert doc_id not in collab_manager.active_connections


def test_system_provider_status_api(client: TestClient):
    """Test the provider status endpoint requiring authentication."""
    # Register user
    reg = client.post(
        "/api/v1/auth/register",
        json={
            "email": "cache_tester@openresearch.org",
            "password": "Password123",
            "name": "Cache Tester",
        },
    ).json()
    headers = {"Authorization": f"Bearer {reg['access_token']}"}

    # Get status
    resp = client.get("/api/v1/system/provider-status", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "providers" in data
    assert "total_cached_queries" in data

    # Clear cache
    clear_resp = client.post("/api/v1/system/provider-cache/clear", headers=headers)
    assert clear_resp.status_code == 200
    assert clear_resp.json()["status"] == "ok"
