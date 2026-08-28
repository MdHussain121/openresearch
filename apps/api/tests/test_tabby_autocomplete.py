"""Tabby keyless local autocomplete: provider registration, LLM paths, wiring, API."""

import json
import platform

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.schemas.models import AutocompleteRequest
from app.services import llm_service as llm_module
from app.services import provider_settings, tabby_setup_service
from app.services.ai_writing_service import (
    AIProviderUnavailableError,
    ai_writing_service,
)


class FakeClient:
    """Minimal sync-client stand-in recording GET/POST calls."""

    def __init__(self, get_response=None, post_response=None, get_error=None, post_error=None):
        self.get_response = get_response
        self.post_response = post_response
        self.get_error = get_error
        self.post_error = post_error
        self.get_calls = []
        self.post_calls = []

    def get(self, url, **kwargs):
        self.get_calls.append({"url": url, **kwargs})
        if self.get_error is not None:
            raise self.get_error
        return self.get_response

    def post(self, url, **kwargs):
        self.post_calls.append({"url": url, **kwargs})
        if self.post_error is not None:
            raise self.post_error
        return self.post_response


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def default_tabby_env(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "TABBY_BASE_URL", "http://localhost:8080")
    monkeypatch.setattr(settings, "TABBY_MODEL", "Qwen2.5-Coder-1.5B")
    store_file = tmp_path / "provider_keys.json"
    monkeypatch.setattr(provider_settings, "_store_path", lambda: store_file)
    monkeypatch.setattr(provider_settings, "_candidate_store_paths", lambda: [store_file])
    llm_module.llm_service._tabby_probe_cache = None


def fresh_service():
    return llm_module.LLMService()


def test_tabby_definition_is_keyless_and_autocomplete_only():
    definition = next(d for d in provider_settings.PROVIDER_DEFINITIONS if d["provider"] == "tabby")
    assert definition["requires_api_key"] is False
    assert definition["autocomplete_only"] is True

    # Excluded from the generic key-management list
    listed = {entry["provider"] for entry in provider_settings.list_provider_configs()}
    assert "tabby" not in listed
    assert listed == {"openai", "anthropic", "custom"}

    # Can be stored without an API key and never becomes the chat provider
    entry = provider_settings.set_provider_config(
        "tabby", base_url="http://localhost:9999/", model="m"
    )
    assert entry["configured"] is True
    assert entry["masked_key"] is None
    assert provider_settings.get_active_provider_name() is None

    creds = provider_settings.get_provider_credentials("tabby")
    assert creds is not None
    assert creds["api_key"] is None
    assert creds["base_url"] == "http://localhost:9999"

    assert provider_settings.delete_provider_config("tabby") is True


def test_autocomplete_settings_defaults_and_roundtrip():
    ac = provider_settings.get_autocomplete_settings()
    # Off by default: the user opts in from Settings > AI Autocomplete.
    assert ac["enabled"] is False
    assert ac["engine"] == "auto"
    assert ac["base_url"] == "http://localhost:8080"
    assert ac["model"] == "Qwen2.5-Coder-1.5B"

    saved = provider_settings.set_autocomplete_settings(
        enabled=True,
        engine="tabby",
        base_url="http://127.0.0.1:8090/",
        model=" StarCoder2-3B ",
    )
    assert saved["enabled"] is True
    assert saved["engine"] == "tabby"
    assert saved["base_url"] == "http://127.0.0.1:8090"
    assert saved["model"] == "StarCoder2-3B"

    with open(provider_settings._store_path(), encoding="utf-8") as fh:
        raw = json.load(fh)
    assert raw["autocomplete"]["engine"] == "tabby"

    with pytest.raises(ValueError):
        provider_settings.set_autocomplete_settings(engine="bogus")


def test_probe_tabby_caches_and_respects_force(monkeypatch):
    healthy = FakeClient(get_response=FakeResponse(200))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: healthy)

    svc = fresh_service()
    assert svc.probe_tabby() is True
    assert svc.probe_tabby() is True
    assert len(healthy.get_calls) == 1
    assert healthy.get_calls[0]["url"] == "http://localhost:8080/v1/health"

    assert svc.probe_tabby(force=True) is True
    assert len(healthy.get_calls) == 2

    down = FakeClient(get_error=OSError("refused"))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: down)
    assert svc.probe_tabby(force=True) is False
    assert svc.probe_tabby() is False  # negative result also cached within TTL
    assert len(down.get_calls) == 1


