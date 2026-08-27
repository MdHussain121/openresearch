"""
Coverage-targeted hardening tests: collaboration relay internals, health degradation,
rate-limit helper plumbing, and deterministic AI edit action transforms.
"""

import asyncio
import json

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.endpoints.auth import login_rate_limiter
from app.api.v1.endpoints.collaboration import collab_manager
from app.core.config import settings
from app.core.rate_limit import (
    SlidingWindowRateLimiter,
    get_client_ip,
    rate_limit_dependency,
)
from app.schemas.models import AIEditRequest
from app.services import ai_writing_service as aws_module


class MockWebSocket:
    def __init__(self):
        self.sent_messages = []

    async def accept(self):
        return None

    async def send_json(self, data):
        self.sent_messages.append(data)


class FakePubSub:
    def __init__(self, messages):
        self._messages = messages

    async def psubscribe(self, pattern):
        self.pattern = pattern

    def listen(self):
        return self._iterate()

    def __aiter__(self):
        return self.listen()

    async def _iterate(self):
        for m in self._messages:
            yield m


class FakeRedis:
    def __init__(self, messages=None):
        self._pubsub = FakePubSub(messages or [])
        self.published = []

    def pubsub(self):
        return self._pubsub

    async def publish(self, channel, payload):
        self.published.append((channel, payload))


def _make_request(headers=None, client=("9.9.9.9", 1234)):
    return Request(
        {
            "type": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
            "client": client,
            "method": "GET",
            "path": "/",
        }
    )


class TestRateLimitHelpers:
    def test_get_client_ip_prefers_forwarded_for(self, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_TRUSTED_PROXIES", "9.9.9.9")
        req = _make_request({"X-Forwarded-For": "1.2.3.4, 5.6.7.8"})
        assert get_client_ip(req) == "1.2.3.4"

    def test_get_client_ip_ignores_forwarded_for_untrusted(self):
        req = _make_request({"X-Forwarded-For": "1.2.3.4, 5.6.7.8"})
        assert get_client_ip(req) == "9.9.9.9"

    def test_get_client_ip_falls_back_to_client_host(self):
        req = _make_request()
        assert get_client_ip(req) == "9.9.9.9"

    def test_dependency_wrapper_enforces_limiter(self, monkeypatch):
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=60)
        dep = rate_limit_dependency(limiter)
        req = _make_request()

        dep(req)
        with pytest.raises(HTTPException) as excinfo:
            dep(req)
        assert excinfo.value.status_code == 429
        login_rate_limiter.reset()


