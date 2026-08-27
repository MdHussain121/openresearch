"""Streaming arms of LLMService: Ollama NDJSON, OpenAI-compatible SSE, Anthropic SSE, think-tag routing."""

import json

from app.services import llm_service as llm_module
from app.services import provider_settings

MESSAGES = [{"role": "user", "content": "hi"}]


class FakeStreamResponse:
    def __init__(self, lines, status_code=200):
        self.status_code = status_code
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def iter_lines(self):
        return iter(self._lines)


class FakeStreamClient:
    """Records stream() calls and replays canned NDJSON/SSE lines; optional get() probe support."""

    def __init__(self, lines=(), status_code=200, error=None, probe_status=200):
        self._lines = list(lines)
        self._status = status_code
        self._error = error
        self._probe_status = probe_status
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        if self._error is not None:
            raise self._error
        return FakeStreamResponse(self._lines, self._status)

    def get(self, *a, **k):
        class _Probe:
            status_code = self._probe_status

        return _Probe()

    def post(
        self, *a, **k
    ):  # pragma: no cover - only used if code wrongly falls back to non-streaming
        raise AssertionError("unexpected non-streaming POST")


def _sse_data(obj) -> str:
    return "data: " + json.dumps(obj)


def test_stream_ollama_routes_content_thinking_and_split_tags(monkeypatch):
    svc = llm_module.LLMService()
    monkeypatch.setattr(svc, "_probe_availability", lambda: True)

    ndjson = [
        json.dumps({"message": {"content": "Hello <think>hmm</think> world"}}),
        "",
        "{not valid json",
        json.dumps({"message": {"thinking": "deep thought", "content": "tail"}}),
        json.dumps({"message": {"content": "<think>partial"}}),
    ]
    client = FakeStreamClient(ndjson)
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: client)

    out = list(svc._stream_ollama(MESSAGES, timeout_seconds=None, temperature=0.3))

    assert out == [
        ("content", "Hello "),
        ("thinking", "hmm"),
        ("content", " world"),
        ("thinking", "deep thought"),
        ("content", "tail"),
        ("thinking", "partial"),
    ]
    call = client.calls[0]
    assert call["url"].endswith("/api/chat")
    assert call["json"]["stream"] is True


def test_stream_ollama_unavailable_or_non_200_yields_nothing(monkeypatch):
    svc = llm_module.LLMService()
    monkeypatch.setattr(svc, "_probe_availability", lambda: False)
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: FakeStreamClient())
    assert list(svc._stream_ollama(MESSAGES, None, 0.3)) == []

    monkeypatch.setattr(svc, "_probe_availability", lambda: True)
    client = FakeStreamClient(['{"message": {"content": "x"}}'], status_code=503)
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: client)
    assert list(svc._stream_ollama(MESSAGES, None, 0.3)) == []
    assert svc._available is False


def test_stream_openai_compatible_sse_with_reasoning_and_done(monkeypatch):
    provider_settings.set_provider_config(
        "custom", api_key="sk-stream", model="m", base_url="http://llm.example/v1/"
    )
    svc = llm_module.LLMService()
    # Keep the suite hermetic: if a cloud arm produces nothing, the Ollama
    # fallback must short-circuit instead of dialing a local server.
    monkeypatch.setattr(svc, "_probe_availability", lambda: False)

    sse_lines = [
        _sse_data({"choices": [{"delta": {"reasoning_content": "why"}}]}),
        "data: {broken json",
        _sse_data({"choices": []}),
        _sse_data({"choices": [{"delta": {"content": "Hi"}}]}),
        "data: [DONE]",
        _sse_data({"choices": [{"delta": {"content": "after-done"}}]}),
    ]
    client = FakeStreamClient(sse_lines)
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: client)

    out = list(svc.stream_generate(MESSAGES))
    assert out == [("thinking", "why"), ("content", "Hi")]

    call = client.calls[0]
    assert call["url"] == "http://llm.example/v1/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer sk-stream"
    assert call["headers"]["Accept"] == "text/event-stream"

    # Non-200 streams yield nothing.
    failing = FakeStreamClient(status_code=500)
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: failing)
    assert list(svc.stream_generate(MESSAGES)) == []

    # A configured-but-baseless custom entry yields nothing and skips HTTP entirely.
    store = {
        "providers": {"custom": {"api_key": "k", "model": "m", "base_url": ""}},
        "active": "custom",
    }
    monkeypatch.setattr(provider_settings, "_load_store", lambda: store)
    no_http = FakeStreamClient()
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: no_http)
    assert list(svc.stream_generate(MESSAGES)) == []

    provider_settings.delete_provider_config("custom")


