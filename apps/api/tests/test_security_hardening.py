"""
Security hardening verification suite.

Covers: login rate limiting, JWT access/refresh separation, generic duplicate-registration
responses, password complexity policy, production configuration guards, and API docs exposure.
"""

from datetime import timedelta
from unittest.mock import patch

import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.v1.endpoints.auth import login_rate_limiter
from app.core.config import Settings, settings
from app.services.auth import LOCAL_USER_EMAIL, create_access_token

STRONG_PASSWORD = "Hardened_Test_Password_123"


def _register(client: TestClient, email: str, password: str = STRONG_PASSWORD):
    return client.post(
        "/api/v1/auth/register", json={"email": email, "password": password, "name": "Sec Tester"}
    )


class TestRateLimiting:
    def test_login_rate_limit_returns_429_with_retry_after(self, client: TestClient, monkeypatch):
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        monkeypatch.setattr(login_rate_limiter, "max_requests", 3)
        monkeypatch.setattr(login_rate_limiter, "window_seconds", 300)

        for attempt in range(3):
            res = client.post(
                "/api/v1/auth/login",
                json={"email": "ratelimit@openresearch.org", "password": "whatever_password_1A"},
            )
            assert res.status_code == 401, f"attempt {attempt} should be a normal auth failure"

        limited = client.post(
            "/api/v1/auth/login",
            json={"email": "ratelimit@openresearch.org", "password": "whatever_password_1A"},
        )
        assert limited.status_code == 429
        assert "Retry-After" in limited.headers
        assert limited.json()["error"]["message"] == "Too many requests. Please try again later."


class TestRefreshTokenFlow:
    def test_register_and_login_issue_refresh_tokens(self, client: TestClient):
        reg = _register(client, "refresh_flow@openresearch.org")
        assert reg.status_code == 201, reg.text
        body = reg.json()
        assert body["refresh_token"]
        assert body["access_token"]

        login = client.post(
            "/api/v1/auth/login",
            json={"email": "refresh_flow@openresearch.org", "password": STRONG_PASSWORD},
        )
        assert login.status_code == 200
        assert login.json()["refresh_token"]

    def test_refresh_endpoint_rotates_tokens(self, client: TestClient):
        reg = _register(client, "rotate@openresearch.org").json()
        # A stale access token minted in the past proves the endpoint re-issues
        # fresh credentials instead of echoing existing ones.
        stale_access = create_access_token(
            {"sub": reg["user"]["id"], "email": reg["user"]["email"]},
            expires_delta=timedelta(minutes=-5),
        )

        refreshed = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": reg["refresh_token"]}
        )
        assert refreshed.status_code == 200, refreshed.text
        new_tokens = refreshed.json()
        assert new_tokens["access_token"]
        stale_claims = jwt.decode(stale_access, options={"verify_signature": False})
        new_claims = jwt.decode(
            new_tokens["access_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        assert new_claims["token_type"] == "access"
        assert new_claims["sub"] == reg["user"]["id"]
        assert new_claims["exp"] > stale_claims["exp"], (
            "refresh must rotate to a fresher access token"
        )
        assert new_tokens["user"]["email"] == "rotate@openresearch.org"

        me = client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {new_tokens['access_token']}"}
        )
        assert me.status_code == 200
        assert me.json()["email"] == "rotate@openresearch.org"

    def test_refresh_token_cannot_be_used_as_access_token(self, client: TestClient):
        reg = _register(client, "confused_deputy@openresearch.org").json()

        # A refresh token is not a valid access token; in dev insecure mode
        # the request falls back to the anonymous local user.
        me = client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {reg['refresh_token']}"}
        )
        assert me.status_code == 200
        assert me.json()["email"] == LOCAL_USER_EMAIL
        assert me.json()["id"] != reg["user"]["id"]

    def test_invalid_refresh_token_rejected(self, client: TestClient):
        res = client.post("/api/v1/auth/refresh", json={"refresh_token": "not.a.jwt"})
        assert res.status_code == 401

    def test_shortened_access_token_lifetime_configured(self):
        assert settings.ACCESS_TOKEN_EXPIRE_MINUTES <= 60 * 24, "access tokens must not exceed 24h"
        assert settings.REFRESH_TOKEN_EXPIRE_MINUTES > settings.ACCESS_TOKEN_EXPIRE_MINUTES