def test_generate_tabby_happy_path_builds_segments_payload(monkeypatch):
    client = FakeClient(
        get_response=FakeResponse(200),
        post_response=FakeResponse(
            200,
            {"id": "x", "choices": [{"text": "  <|fim_middle|>significant gains. <|endoftext|>"}]},
        ),
    )
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: client)

    svc = fresh_service()
    assert svc.generate_tabby("The model achieves", "state-of-the-art") == "significant gains."

    call = client.post_calls[0]
    assert call["url"] == "http://localhost:8080/v1/completions"
    assert call["json"]["segments"] == {
        "prefix": "The model achieves",
        "suffix": "state-of-the-art",
    }
    assert call["json"]["temperature"] == 0.2

    # Empty suffix omits the key entirely; Tabby builds FIM prompts server-side.
    assert svc.generate_tabby("plain prefix") == "significant gains."
    second = client.post_calls[1]
    assert second["json"]["segments"] == {"prefix": "plain prefix"}
    assert "suffix" not in second["json"]["segments"]


def test_build_completion_payload_schema():
    with_suffix = llm_module.LLMService.build_completion_payload("pre", "suf")
    assert with_suffix == {"temperature": 0.2, "segments": {"prefix": "pre", "suffix": "suf"}}
    without = llm_module.LLMService.build_completion_payload("pre", "")
    assert without["segments"] == {"prefix": "pre"}


def test_generate_tabby_failure_arms_return_none(monkeypatch):
    # Each arm gets a fresh service: a failed probe is cached for 30s and would
    # otherwise short-circuit the later arms before they reach the POST.
    class NoHttp:
        def get(self, *a, **k):
            raise AssertionError("no probe expected")

        def post(self, *a, **k):
            raise AssertionError("no completion expected")

    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: NoHttp())
    assert fresh_service().generate_tabby("") is None

    # Unreachable server: probe fails, no completion attempt
    down = FakeClient(get_error=OSError("refused"))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: down)
    assert fresh_service().generate_tabby("prefix") is None

    # Probe OK but completion fails: bad status, network error, empty choices, junk text
    ok_probe = FakeClient(get_response=FakeResponse(200), post_response=FakeResponse(500))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: ok_probe)
    assert fresh_service().generate_tabby("prefix") is None

    err_client = FakeClient(get_response=FakeResponse(200), post_error=OSError("boom"))
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: err_client)
    assert fresh_service().generate_tabby("prefix") is None

    empty = FakeClient(
        get_response=FakeResponse(200), post_response=FakeResponse(200, {"choices": []})
    )
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: empty)
    assert fresh_service().generate_tabby("prefix") is None

    junk = FakeClient(
        get_response=FakeResponse(200), post_response=FakeResponse(200, {"choices": [{"text": 42}]})
    )
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: junk)
    assert fresh_service().generate_tabby("prefix") is None

    blank = FakeClient(
        get_response=FakeResponse(200),
        post_response=FakeResponse(200, {"choices": [{"text": "   "}]}),
    )
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: blank)
    assert fresh_service().generate_tabby("prefix") is None


def test_generate_tabby_honors_saved_endpoint_and_model(monkeypatch):
    provider_settings.set_autocomplete_settings(
        base_url="http://127.0.0.1:9090", model="DeepSeek-Coder"
    )
    client = FakeClient(
        get_response=FakeResponse(200),
        post_response=FakeResponse(200, {"id": "x", "choices": [{"text": "ok"}]}),
    )
    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: client)

    svc = fresh_service()
    assert svc.generate_tabby("p") == "ok"
    # The saved endpoint drives the request; the model is served server-side by
    # Tabby (used by the setup flow's serve command) and is not sent per-request.
    assert client.post_calls[0]["url"].startswith("http://127.0.0.1:9090/v1/completions")
    assert "model" not in client.post_calls[0]["json"]


