"""Coverage arms for the local LLM provider chain and provider key store."""

import pytest

from app.services import llm_service as llm_module
from app.services import provider_settings


class FakeClient:
    def __init__(self, response=None, error=None):
        self._response = response
        self._error = error
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        if self._error is not None:
            raise self._error
        return self._response


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def test_openai_compatible_generation_happy_path(monkeypatch):
    provider_settings.set_provider_config("openai", api_key="sk-cov-1234", model="gpt-4o-mini")
    client = FakeClient(
        FakeResponse(200, {"choices": [{"message": {"content": "  cloud text  "}}]})
    )
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: client)

    svc = llm_module.LLMService()
    assert svc.generate([{"role": "user", "content": "hi"}]) == "cloud text"
    call = client.calls[0]
    assert call["url"] == "https://api.openai.com/v1/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer sk-cov-1234"

    provider_settings.delete_provider_config("openai")


def test_openai_compatible_non_200_and_error_fall_back_to_none(monkeypatch):
    provider_settings.set_provider_config(
        "custom", api_key="k", model="m", base_url="http://localhost:1234/v1/"
    )

    failing = FakeClient(FakeResponse(500))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: failing)
    svc = llm_module.LLMService()
    assert svc.generate([{"role": "user", "content": "hi"}]) is None
    # trailing slash on the stored base_url must be normalized away
    assert failing.calls[0]["url"].endswith("/chat/completions")
    assert "//chat" not in failing.calls[0]["url"]

    raising = FakeClient(error=OSError("boom"))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: raising)
    assert svc.generate([{"role": "user", "content": "hi"}]) is None

    empty_choices = FakeClient(FakeResponse(200, {"choices": []}))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: empty_choices)
    assert svc.generate([{"role": "user", "content": "hi"}]) is None

    provider_settings.delete_provider_config("custom")


def test_openai_compatible_without_base_url_returns_none(monkeypatch):
    # Simulate a configured-but-broken custom entry (no base URL)
    store = {
        "providers": {"custom": {"api_key": "k", "model": "m", "base_url": ""}},
        "active": "custom",
    }
    monkeypatch.setattr(provider_settings, "_load_store", lambda: store)

    class NoPost:
        def post(self, *a, **k):
            raise AssertionError("should not attempt HTTP")

    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: NoPost())
    svc = llm_module.LLMService()
    assert svc.generate([{"role": "user", "content": "hi"}]) is None


def test_anthropic_failure_arms_return_none(monkeypatch):
    provider_settings.set_provider_config("anthropic", api_key="ak-cov-5678")

    bad_status = FakeClient(FakeResponse(503))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: bad_status)
    svc = llm_module.LLMService()
    assert svc.generate([{"role": "user", "content": "hi"}]) is None

    raising = FakeClient(error=OSError("network down"))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: raising)
    assert svc.generate([{"role": "user", "content": "hi"}]) is None

    empty_blocks = FakeClient(FakeResponse(200, {"content": []}))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: empty_blocks)
    assert svc.generate([{"role": "user", "content": "hi"}]) is None

    provider_settings.delete_provider_config("anthropic")


def test_mask_key_variants():
    assert provider_settings.mask_key(None) is None
    assert provider_settings.mask_key("") is None
    assert provider_settings.mask_key("short") == "*****"
    masked = provider_settings.mask_key("sk-verylongkeyvalue")
    assert masked.startswith("sk-") and masked.endswith("alue")


def test_store_misc_arms():
    assert provider_settings.set_provider_config("does-not-exist", api_key="x") is None
    assert provider_settings.delete_provider_config("does-not-exist") is False
    assert provider_settings.clear_runtime_cache() is None

    entry = provider_settings.set_provider_config(
        "custom", api_key="key-1", model="my-model", base_url="https://gateway.example/v1/"
    )
    assert entry["configured"] is True
    assert entry["base_url"] == "https://gateway.example/v1"

    # Deleting the active provider falls back to the remaining configured one
    provider_settings.set_provider_config("openai", api_key="sk-fallback", is_active=False)
    assert provider_settings.get_active_provider_name() == "custom"
    provider_settings.delete_provider_config("custom")
    assert provider_settings.get_active_provider_name() == "openai"
    provider_settings.delete_provider_config("openai")


def test_update_custom_provider_without_base_url_is_rejected(client):
    res = client.put("/api/v1/ai/providers/custom", json={"api_key": "k"})
    assert res.status_code == 400


def test_rate_limit_rpm_validation_and_roundtrip():
    with pytest.raises(ValueError):
        provider_settings.set_global_rate_limit(-1)
    with pytest.raises(ValueError):
        provider_settings.set_global_rate_limit(999999)

    assert provider_settings.set_global_rate_limit(30) == 30
    assert provider_settings.get_global_rate_limit() == 30

    # Zero and None both mean unlimited.
    provider_settings.set_global_rate_limit(0)
    assert provider_settings.get_global_rate_limit() is None
    provider_settings.set_global_rate_limit(None)
    assert provider_settings.get_global_rate_limit() is None


def test_cloud_generation_blocked_by_global_rate_limit(monkeypatch):
    provider_settings.set_global_rate_limit(2)
    provider_settings.set_provider_config("anthropic", api_key="ak-rate")
    ok = FakeClient(FakeResponse(200, {"content": [{"text": "cloud"}]}))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: ok)

    svc = llm_module.LLMService()
    messages = [{"role": "user", "content": "hi"}]
    assert svc.generate(messages) == "cloud"
    assert svc.generate(messages) == "cloud"

    # Third call inside the window exceeds the shared cap: no HTTP attempt,
    # cloud returns None and generate falls through to the Ollama fallback.
    class NoPost:
        def post(self, *a, **k):
            raise AssertionError("rate limit should block HTTP")

    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: NoPost())
    monkeypatch.setattr(svc, "_probe_availability", lambda: False)

    # The bucket is shared across providers, not per provider.
    provider_settings.delete_provider_config("anthropic")
    provider_settings.set_provider_config("openai", api_key="sk-rate")
    assert svc.generate(messages) is None
    assert len(ok.calls) == 2

    provider_settings.delete_provider_config("openai")
    provider_settings.set_global_rate_limit(None)


def test_cloud_rate_limit_endpoint_roundtrip(client):
    res = client.get("/api/v1/ai/rate-limit")
    assert res.status_code == 200
    assert res.json() == {"rate_limit_rpm": None}

    res = client.put("/api/v1/ai/rate-limit", json={"rate_limit_rpm": 45})
    assert res.status_code == 200
    assert res.json() == {"rate_limit_rpm": 45}
    assert client.get("/api/v1/ai/rate-limit").json()["rate_limit_rpm"] == 45

    assert client.put("/api/v1/ai/rate-limit", json={"rate_limit_rpm": -5}).status_code == 400
    assert (
        client.put("/api/v1/ai/rate-limit", json={"rate_limit_rpm": None}).json()["rate_limit_rpm"]
        is None
    )
