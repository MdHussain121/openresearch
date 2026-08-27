"""Local single-user mode and AI provider API-key settings (no login required)."""

import json

import pytest
from fastapi.testclient import TestClient

from app.services import provider_settings
from app.services.auth import LOCAL_USER_EMAIL


class SimplePostClient:
    def __init__(self, post):
        self._post = post

    def post(self, *args, **kwargs):
        return self._post(*args, **kwargs)

    def get(self, *args, **kwargs):
        raise OSError("no probe expected")


def test_local_user_is_auto_provisioned_without_token(client: TestClient):
    """A request with no Authorization header still succeeds as the local user."""
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == LOCAL_USER_EMAIL
    assert body["name"] == "Local Researcher"
    assert body["is_admin"] is True


def test_local_user_owns_its_projects(client: TestClient):
    created = client.post("/api/v1/projects", json={"name": "Local Research"})
    assert created.status_code == 201, created.text

    listed = client.get("/api/v1/projects")
    assert listed.status_code == 200
    names = [p["name"] for p in listed.json()]
    assert "Local Research" in names


def test_provider_settings_store_roundtrip():
    assert provider_settings.get_active_provider_name() is None
    assert provider_settings.list_provider_configs()[0]["configured"] is False

    entry = provider_settings.set_provider_config(
        "openai", api_key="sk-test-abcd1234", model="gpt-4o-mini"
    )
    assert entry["configured"] is True
    assert entry["masked_key"].endswith("1234")
    assert "sk-test" not in (entry["masked_key"] or "")

    assert provider_settings.get_active_provider_name() == "openai"
    creds = provider_settings.get_provider_credentials("openai")
    assert creds is not None
    assert creds["api_key"] == "sk-test-abcd1234"
    assert creds["base_url"] == "https://api.openai.com/v1"

    # Keys are persisted to the local store file and never returned in full via list
    with open(provider_settings._store_path(), encoding="utf-8") as fh:
        raw = json.load(fh)
    assert raw["providers"]["openai"]["api_key"] == "sk-test-abcd1234"

    assert provider_settings.delete_provider_config("openai") is True
    assert provider_settings.get_active_provider_name() is None


def test_custom_provider_requires_base_url():
    with pytest.raises(ValueError):
        provider_settings.set_provider_config("custom", api_key="lmstudio-key")


def test_ai_providers_endpoints_flow(client: TestClient):
    listing = client.get("/api/v1/ai/providers")
    assert listing.status_code == 200
    data = listing.json()
    assert data["active"] is None
    assert {p["provider"] for p in data["providers"]} == {"openai", "anthropic", "custom"}
    assert all(p["configured"] is False for p in data["providers"])

    saved = client.put(
        "/api/v1/ai/providers/openai",
        json={"api_key": "sk-endpoint-9876", "model": "gpt-4o-mini"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["active"] == "openai"

    listing = client.get("/api/v1/ai/providers")
    openai_entry = next(p for p in listing.json()["providers"] if p["provider"] == "openai")
    assert openai_entry["configured"] is True
    assert openai_entry["masked_key"] is not None
    assert "sk-endpoint-9876" not in listing.text

    cleared = client.delete("/api/v1/ai/providers/openai")
    assert cleared.status_code == 204

    missing = client.delete("/api/v1/ai/providers/openai")
    assert missing.status_code == 404

    unknown = client.put("/api/v1/ai/providers/nope", json={"api_key": "x"})
    assert unknown.status_code == 404


def test_llm_service_prefers_configured_cloud_provider(monkeypatch):
    from app.services import llm_service as llm_module

    provider_settings.set_provider_config("anthropic", api_key="ak-test-1234")

    calls = {}

    class FakeResponse:
        status_code = 200

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    def fake_post(url, json=None, headers=None, timeout=None):
        calls["url"] = url
        calls["json"] = json
        calls["headers"] = headers
        return FakeResponse(
            {
                "content": [{"type": "text", "text": " cloud reply "}],
                "choices": [{"message": {"content": ""}}],
            }
        )

    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: SimplePostClient(fake_post))

    svc = llm_module.LLMService()
    result = svc.generate([{"role": "user", "content": "hi"}])
    assert result == "cloud reply"
    assert calls["url"].startswith("https://api.anthropic.com")
    assert calls["headers"]["x-api-key"] == "ak-test-1234"

    provider_settings.delete_provider_config("anthropic")