# --------------------------------------------------------------- Wiring


@pytest.fixture
def no_rag(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai_writing_service.rag_service.hybrid_search",
        lambda *args, **kwargs: [],
    )


def _ghost_request(mode="ghost"):
    return AutocompleteRequest(prefix_text="The proposed method demonstrates", mode=mode)


def test_disabled_toggle_keeps_standard_chain(no_rag, monkeypatch):
    provider_settings.set_autocomplete_settings(enabled=False)

    def fail_probe(*a, **k):
        raise AssertionError("Tabby must not be probed while disabled")

    monkeypatch.setattr(llm_module.llm_service, "probe_tabby", fail_probe)
    monkeypatch.setattr(llm_module.llm_service, "_probe_availability", lambda: False)
    with pytest.raises(AIProviderUnavailableError):
        ai_writing_service.generate_autocomplete(db=None, project_id="p1", request=_ghost_request())


def test_cloud_engine_pin_skips_tabby(no_rag, monkeypatch):
    provider_settings.set_autocomplete_settings(enabled=True, engine="cloud")

    def fail_probe(*a, **k):
        raise AssertionError("Tabby must not be probed for engine='cloud'")

    monkeypatch.setattr(llm_module.llm_service, "probe_tabby", fail_probe)
    monkeypatch.setattr(llm_module.llm_service, "_probe_availability", lambda: False)
    with pytest.raises(AIProviderUnavailableError):
        ai_writing_service.generate_autocomplete(db=None, project_id="p1", request=_ghost_request())


def test_healthy_tabby_serves_ghost_and_continuation(no_rag, monkeypatch):
    provider_settings.set_autocomplete_settings(enabled=True, engine="auto")

    generated = []

    def fake_generate(prefix, suffix="", max_tokens=32, timeout_seconds=3.0):
        generated.append({"prefix": prefix, "max_tokens": max_tokens, "timeout": timeout_seconds})
        return "empirical improvements"

    monkeypatch.setattr(llm_module.llm_service, "probe_tabby", lambda force=False: True)
    monkeypatch.setattr(llm_module.llm_service, "generate_tabby", fake_generate)

    ghost = ai_writing_service.generate_autocomplete(
        db=None, project_id="p1", request=_ghost_request()
    )
    assert ghost.text == " empirical improvements"  # ghost text keeps the leading space convention
    assert ghost.grounding_state == "general-knowledge"
    assert ghost.source_passages == []
    assert generated[-1]["max_tokens"] == 48

    cont = ai_writing_service.generate_autocomplete(
        db=None, project_id="p1", request=_ghost_request(mode="continuation")
    )
    assert cont.text == "empirical improvements"  # continuation has no leading space
    assert generated[-1]["max_tokens"] == 160


def test_tabby_failure_falls_back_to_chain(no_rag, monkeypatch):
    provider_settings.set_autocomplete_settings(enabled=True, engine="tabby")

    monkeypatch.setattr(llm_module.llm_service, "probe_tabby", lambda force=False: True)
    monkeypatch.setattr(llm_module.llm_service, "generate_tabby", lambda *a, **k: None)
    monkeypatch.setattr(llm_module.llm_service, "_probe_availability", lambda: False)
    with pytest.raises(AIProviderUnavailableError):
        ai_writing_service.generate_autocomplete(db=None, project_id="p1", request=_ghost_request())


# --------------------------------------------------------------- Settings API