class TestCollaborationRelayInternals:
    def test_publish_async_wraps_worker_origin(self):
        fake = FakeRedis()
        original = collab_manager.redis_client
        collab_manager.redis_client = fake
        try:
            asyncio.run(collab_manager._publish_async("doc-x", {"type": "cursor_update"}))
        finally:
            collab_manager.redis_client = original

        channel, payload = fake.published[0]
        assert channel == "collab:doc:doc-x"
        envelope = json.loads(payload)
        assert envelope["origin"] == collab_manager.worker_origin
        assert envelope["msg"] == {"type": "cursor_update"}

    def test_publish_async_noop_without_redis(self):
        original = collab_manager.redis_client
        collab_manager.redis_client = None
        try:
            asyncio.run(collab_manager._publish_async("doc-y", {"type": "ping"}))
        finally:
            collab_manager.redis_client = original

    def test_relay_loop_delivers_foreign_origin_and_skips_own(self):
        doc_id = "doc-relay-1"
        ws = MockWebSocket()
        collab_manager.active_connections[doc_id] = [
            {"ws": ws, "user": {"user_id": "u"}, "joined_at": ""}
        ]

        foreign = json.dumps({"origin": "other-worker", "msg": {"type": "cursor_update"}})
        own = json.dumps({"origin": collab_manager.worker_origin, "msg": {"type": "cursor_update"}})
        malformed = "not-json"

        fake = FakeRedis(
            [
                {"type": "pmessage", "channel": f"collab:doc:{doc_id}", "data": foreign},
                {"type": "pmessage", "channel": f"collab:doc:{doc_id}", "data": own},
                {"type": "pmessage", "channel": f"collab:doc:{doc_id}", "data": malformed},
                {"type": "subscribe", "channel": f"collab:doc:{doc_id}", "data": "1"},
            ]
        )

        original = collab_manager.redis_client
        collab_manager.redis_client = fake
        try:
            asyncio.run(collab_manager._relay_loop())
        finally:
            collab_manager.redis_client = original
            collab_manager.disconnect(ws, doc_id)

        assert ws.sent_messages == [{"type": "cursor_update"}]

    def test_ws_message_types_broadcast_to_room(self):
        """Exercise init_user / cursor_move / doc_edit / comment_sync broadcast branches."""
        from app.api.v1.endpoints.collaboration import (
            router,  # noqa: F401  (router import sanity)
        )

        doc_id = "doc-msg-types"
        ws = MockWebSocket()
        user_info = {
            "client_id": "c1",
            "user_id": "u1",
            "name": "Tester",
            "email": "t@x.org",
            "color": "#000000",
            "cursor": None,
        }
        original_redis = collab_manager.redis_client
        collab_manager.redis_client = None
        collab_manager.active_connections[doc_id] = [{"ws": ws, "user": user_info, "joined_at": ""}]

        async def drive():
            await collab_manager.broadcast(doc_id, {"type": "presence_update", "user": user_info})
            user_info["cursor"] = {"line": 1}
            await collab_manager.broadcast(
                doc_id,
                {
                    "type": "cursor_update",
                    "client_id": "c1",
                    "user": user_info,
                    "cursor": {"line": 1},
                },
                exclude_ws=ws,
            )
            await collab_manager.broadcast(
                doc_id,
                {
                    "type": "doc_edit_broadcast",
                    "client_id": "c1",
                    "delta": {},
                    "content_json": {},
                    "plain_text": "",
                },
                exclude_ws=ws,
            )
            await collab_manager.broadcast(
                doc_id,
                {"type": "comment_event", "action": "created", "comment": {"id": "z"}},
                exclude_ws=ws,
            )

        try:
            asyncio.run(drive())
        finally:
            collab_manager.redis_client = original_redis
            collab_manager.disconnect(ws, doc_id)

        types = [m.get("type") for m in ws.sent_messages]
        assert "presence_update" in types
        assert len(ws.sent_messages) == 1  # exclude_ws suppressed the other three


class TestHealthPingFailurePath:
    def test_health_degrades_when_redis_ping_fails(self, client, monkeypatch):
        class BrokenClient:
            def ping(self):
                raise OSError("redis down")

        from app.services import provider_cache_service as pcs_module

        monkeypatch.setattr(settings, "REDIS_URL", "redis://localhost:6399/0")
        monkeypatch.setattr(pcs_module.provider_cache_service, "_get_redis", lambda: BrokenClient())

        res = client.get("/api/v1/health")
        assert res.status_code == 503
        assert res.json()["components"]["redis"] == "degraded"


class TestAIEditLLMOnlyActions:
    @pytest.mark.parametrize(
        "action,target",
        [
            ("translate", "French"),
            ("translate", "Spanish"),
            ("translate", "German"),
            ("translate", "Chinese"),
            ("translate", "Japanese"),
            ("translate", "Portuguese"),
            ("explain", None),
        ],
    )
    def test_llm_only_actions_fail_honestly_without_provider(self, db, action, target):
        svc = aws_module.ai_writing_service
        req = AIEditRequest(
            text="The model performs well.",
            action=action,
            **({"target_language": target} if target else {}),
        )
        with pytest.raises(aws_module.AIProviderUnavailableError):
            svc.generate_ai_edit(db=db, project_id="empty-project", request=req)