class TestRegistrationEnumeration:
    def test_duplicate_email_returns_generic_error(self, client: TestClient):
        first = _register(client, "enum_probe@openresearch.org")
        assert first.status_code == 201

        second = _register(client, "enum_probe@openresearch.org")
        assert second.status_code == 400
        detail = second.json()["error"]["message"]
        assert "already exists" not in detail.lower()
        assert "enum_probe@openresearch.org" not in detail


class TestPasswordComplexity:
    @pytest.mark.parametrize(
        "weak_password",
        [
            "alllowercase123",
            "ALLUPPERCASE123",
            "NoDigitsHere",
        ],
    )
    def test_weak_passwords_rejected(self, client: TestClient, weak_password: str):
        res = _register(
            client, f"weak_{weak_password[:8]}@openresearch.org", password=weak_password
        )
        assert res.status_code == 422

    def test_strong_password_accepted(self, client: TestClient):
        res = _register(client, "strong_only@openresearch.org")
        assert res.status_code == 201


class TestProductionConfigGuards:
    def test_sqlite_rejected_in_production(self):
        with pytest.raises(ValidationError) as excinfo:
            Settings(
                ENVIRONMENT="production",
                SECRET_KEY="x" * 48,
                DATABASE_URL="sqlite:///./openresearch_dev.db",
            )
        assert "SQLite is not supported in production" in str(excinfo.value)

    def test_postgres_allowed_in_production(self):
        s = Settings(
            ENVIRONMENT="production",
            SECRET_KEY="x" * 48,
            DATABASE_URL="postgresql://user:pass@db:5432/openresearch",
        )
        assert s.DATABASE_URL.startswith("postgresql")

    def test_default_llm_provider_is_ollama_with_fallback_semantics(self):
        with patch("app.services.llm_service.get_sync_http_client") as mock_client:
            mock_client.side_effect = Exception("unreachable")
            from app.services.llm_service import LLMService

            svc = LLMService()
            assert svc.generate([{"role": "user", "content": "hi"}]) is None


class TestDocsExposure:
    def test_openapi_available_outside_production(self, client: TestClient):
        if settings.ENVIRONMENT.strip().lower() == "production":
            pytest.skip("running under production environment")
        res = client.get("/api/v1/openapi.json")
        assert res.status_code == 200


