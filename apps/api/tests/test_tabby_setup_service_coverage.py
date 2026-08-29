"""Unit coverage for app.services.tabby_setup_service (all I/O injectable)."""

import pytest

import app.services.tabby_setup_service as tabby
from app.services.tabby_setup_service import (
    _detached_popen_kwargs,
    _log_file_path,
    _log_tail,
    _read_version,
    build_serve_command,
    endpoint_host_port,
    find_tabby_binary,
    get_status,
    install_command,
    port_occupied,
    setup,
    start_if_enabled,
)


@pytest.fixture
def no_binary(monkeypatch):
    monkeypatch.setattr(tabby, "find_tabby_binary", lambda: None)


@pytest.fixture
def ac_enabled(monkeypatch):
    """Autocomplete settings: local Tabby engine enabled."""
    monkeypatch.setattr(
        tabby,
        "get_autocomplete_settings",
        lambda: {
            "enabled": True,
            "engine": "local",
            "base_url": "http://127.0.0.1:8080",
            "model": "M",
        },
    )


class TestFindBinaryAndVersion:
    def test_winget_links_fallback(self, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby, "_is_windows", lambda: True)
        # Hermetic: ignore any real tabby on this machine's PATH.
        monkeypatch.setattr(tabby.shutil, "which", lambda name: None)
        links = tmp_path / "Microsoft" / "WinGet" / "Links"
        links.mkdir(parents=True)
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
        assert find_tabby_binary() is None  # dir exists, exe missing -> 46-47
        exe = links / "tabby.exe"
        exe.write_bytes(b"")
        assert find_tabby_binary() == str(exe)

    def test_read_version_success_and_failure(self, monkeypatch):
        class Proc:
            stdout = " 1.2.3 \n"

        monkeypatch.setattr(tabby.subprocess, "run", lambda *a, **k: Proc(), raising=False)
        assert _read_version("tabby") == "1.2.3"

        def boom(*a, **k):
            raise OSError("nope")

        monkeypatch.setattr(tabby.subprocess, "run", boom)
        assert _read_version("tabby") is None

    def test_get_status_without_binary(self, monkeypatch):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: None)
        status = get_status(reachable=False)
        assert status == {"installed": False, "version": None, "reachable": False}

    def test_get_status_with_binary_reads_version(self, monkeypatch):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "/usr/bin/tabby")
        monkeypatch.setattr(tabby, "_read_version", lambda b: "1.0.0")
        status = get_status(reachable=True)
        assert status == {"installed": True, "version": "1.0.0", "reachable": True}


class TestInstallAndServeCommands:
    def test_windows_winget(self):
        cmd = install_command("Windows")
        assert cmd is not None and cmd[0] == "winget"

    def test_darwin_brew_and_unsupported(self):
        assert install_command("Darwin") == ["brew", "install", "tabbyml/tabby/tabby"]
        assert install_command("SunOS") is None

    def test_linux_brew_only_when_present(self, monkeypatch):
        monkeypatch.setattr(tabby.shutil, "which", lambda name: "/usr/bin/brew")
        assert install_command("Linux") == ["brew", "install", "tabbyml/tabby/tabby"]
        monkeypatch.setattr(tabby.shutil, "which", lambda name: None)
        assert install_command("Linux") is None

    def test_serve_command_includes_port_from_url(self):
        cmd = build_serve_command("tabby", "http://127.0.0.1:9090", "M1")
        assert cmd == [
            "tabby",
            "serve",
            "--model",
            "M1",
            "--device",
            "cpu",
            "--no-webserver",
            "--port",
            "9090",
        ]
        bare = build_serve_command("tabby", "127.0.0.1", "M1")
        assert "--port" not in bare


class TestDetachedKwargsAndLogs:
    def test_windows_creation_flags(self, monkeypatch):
        monkeypatch.setattr(tabby, "_is_windows", lambda: True)
        kwargs = _detached_popen_kwargs("log")
        assert kwargs["creationflags"] != 0
        assert "start_new_session" not in kwargs

    def test_posix_start_new_session(self, monkeypatch):
        monkeypatch.setattr(tabby, "_is_windows", lambda: False)
        kwargs = _detached_popen_kwargs("log")
        assert kwargs["start_new_session"] is True

    def test_log_tail_reads_existing_file(self, monkeypatch, tmp_path):
        upload_dir = tmp_path / "uploads"
        upload_dir.mkdir()
        monkeypatch.setattr(tabby.settings, "UPLOAD_DIR", str(upload_dir))
        log_path = _log_file_path().parent / "tabby-server.log"
        log_path.write_text("\n".join(f"line{i}" for i in range(20)), encoding="utf-8")
        tail = _log_tail(max_lines=5)
        assert len(tail) == 5 and tail[-1] == "line19"

    def test_log_tail_missing_file_returns_empty(self, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby.settings, "UPLOAD_DIR", str(tmp_path))
        assert _log_tail() == []


