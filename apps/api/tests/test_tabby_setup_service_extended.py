"""Extended tests for TabbySetupService functions (PID management, logging, endpoint parsing, setup, start_if_enabled)."""

from pathlib import Path
from unittest.mock import patch

from app.services.tabby_setup_service import (
    _clear_pid,
    _log_tail,
    _read_pid,
    _read_version,
    _rotate_log_if_oversized,
    _write_pid,
    endpoint_host_port,
    port_occupied,
    setup,
    start_if_enabled,
    stop_server,
)


def test_pid_management_lifecycle(tmp_path: Path, monkeypatch):
    test_pid_file = tmp_path / "tabby-server.pid"
    monkeypatch.setattr("app.services.tabby_setup_service._pid_file_path", lambda: test_pid_file)

    # Initial state -> None
    assert _read_pid() is None

    # Write PID
    _write_pid(12345)
    assert _read_pid() == 12345

    # Clear PID
    _clear_pid()
    assert _read_pid() is None

    # Clear when file doesn't exist -> no error
    _clear_pid()


def test_log_tail_and_rotation(tmp_path: Path, monkeypatch):
    test_log_file = tmp_path / "tabby-server.log"
    monkeypatch.setattr("app.services.tabby_setup_service._log_file_path", lambda: test_log_file)

    # When file doesn't exist -> returns []
    assert _log_tail() == []

    # Write 20 lines
    lines = [f"Line {i}" for i in range(20)]
    test_log_file.write_text("\n".join(lines), encoding="utf-8")

    tail = _log_tail(max_lines=5)
    assert len(tail) == 5
    assert tail[-1] == "Line 19"

    # Rotation when oversized
    monkeypatch.setattr("app.services.tabby_setup_service._LOG_MAX_BYTES", 10)
    _rotate_log_if_oversized()
    assert test_log_file.stat().st_size == 0


def test_endpoint_host_port_parsing():
    host, port = endpoint_host_port("http://localhost:8080")
    assert host == "localhost"
    assert port == 8080

    host2, port2 = endpoint_host_port("127.0.0.1:9000")
    assert host2 == "127.0.0.1"
    assert port2 == 9000

    host3, port3 = endpoint_host_port("https://api.tabby.ai")
    assert host3 == "api.tabby.ai"
    assert port3 == 80


def test_port_occupied_check():
    # Attempt connecting to closed high port
    occupied = port_occupied("127.0.0.1", 65530, timeout=0.05)
    assert occupied is False


def test_read_version_failure():
    with patch("subprocess.run", side_effect=Exception("Execution failed")):
        assert _read_version("non_existent_tabby_bin") is None


def test_stop_server_when_no_pid():
    with patch("app.services.tabby_setup_service._read_pid", return_value=None):
        assert stop_server() is False


def test_setup_when_already_healthy():
    res = setup(health_probe=lambda: True)
    assert res["installed"] is True
    assert res["reachable"] is True
    assert "already installed" in res["message"]


def test_start_if_enabled_when_disabled():
    with patch("app.services.tabby_setup_service.get_autocomplete_settings", return_value={"enabled": False}):
        assert start_if_enabled(health_probe=lambda: False) is False