def test_autocomplete_settings_endpoints_flow(client: TestClient, monkeypatch):
    # Background Tabby starts must not run real I/O inside endpoint tests.
    monkeypatch.setattr("app.api.v1.endpoints.provider_settings.threading.Thread", FakeNoopThread)
    listing = client.get("/api/v1/ai/autocomplete-settings")
    assert listing.status_code == 200
    body = listing.json()
    assert body["enabled"] is False  # off by default; user opts in
    assert body["engine"] == "auto"
    assert body["base_url"] == "http://localhost:8080"
    assert body["model"] == "Qwen2.5-Coder-1.5B"

    saved = client.put(
        "/api/v1/ai/autocomplete-settings",
        json={
            "enabled": True,
            "engine": "tabby",
            "base_url": "http://127.0.0.1:8080",
            "model": "Starcoder",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["engine"] == "tabby"

    reread = client.get("/api/v1/ai/autocomplete-settings").json()
    assert reread["base_url"] == "http://127.0.0.1:8080"

    bad = client.put("/api/v1/ai/autocomplete-settings", json={"engine": "carrier-pigeon"})
    assert bad.status_code == 400


def test_autocomplete_probe_endpoint(client: TestClient, monkeypatch):
    monkeypatch.setattr(llm_module.llm_service, "probe_tabby", lambda force=False: force)
    res = client.post("/api/v1/ai/autocomplete-settings/probe")
    assert res.status_code == 200
    body = res.json()
    assert body["reachable"] is True
    assert body["base_url"] == "http://localhost:8080"

    monkeypatch.setattr(llm_module.llm_service, "probe_tabby", lambda force=False: False)
    res = client.post("/api/v1/ai/autocomplete-settings/probe")
    assert res.json()["reachable"] is False


# --------------------------------------------------------------- Setup service


class FakePopen:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    def __call__(self, cmd, **kwargs):
        self.calls.append({"cmd": cmd, **kwargs})
        if self.error is not None:
            raise self.error
        return object()


def _make_probe(sequence):
    """Probe returning queued values, then sticking to the last one."""
    iterator = iter(sequence)

    def probe():
        try:
            return next(iterator)
        except StopIteration:
            return sequence[-1]

    return probe


def test_setup_short_circuits_when_already_running(monkeypatch):
    monkeypatch.setattr(
        tabby_setup_service, "find_tabby_binary", lambda: None
    )  # must not be consulted
    result = tabby_setup_service.setup(health_probe=lambda: True)
    assert result == {
        "installed": True,
        "version": None,
        "reachable": True,
        "message": "Tabby is already installed and running.",
    }


def test_setup_installs_then_starts_and_becomes_healthy(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    monkeypatch.setattr(
        tabby_setup_service,
        "find_tabby_binary",
        lambda: "/fake/tabby.exe",
    )
    monkeypatch.setattr(tabby_setup_service, "_read_version", lambda binary: "tabby 0.21")
    monkeypatch.setattr(tabby_setup_service, "port_occupied", lambda host, port, timeout=1.0: False)
    provider_settings.set_autocomplete_settings(base_url="http://127.0.0.1:8095")

    popen = FakePopen()
    run_calls = []
    sleeps = []

    def fake_run(cmd, **kwargs):
        run_calls.append({"cmd": cmd, **kwargs})
        return object()

    result = tabby_setup_service.setup(
        health_probe=_make_probe([False, True]),
        sleep=sleeps.append,
        popen=popen,
        run=fake_run,
    )

    # Binary existed up-front (find_tabby_binary patched), so no installer ran.
    assert run_calls == []
    assert result["installed"] is True
    assert result["version"] == "tabby 0.21"
    assert result["reachable"] is True

    serve_cmd = popen.calls[0]["cmd"]
    assert serve_cmd[:4] == ["/fake/tabby.exe", "serve", "--model", "Qwen2.5-Coder-1.5B"]
    assert "--no-webserver" in serve_cmd
    assert "--device" in serve_cmd and "cpu" in serve_cmd
    assert serve_cmd[serve_cmd.index("--port") + 1] == "8095"


def test_setup_downloads_model_note_when_never_reachable(monkeypatch):
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: "/fake/tabby")
    monkeypatch.setattr(tabby_setup_service, "_read_version", lambda binary: None)
    monkeypatch.setattr(tabby_setup_service, "port_occupied", lambda host, port, timeout=1.0: False)

    popen = FakePopen()
    sleeps = []
    result = tabby_setup_service.setup(
        health_probe=lambda: False,
        sleep=sleeps.append,
        popen=popen,
        run=lambda cmd, **k: object(),
    )

    assert result["reachable"] is False
    assert "downloading" in result["message"]
    assert len(sleeps) == tabby_setup_service._STARTUP_POLL_ATTEMPTS
    assert isinstance(result["log_tail"], list)


def test_setup_detects_port_conflict(monkeypatch):
    """A foreign service squatting on the port must produce a clear conflict message."""
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: "/fake/tabby")
    monkeypatch.setattr(tabby_setup_service, "_read_version", lambda binary: None)
    monkeypatch.setattr(tabby_setup_service, "port_occupied", lambda host, port, timeout=1.0: True)

    def fail_spawn(*a, **k):
        raise AssertionError("must not spawn into an occupied port")

    result = tabby_setup_service.setup(health_probe=lambda: False, popen=fail_spawn)
    assert result["reachable"] is False
    assert "Port 8080" in result["message"]
    assert "free port" in result["message"]


def test_endpoint_host_port_parsing():
    assert tabby_setup_service.endpoint_host_port("http://127.0.0.1:9090") == ("127.0.0.1", 9090)
    assert tabby_setup_service.endpoint_host_port("http://localhost") == ("localhost", 80)
    assert tabby_setup_service.endpoint_host_port("tabby.local:1234/v1") == ("tabby.local", 1234)


def test_setup_without_package_manager_returns_manual_instructions(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    # No tabby binary anywhere (PATH + winget fallback both miss)
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: None)
    monkeypatch.setattr(tabby_setup_service.shutil, "which", lambda name: None)  # no brew
    result = tabby_setup_service.setup(health_probe=lambda: False)
    assert result["installed"] is False
    assert tabby_setup_service.TABBY_RELEASES_URL in result["message"]


def test_setup_install_failure_reports_manual_fallback(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: None)

    def boom(cmd, **kwargs):
        raise OSError("brew missing")

    result = tabby_setup_service.setup(health_probe=lambda: False, run=boom)
    assert result["installed"] is False
    assert result["reachable"] is False
    assert TABBY_FALLBACK_TEXT in result["message"]


TABBY_FALLBACK_TEXT = f"Install Tabby manually from {tabby_setup_service.TABBY_RELEASES_URL}"


def test_setup_install_succeeds_but_binary_not_on_path_yet(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: None)

    result = tabby_setup_service.setup(health_probe=lambda: False, run=lambda cmd, **k: object())
    assert result["installed"] is False
    assert "PATH" in result["message"]

    # Installer command shape for winget
    cmd = tabby_setup_service.install_command("Windows")
    assert "winget" in cmd and "TabbyML.Tabby" in cmd


def test_setup_spawn_failure_is_reported(monkeypatch):
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: "/fake/tabby")
    monkeypatch.setattr(tabby_setup_service, "_read_version", lambda binary: None)
    monkeypatch.setattr(tabby_setup_service, "port_occupied", lambda host, port, timeout=1.0: False)

    popen = FakePopen(error=OSError("no exec"))
    result = tabby_setup_service.setup(
        health_probe=lambda: False, sleep=lambda s: None, popen=popen
    )
    assert result["installed"] is True
    assert result["reachable"] is False
    assert "could not be started" in result["message"]


