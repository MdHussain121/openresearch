"""Tests for chat.py SSE streaming endpoint and _resolve_mode."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    return TestClient(app)


def _register(client, email="chat_test@openresearch.org"):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Hardened_Test_Password_123", "name": "Chat Tester"},
    )


def _setup_project(client):
    reg = _register(client).json()
    token = reg["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    proj = client.post("/api/v1/projects", json={"name": "Chat Test"}, headers=headers).json()
    return proj["id"], headers


class TestResolveMode:
    def test_lowercase_normalization(self):
        from app.api.v1.endpoints.chat import _resolve_mode
        assert _resolve_mode("DOCUMENT") == "document"
        assert _resolve_mode("Library") == "library"

    def test_invalid_falls_back_to_project(self):
        from app.api.v1.endpoints.chat import _resolve_mode
        assert _resolve_mode("bogus") == "project"
        assert _resolve_mode("") == "project"

    def test_none_falls_back_to_project(self):
        from app.api.v1.endpoints.chat import _resolve_mode
        assert _resolve_mode(None) == "project"


class TestChatSSE:
    def test_stream_404_unknown_project(self, client):
        reg = _register(client, "sse_404@openresearch.org").json()
        headers = {"Authorization": f"Bearer {reg['access_token']}"}
        res = client.post(
            "/api/v1/projects/nonexistent/chat/stream",
            json={"message": "hi"},
            headers=headers,
        )
        assert res.status_code == 404

    def test_stream_403_non_owner(self, client):
        proj_id, owner_headers = _setup_project(client)
        reg2 = _register(client, "sse_403@openresearch.org").json()
        other_headers = {"Authorization": f"Bearer {reg2['access_token']}"}
        res = client.post(
            f"/api/v1/projects/{proj_id}/chat/stream",
            json={"message": "hi"},
            headers=other_headers,
        )
        assert res.status_code == 403

    @patch("app.api.v1.endpoints.chat.rag_service")
    def test_stream_returns_sse_frames(self, mock_rag, client):
        proj_id, headers = _setup_project(client)
        mock_rag.stream_chat_response.return_value = [
            {"type": "meta", "mode": "project"},
            {"type": "content", "text": "hello"},
            {"type": "done"},
        ]
        res = client.post(
            f"/api/v1/projects/{proj_id}/chat/stream",
            json={"message": "test"},
            headers=headers,
        )
        assert res.status_code == 200
        assert res.headers["content-type"] == "text/event-stream; charset=utf-8"
        lines = [l for l in res.text.split("\n") if l.startswith("data: ")]
        assert len(lines) == 3

    @patch("app.api.v1.endpoints.chat.rag_service")
    def test_stream_error_yields_error_frame(self, mock_rag, client):
        proj_id, headers = _setup_project(client)
        mock_rag.stream_chat_response.side_effect = RuntimeError("llm down")
        res = client.post(
            f"/api/v1/projects/{proj_id}/chat/stream",
            json={"message": "test"},
            headers=headers,
        )
        assert res.status_code == 200
        assert "stream_failed" in res.text

    def test_chat_404_unknown_project(self, client):
        reg = _register(client, "chat_404@openresearch.org").json()
        headers = {"Authorization": f"Bearer {reg['access_token']}"}
        res = client.post(
            "/api/v1/projects/nonexistent/chat",
            json={"message": "hi"},
            headers=headers,
        )
        assert res.status_code == 404

    def test_chat_403_non_owner(self, client):
        proj_id, owner_headers = _setup_project(client)
        reg2 = _register(client, "chat_403@openresearch.org").json()
        other_headers = {"Authorization": f"Bearer {reg2['access_token']}"}
        res = client.post(
            f"/api/v1/projects/{proj_id}/chat",
            json={"message": "hi"},
            headers=other_headers,
        )
        assert res.status_code == 403

    @patch("app.api.v1.endpoints.chat.rag_service")
    def test_rag_search_404(self, mock_rag, client):
        reg = _register(client, "rag_404@openresearch.org").json()
        headers = {"Authorization": f"Bearer {reg['access_token']}"}
        res = client.post(
            "/api/v1/projects/nonexistent/rag/search",
            json={"query": "test"},
            headers=headers,
        )
        assert res.status_code == 404

    @patch("app.api.v1.endpoints.chat.rag_service")
    def test_rag_search_403(self, mock_rag, client):
        proj_id, owner_headers = _setup_project(client)
        reg2 = _register(client, "rag_403@openresearch.org").json()
        other_headers = {"Authorization": f"Bearer {reg2['access_token']}"}
        res = client.post(
            f"/api/v1/projects/{proj_id}/rag/search",
            json={"query": "test"},
            headers=other_headers,
        )
        assert res.status_code == 403