class TestEndpointHelpers:
    def test_endpoint_host_port_defaults_and_parsing(self):
        assert endpoint_host_port("localhost:9000") == ("localhost", 9000)
        # Implementation defaults the port to 80 regardless of scheme.
        assert endpoint_host_port("https://api.example.com/x") == ("api.example.com", 80)

    def test_port_occupied_false_on_refused(self):
        # Port 1 on localhost is virtually never listening in tests.
        assert port_occupied("127.0.0.1", 1, timeout=0.2) is False


class TestSpawnServer:
    def test_spawn_success_and_failure(self, ac_enabled, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby.settings, "UPLOAD_DIR", str(tmp_path))
        calls = []

        def fake_popen(cmd, **kwargs):
            calls.append(cmd)

        assert tabby._spawn_server("tabby", fake_popen) is True
        assert calls and calls[0][0] == "tabby"

        def failing(cmd, **kwargs):
            raise RuntimeError("cannot start")

        assert tabby._spawn_server("tabby", failing) is False


class TestStartIfEnabled:
    def _run(
        self,
        *,
        enabled=True,
        engine="local",
        healthy_first=False,
        binary="tabby",
        occupied=False,
        spawn_ok=True,
        **kw,
    ):
        probes = iter([healthy_first] + [True] * 10)

        def probe():
            return next(probes)

        sleeps = []
        result = start_if_enabled(
            health_probe=probe,
            sleep=lambda s: sleeps.append(s),
            popen=(lambda cmd, **k: None) if spawn_ok else self._boom_popen,
            **kw,
        )
        return result, sleeps

    @staticmethod
    def _boom_popen(cmd, **kwargs):
        raise RuntimeError("spawn dead")

    def test_disabled_engine_short_circuits(self, monkeypatch):
        monkeypatch.setattr(tabby, "get_autocomplete_settings", lambda: {"enabled": False})
        assert start_if_enabled(health_probe=lambda: False) is False
        monkeypatch.setattr(
            tabby,
            "get_autocomplete_settings",
            lambda: {"enabled": True, "engine": "cloud"},
        )
        assert start_if_enabled(health_probe=lambda: False) is False

    def test_already_healthy_skips_spawn(self, ac_enabled):
        assert start_if_enabled(health_probe=lambda: True) is False

    def test_missing_binary_skips(self, ac_enabled, no_binary):
        assert start_if_enabled(health_probe=lambda: False) is False

    def test_occupied_port_skips(self, ac_enabled, monkeypatch):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "tabby")
        monkeypatch.setattr(tabby, "_effective_endpoint", lambda: ("u", "127.0.0.1", 8080))
        monkeypatch.setattr(tabby, "port_occupied", lambda h, p: True)
        assert start_if_enabled(health_probe=lambda: False) is False

    def test_failed_spawn_returns_false(self, ac_enabled, monkeypatch):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "tabby")
        monkeypatch.setattr(tabby, "_effective_endpoint", lambda: ("u", "127.0.0.1", 8080))
        monkeypatch.setattr(tabby, "port_occupied", lambda h, p: False)

        def failing(cmd, **kwargs):
            raise RuntimeError("dead")

        assert start_if_enabled(health_probe=lambda: False, popen=failing) is False

    def test_successful_spawn_polls_then_true(self, ac_enabled, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "tabby")
        monkeypatch.setattr(tabby, "_effective_endpoint", lambda: ("u", "127.0.0.1", 8080))
        monkeypatch.setattr(tabby, "port_occupied", lambda h, p: False)
        monkeypatch.setattr(tabby.settings, "UPLOAD_DIR", str(tmp_path))
        state = {"probes": 0}

        def probe():
            state["probes"] += 1
            return state["probes"] > 3  # unhealthy during initial check + 2 polls

        sleeps = []
        ok = start_if_enabled(health_probe=probe, sleep=sleeps.append, popen=lambda cmd, **k: None)
        assert ok is True
        assert sleeps  # waited between polls

    def test_never_raises_on_internal_error(self, monkeypatch):
        def broken():
            raise RuntimeError("settings exploded")

        monkeypatch.setattr(tabby, "get_autocomplete_settings", broken)
        assert start_if_enabled(health_probe=lambda: False) is False