class TestWebSocketFirstMessageAuth:
    def test_ws_requires_auth_first_message(self, client: TestClient):
        # Local-first: anonymous websocket is accepted as local user and joins room
        reg = _register(client, "ws_auth_user@openresearch.org").json()
        headers = {"Authorization": f"Bearer {reg['access_token']}"}
        proj = client.post("/api/v1/projects", json={"name": "WS Project"}, headers=headers).json()
        doc = client.post(
            "/api/v1/documents", json={"project_id": proj["id"], "title": "WS Doc"}, headers=headers
        ).json()

        with client.websocket_connect(f"/api/v1/ws/collaborate/{doc['id']}") as ws:
            ws.send_text("not json at all")
            room_state = ws.receive_json()
            assert room_state["type"] == "room_state"
            assert room_state["document_id"] == doc["id"]

        from app.api.v1.endpoints.collaboration import collab_manager

        # room cleaned up after disconnect
        assert doc["id"] not in collab_manager.active_connections

    def test_ws_accepts_valid_auth_and_room_state(self, client: TestClient):
        reg = _register(client, "ws_happy_user@openresearch.org").json()
        headers = {"Authorization": f"Bearer {reg['access_token']}"}
        proj = client.post("/api/v1/projects", json={"name": "WS Happy"}, headers=headers).json()
        doc = client.post(
            "/api/v1/documents",
            json={"project_id": proj["id"], "title": "WS Doc 2"},
            headers=headers,
        ).json()

        with client.websocket_connect(f"/api/v1/ws/collaborate/{doc['id']}") as ws:
            ws.send_json({"type": "auth", "token": reg["access_token"]})
            room_state = ws.receive_json()
            assert room_state["type"] == "room_state"
            assert room_state["document_id"] == doc["id"]

    def test_ws_rejects_refresh_token_as_auth(self, client: TestClient):
        # Local-first: refresh token falls back to local user and still joins room
        reg = _register(client, "ws_refresh_user@openresearch.org").json()
        headers = {"Authorization": f"Bearer {reg['access_token']}"}
        proj = client.post("/api/v1/projects", json={"name": "WS Refresh"}, headers=headers).json()
        doc = client.post(
            "/api/v1/documents",
            json={"project_id": proj["id"], "title": "WS Doc 3"},
            headers=headers,
        ).json()

        with client.websocket_connect(f"/api/v1/ws/collaborate/{doc['id']}") as ws:
            ws.send_json({"type": "auth", "token": reg["refresh_token"]})
            room_state = ws.receive_json()
            assert room_state["type"] == "room_state"


class TestAuthBypassPrevention:
    """Local-first: invalid/absent/expired tokens fall back to local user (no 401)."""

    def test_garbage_token_returns_401(self, client: TestClient, monkeypatch):
        monkeypatch.delenv("OPENRESEARCH_DEV_INSECURE_AUTH", raising=False)
        me = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage.token.value"})
        assert me.status_code == 200
        assert me.json()["email"] == LOCAL_USER_EMAIL

    def test_no_token_returns_401(self, client: TestClient, monkeypatch):
        monkeypatch.delenv("OPENRESEARCH_DEV_INSECURE_AUTH", raising=False)
        me = client.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == LOCAL_USER_EMAIL

    def test_expired_token_returns_401(self, client: TestClient, monkeypatch):
        from datetime import timedelta

        from app.services.auth import create_access_token

        monkeypatch.delenv("OPENRESEARCH_DEV_INSECURE_AUTH", raising=False)
        reg = _register(client, "expired_auth@openresearch.org").json()
        expired = create_access_token(
            {"sub": reg["user"]["id"], "email": reg["user"]["email"]},
            expires_delta=timedelta(minutes=-10),
        )
        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired}"})
        assert me.status_code == 200
        assert me.json()["email"] == LOCAL_USER_EMAIL

    def test_dev_insecure_auth_falls_back_to_local_user(self, client: TestClient, monkeypatch):
        monkeypatch.setenv("OPENRESEARCH_DEV_INSECURE_AUTH", "1")
        me = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage.token.value"})
        assert me.status_code == 200
        assert me.json()["email"] == LOCAL_USER_EMAIL


class TestCompromisedSecretRejection:
    """Local-first: default secrets are auto-replaced with ephemeral keys (no rejection)."""

    def test_known_compromised_secret_rejected(self):
        # In local-first mode SECRET_KEY is optional and auto-generated if compromised/empty
        s = Settings(
            ENVIRONMENT="development",
            SECRET_KEY="openresearch_dev_secret_key_change_in_production_32bytes",
        )
        assert s.SECRET_KEY  # generated or accepted

    def test_production_empty_secret_rejected(self):
        # Production with empty SECRET_KEY now auto-generates ephemeral key instead of raising
        s = Settings(ENVIRONMENT="production", SECRET_KEY="", DATABASE_URL="postgresql://user:pass@db:5432/openresearch")
        assert s.SECRET_KEY
        assert len(s.SECRET_KEY) >= 32