def test_build_serve_command_defaults():
    cmd = tabby_setup_service.build_serve_command("tabby", "http://localhost:8080", "M")
    assert cmd == [
        "tabby",
        "serve",
        "--model",
        "M",
        "--device",
        "cpu",
        "--no-webserver",
        "--port",
        "8080",
    ]


def test_get_status_variants(monkeypatch):
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: None)
    status = tabby_setup_service.get_status(reachable=False)
    assert status == {"installed": False, "version": None, "reachable": False}

    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: "/fake/tabby")
    monkeypatch.setattr(tabby_setup_service, "_read_version", lambda binary: "tabby 1.0")
    status = tabby_setup_service.get_status(reachable=True)
    assert status == {"installed": True, "version": "tabby 1.0", "reachable": True}


def test_read_version_survives_errors(monkeypatch):
    def raise_timeout(cmd, **kwargs):
        raise TimeoutError("slow")

    monkeypatch.setattr(tabby_setup_service.subprocess, "run", raise_timeout)
    assert tabby_setup_service._read_version("tabby") is None


# --------------------------------------------------------------- Setup API


def test_setup_status_endpoint(client: TestClient, monkeypatch):
    monkeypatch.setattr(llm_module.llm_service, "probe_tabby", lambda force=False: False)
    monkeypatch.setattr(
        tabby_setup_service,
        "get_status",
        lambda reachable: {
            "installed": False,
            "version": None,
            "reachable": reachable,
        },
    )
    res = client.get("/api/v1/ai/autocomplete-settings/status")
    assert res.status_code == 200
    assert res.json() == {"installed": False, "version": None, "reachable": False}