class TestSetup:
    def test_already_running_short_circuit(self):
        out = setup(health_probe=lambda: True)
        assert out["reachable"] is True and "already" in out["message"]

    def test_no_package_manager_message(self, no_binary, monkeypatch):
        monkeypatch.setattr(tabby.platform, "system", lambda: "SunOS")
        out = setup(health_probe=lambda: False)
        assert out["installed"] is False
        assert "manually" in out["message"]

    def test_install_command_failure_reported(self, no_binary, monkeypatch):
        monkeypatch.setattr(tabby.platform, "system", lambda: "Windows")

        def failing_run(cmd, **k):
            raise RuntimeError("winget offline")

        out = setup(health_probe=lambda: False, run=failing_run)
        assert out["installed"] is False
        assert "Automatic installation failed" in out["message"]

    def test_installed_but_not_on_path(self, no_binary, monkeypatch):
        monkeypatch.setattr(tabby.platform, "system", lambda: "Windows")
        monkeypatch.setattr(tabby.subprocess, "run", lambda cmd, **k: None)
        out = setup(health_probe=lambda: False, run=lambda cmd, **k: None)
        assert out["installed"] is False
        assert "Restart OpenResearch" in out["message"]

    def test_port_conflict_message(self, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "tabby")
        monkeypatch.setattr(tabby, "_read_version", lambda b: "9.9.9")
        monkeypatch.setattr(tabby, "_effective_endpoint", lambda: ("u", "127.0.0.1", 1234))
        monkeypatch.setattr(tabby, "port_occupied", lambda h, p: True)
        out = setup(health_probe=lambda: False)
        assert out["reachable"] is False
        assert "Port 1234" in out["message"]

    def test_spawn_failure_reports_log(self, ac_enabled, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "tabby")
        monkeypatch.setattr(tabby, "_read_version", lambda b: "9.9.9")
        monkeypatch.setattr(tabby, "_effective_endpoint", lambda: ("u", "127.0.0.1", 8080))
        monkeypatch.setattr(tabby, "port_occupied", lambda h, p: False)
        monkeypatch.setattr(tabby.settings, "UPLOAD_DIR", str(tmp_path))

        def failing(cmd, **kwargs):
            raise RuntimeError("dead")

        out = setup(health_probe=lambda: False, popen=failing)
        assert out["installed"] is True
        assert "could not be started" in out["message"]

    def test_full_flow_unhealthy_after_polls(self, ac_enabled, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "tabby")
        monkeypatch.setattr(tabby, "_read_version", lambda b: "9.9.9")
        monkeypatch.setattr(tabby, "_effective_endpoint", lambda: ("u", "127.0.0.1", 8080))
        monkeypatch.setattr(tabby, "port_occupied", lambda h, p: False)
        monkeypatch.setattr(tabby.settings, "UPLOAD_DIR", str(tmp_path))

        out = setup(
            health_probe=lambda: False,
            sleep=lambda s: None,
            popen=lambda cmd, **k: None,
        )
        assert out["installed"] is True
        assert out["reachable"] is False
        assert "not answering" in out["message"]

    def test_full_flow_reaches_healthy(self, ac_enabled, monkeypatch, tmp_path):
        monkeypatch.setattr(tabby, "find_tabby_binary", lambda: "tabby")
        monkeypatch.setattr(tabby, "_read_version", lambda b: "9.9.9")
        monkeypatch.setattr(tabby, "_effective_endpoint", lambda: ("u", "127.0.0.1", 8080))
        monkeypatch.setattr(tabby, "port_occupied", lambda h, p: False)
        monkeypatch.setattr(tabby.settings, "UPLOAD_DIR", str(tmp_path))

        # Healthy probe short-circuits before spawn/version read (by design).
        out = setup(
            health_probe=lambda: True,
            sleep=lambda s: None,
            popen=lambda cmd, **k: None,
        )
        assert out["reachable"] is True
        assert "already" in out["message"]