def test_stream_anthropic_thinking_and_text_deltas(monkeypatch):
    provider_settings.set_provider_config("anthropic", api_key="ak-stream")
    svc = llm_module.LLMService()
    monkeypatch.setattr(svc, "_probe_availability", lambda: False)

    sse_lines = [
        _sse_data({"type": "ping"}),
        _sse_data(
            {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "t1"}}
        ),
        "data: {oops",
        _sse_data({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "a1"}}),
        _sse_data({"type": "content_block_delta", "delta": {"type": "text_delta", "text": ""}}),
    ]
    client = FakeStreamClient(sse_lines)
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: client)

    messages = [{"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]
    out = list(svc.stream_generate(messages))
    assert out == [("thinking", "t1"), ("content", "a1")]

    call = client.calls[0]
    assert call["url"] == "https://api.anthropic.com/v1/messages"
    assert call["headers"]["x-api-key"] == "ak-stream"
    assert call["json"]["system"] == "be brief"
    assert all(m.get("role") != "system" for m in call["json"]["messages"])

    failing = FakeStreamClient(status_code=401)
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: failing)
    assert list(svc.stream_generate(MESSAGES)) == []

    provider_settings.delete_provider_config("anthropic")


def test_stream_generate_falls_back_to_ollama_when_cloud_fails(monkeypatch):
    provider_settings.set_provider_config("openai", api_key="sk-fb")
    svc = llm_module.LLMService()

    # Cloud stream raises before producing anything -> Ollama fallback serves the request.
    broken_cloud = FakeStreamClient(error=OSError("gateway gone"))
    ollama_ndjson = [json.dumps({"message": {"content": "local answer"}})]
    ollama_client = FakeStreamClient(ollama_ndjson)

    clients: list = []

    def client_factory():
        clients.append(None)
        return broken_cloud if len(clients) == 1 else ollama_client

    monkeypatch.setattr(llm_module, "get_sync_http_client", client_factory)
    monkeypatch.setattr(svc, "_probe_availability", lambda: True)

    assert list(svc.stream_generate(MESSAGES)) == [("content", "local answer")]
    assert broken_cloud.calls and ollama_client.calls

    provider_settings.delete_provider_config("openai")


def test_stream_generate_empty_messages_produces_nothing():
    svc = llm_module.LLMService()
    assert list(svc.stream_generate([])) == []


def test_stream_timeout_has_bounded_connect_phase():
    to_default = llm_module.LLMService._stream_timeout(None)
    assert to_default.connect <= 10.0

    to_custom = llm_module.LLMService._stream_timeout(2.5)
    assert to_custom.connect <= 10.0


def test_think_tag_splitter_handles_tags_across_chunk_boundaries():
    splitter = llm_module._ThinkTagSplitter()

    parts = splitter.feed("abc<thi")
    assert parts == [("content", "abc")]  # partial open tag held back

    parts = splitter.feed("nk>A</th")
    assert parts == [("thinking", "A")]

    parts = splitter.feed("ink>done")
    assert parts == [("content", "done")]

    assert splitter.flush() == []

    unterminated = llm_module._ThinkTagSplitter()
    assert unterminated.feed("<think>never closed") == [("thinking", "never closed")]
    assert unterminated.flush() == []