def test_run_setup_endpoint(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        tabby_setup_service,
        "setup",
        lambda health_probe, **kwargs: {
            "installed": True,
            "version": None,
            "reachable": True,
            "message": "ok",
        },
    )
    res = client.post("/api/v1/ai/autocomplete-settings/setup")
    assert res.status_code == 200
    body = res.json()
    assert body["reachable"] is True
    assert body["message"] == "ok"


# ------------------------------------------------- Start-on-save


class FakeNoopThread:
    """Thread stand-in that records targets without executing them."""

    def __init__(self, target=None, args=None, daemon=None):
        self.target = target

    def start(self):
        pass


def test_put_autocomplete_settings_starts_tabby_when_enabled(client: TestClient, monkeypatch):
    executed = []
    monkeypatch.setattr(
        tabby_setup_service,
        "start_if_enabled",
        lambda health_probe, **kwargs: executed.append(True) or True,
    )

    class RunNowThread:
        def __init__(self, target=None, args=None, daemon=None):
            self._target = target

        def start(self):
            if self._target:
                self._target()

    monkeypatch.setattr("app.api.v1.endpoints.provider_settings.threading.Thread", RunNowThread)

    res = client.put("/api/v1/ai/autocomplete-settings", json={"enabled": True, "engine": "auto"})
    assert res.status_code == 200
    assert executed == [True]

    # Saving while disabled must not attempt a start.
    executed.clear()
    res = client.put("/api/v1/ai/autocomplete-settings", json={"enabled": False})
    assert res.status_code == 200
    assert executed == []


def test_find_tabby_binary_falls_back_to_winget_links(tmp_path, monkeypatch):
    # On PATH wins
    monkeypatch.setattr(tabby_setup_service.shutil, "which", lambda name: "/usr/bin/tabby")
    assert tabby_setup_service.find_tabby_binary() == "/usr/bin/tabby"

    # Stale PATH: fall back to the winget links dir (Windows only)
    links = tmp_path / "Microsoft" / "WinGet" / "Links"
    links.mkdir(parents=True)
    (links / "tabby.exe").write_bytes(b"MZ")
    monkeypatch.setattr(tabby_setup_service.shutil, "which", lambda name: None)
    monkeypatch.setattr(tabby_setup_service.os, "name", "nt")
    monkeypatch.setattr(tabby_setup_service.os, "environ", {"LOCALAPPDATA": str(tmp_path)})
    assert tabby_setup_service.find_tabby_binary() == str(links / "tabby.exe")

    # Nothing installed anywhere
    (links / "tabby.exe").unlink()
    assert tabby_setup_service.find_tabby_binary() is None


def test_start_if_enabled_branches(monkeypatch):
    provider_settings.set_autocomplete_settings(enabled=True, engine="auto")

    # Missing CLI -> nothing to start
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: None)
    # Port occupied (e.g. an already-running Tabby) -> no second spawn
    assert tabby_setup_service.start_if_enabled(lambda: False) is False
    monkeypatch.setattr(tabby_setup_service, "find_tabby_binary", lambda: "/fake/tabby")
    monkeypatch.setattr(tabby_setup_service, "port_occupied", lambda host, port, timeout=1.0: True)
    assert tabby_setup_service.start_if_enabled(lambda: False) is False

    # Healthy already -> no spawn
    monkeypatch.setattr(tabby_setup_service, "port_occupied", lambda host, port, timeout=1.0: False)
    assert tabby_setup_service.start_if_enabled(lambda: True) is False

    # Happy path: spawns and polls until healthy
    popen = FakePopen()
    sleeps = []
    probes = iter([False, True])

    def probe():
        try:
            return next(probes)
        except StopIteration:
            return True

    assert (
        tabby_setup_service.start_if_enabled(health_probe=probe, sleep=sleeps.append, popen=popen)
        is True
    )
    assert len(popen.calls) == 1

    provider_settings.set_autocomplete_settings(enabled=False)
    assert tabby_setup_service.start_if_enabled(lambda: False) is False

    provider_settings.set_autocomplete_settings(enabled=True, engine="cloud")
    assert tabby_setup_service.start_if_enabled(lambda: False) is False


# ------------------------------------------------------- Coverage odds & ends


def test_read_version_returns_stdout(monkeypatch):
    class Proc:
        stdout = "tabby 0.32.0\n"

    monkeypatch.setattr(tabby_setup_service.subprocess, "run", lambda cmd, **k: Proc())
    assert tabby_setup_service._read_version("tabby") == "tabby 0.32.0"


def test_install_command_platforms(monkeypatch):
    assert tabby_setup_service.install_command("Darwin") == [
        "brew",
        "install",
        "tabbyml/tabby/tabby",
    ]
    monkeypatch.setattr(tabby_setup_service.shutil, "which", lambda name: "/usr/local/bin/brew")
    assert tabby_setup_service.install_command("Linux") == [
        "brew",
        "install",
        "tabbyml/tabby/tabby",
    ]
    monkeypatch.setattr(tabby_setup_service.shutil, "which", lambda name: None)
    assert tabby_setup_service.install_command("Linux") is None


def test_detached_kwargs_posix_branch(monkeypatch):
    import os as os_module

    monkeypatch.setattr(tabby_setup_service.os, "name", "posix")
    kwargs = tabby_setup_service._detached_popen_kwargs(log_handle=object())
    assert kwargs["start_new_session"] is True
    assert "creationflags" not in kwargs
    _ = os_module  # keep import meaningful


def test_port_occupied_true_and_false():
    import socket

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    host, port = listener.getsockname()
    try:
        assert tabby_setup_service.port_occupied(host, port) is True
        # Closed port on loopback refuses connections -> False (OSError branch)
        assert tabby_setup_service.port_occupied("127.0.0.1", port + 1) is False
    finally:
        listener.close()


def test_log_tail_handles_unreadable_path(monkeypatch, tmp_path):
    monkeypatch.setattr(tabby_setup_service, "_log_file_path", lambda: tmp_path)
    assert tabby_setup_service._log_tail() == []


def test_log_tail_reads_last_lines(tmp_path):
    log_file = tmp_path / "tabby-server.log"
    log_file.write_text("\n".join(f"line{i}" for i in range(20)), encoding="utf-8")
    tail = tabby_setup_service._log_tail(max_lines=3)
    assert tail == ["line17", "line18", "line19"]
    assert tabby_setup_service._log_tail(max_lines=100)[0] == "line0"


def test_provider_store_corrupt_and_type_error_arms(tmp_path):
    # Write through the service's own path resolution (conftest redirects
    # UPLOAD_DIR into tmp_path), so _load_store really reads our payload.
    store_path = provider_settings._store_path()

    # Corrupt JSON and non-dict payloads both fall back to a clean store
    for bad in ("{not json", "[1, 2, 3]"):
        store_path.parent.mkdir(parents=True, exist_ok=True)
        store_path.write_text(bad, encoding="utf-8")
        assert provider_settings.get_autocomplete_settings()["engine"] == "auto"
        assert provider_settings.get_global_rate_limit() is None

    with pytest.raises(ValueError):
        provider_settings.set_global_rate_limit("not-a-number")

    # Unknown provider credentials lookups return None
    assert provider_settings.get_provider_credentials("does-not-exist") is None

    # A keyed provider saved without an API key is not usable
    provider_settings.set_provider_config("custom", model="m", base_url="http://localhost:1234/v1")
    assert provider_settings.get_provider_credentials("custom") is None
    provider_settings.delete_provider_config("custom")


def test_generate_rejects_empty_messages(monkeypatch):
    class NoHttp:
        def post(self, *a, **k):
            raise AssertionError("no HTTP expected")

    monkeypatch.setattr(llm_module, "get_sync_http_client", lambda: NoHttp())
    assert fresh_service().generate([]) is None
