"""
Best-effort local Tabby installation & launch for OpenResearch.

The 'Set Up Tabby' button in Settings calls POST /ai/autocomplete-settings/setup,
which:
1. Short-circuits when the server is already healthy.
2. Installs the tabby CLI when missing (winget on Windows, Homebrew elsewhere).
3. Starts `tabby serve --model <model> --device cpu` detached, logging to
   storage/tabby-server.log (first start downloads model weights and can take
   several minutes; we poll health briefly and report honestly either way).

All commands use fixed argument lists — no shell interpolation of user input.
"""

import logging
import os
import platform
import shutil
import socket
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import IO, Any
from urllib.parse import urlparse

from app.core.config import settings
from app.services.provider_settings import get_autocomplete_settings

TABBY_RELEASES_URL = "https://github.com/TabbyML/tabby/releases"

logger = logging.getLogger("openresearch.tabby_setup")
_DEFAULT_MODEL = "Qwen2.5-Coder-1.5B"
_STARTUP_POLL_ATTEMPTS = 40  # ~20s at a 0.5s interval; model download may exceed this
_STARTUP_POLL_INTERVAL_SECONDS = 0.5
_LOG_TAIL_LINES = 12


def _is_windows() -> bool:
    return os.name == "nt"


def _winget_fallback() -> str | None:
    """Locate tabby.exe inside winget's package store (PATH may be stale/empty)."""
    if not _is_windows():
        return None
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if not local_app_data:
        return None
    winget_root = Path(local_app_data) / "Microsoft" / "WinGet"
    links = winget_root / "Links" / "tabby.exe"
    if links.is_file():
        return str(links)
    packages = winget_root / "Packages"
    if packages.is_dir():
        for manifest_dir in sorted(packages.glob("TabbyML.Tabby*")):
            for candidate in sorted(manifest_dir.rglob("tabby.exe")):
                return str(candidate)
    return None


def find_tabby_binary() -> str | None:
    """Locate the tabby CLI: PATH first, then winget's install locations.

    The PATH check alone misses installs that happened after this process
    started (winget only updates the registry environment, not running
    processes), which would silently disable the auto-start.
    """
    found = shutil.which("tabby")
    if found:
        return found
    return _winget_fallback()


def _read_version(binary: str) -> str | None:
    try:
        proc = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=10, check=False
        )
    except Exception:
        return None
    version = (proc.stdout or "").strip()
    return version or None


def get_status(reachable: bool) -> dict[str, Any]:
    binary = find_tabby_binary()
    return {
        "installed": binary is not None,
        "version": _read_version(binary) if binary else None,
        "reachable": reachable,
    }


def install_command(system: str) -> list[str] | None:
    """Platform-specific package-manager invocation, or None when unsupported."""
    if system == "Windows":
        return [
            "winget",
            "install",
            "--id",
            "TabbyML.Tabby",
            "-e",
            "--accept-source-agreements",
            "--accept-package-agreements",
        ]
    if system == "Darwin":
        return ["brew", "install", "tabbyml/tabby/tabby"]
    if system == "Linux" and shutil.which("brew"):
        return ["brew", "install", "tabbyml/tabby/tabby"]
    return None


def build_serve_command(binary: str, base_url: str, model: str) -> list[str]:
    # --no-webserver skips Tabby's user-registration layer so /v1/* stays
    # keyless for local use (the default webserver returns 401 until an admin
    # account is created in its UI).
    cmd = [binary, "serve", "--model", model, "--device", "cpu", "--no-webserver"]
    port = urlparse(base_url).port
    if port is not None:
        cmd += ["--port", str(port)]
    return cmd


def _detached_popen_kwargs(log_handle: IO[bytes]) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": log_handle,
        "stderr": subprocess.STDOUT,
    }
    if _is_windows():
        # CREATE_NO_WINDOW keeps the server invisible; DETACHED_PROCESS is
        # mutually exclusive with it and must NOT be combined (MSDN).
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        )
    else:
        kwargs["start_new_session"] = True
    return kwargs


def _log_file_path() -> Path:
    log_dir = Path(settings.UPLOAD_DIR).resolve().parent
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "tabby-server.log"


_LOG_MAX_BYTES = 5 * 1024 * 1024  # 5 MB


def _pid_file_path() -> Path:
    log_dir = Path(settings.UPLOAD_DIR).resolve().parent
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "tabby-server.pid"


def _rotate_log_if_oversized() -> None:
    """Truncate the log file when it exceeds _LOG_MAX_BYTES to prevent unbounded disk growth."""
    log_path = _log_file_path()
    try:
        if log_path.exists() and log_path.stat().st_size > _LOG_MAX_BYTES:
            log_path.write_bytes(b"")
    except OSError:
        pass


def _write_pid(pid: int) -> None:
    try:
        _pid_file_path().write_text(str(pid), encoding="utf-8")
    except OSError:
        pass


def _read_pid() -> int | None:
    try:
        return int(_pid_file_path().read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _clear_pid() -> None:
    try:
        _pid_file_path().unlink(missing_ok=True)
    except OSError:
        pass


def stop_server() -> bool:
    """Terminate the Tabby server process identified by the stored PID. Returns True if killed."""
    pid = _read_pid()
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        _clear_pid()
        return False
    try:
        os.kill(pid, 15)  # SIGTERM
    except OSError:
        _clear_pid()
        return False
    for _ in range(20):
        try:
            os.kill(pid, 0)
        except OSError:
            _clear_pid()
            return True
        time.sleep(0.25)
    try:
        os.kill(pid, 9)  # SIGKILL fallback
    except OSError:
        pass
    _clear_pid()
    return True


def _log_tail(max_lines: int = _LOG_TAIL_LINES) -> list[str]:
    try:
        lines = _log_file_path().read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return lines[-max_lines:]


def endpoint_host_port(base_url: str) -> tuple[str, int]:
    parsed = urlparse(base_url if "://" in base_url else f"http://{base_url}")
    host = parsed.hostname or "127.0.0.1"
    return host, parsed.port or 80


def port_occupied(host: str, port: int, timeout: float = 1.0) -> bool:
    """True when a TCP listener accepts connections on (host, port)."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _effective_endpoint() -> tuple[str, str, int]:
    ac = get_autocomplete_settings()
    base_url = ac.get("base_url") or settings.TABBY_BASE_URL or ""
    return base_url, *endpoint_host_port(base_url)


def _spawn_server(binary: str, popen: Callable[..., Any]) -> bool:
    ac = get_autocomplete_settings()
    base_url = ac.get("base_url") or settings.TABBY_BASE_URL or ""
    model = ac.get("model") or _DEFAULT_MODEL
    cmd = build_serve_command(binary, base_url, model)
    _rotate_log_if_oversized()
    try:
        with open(_log_file_path(), "ab") as log_handle:
            proc = popen(cmd, **_detached_popen_kwargs(log_handle))
        pid = getattr(proc, "pid", None)
        if isinstance(pid, int):
            _write_pid(pid)
        return True
    except Exception as exc:
        logger.warning("Failed to spawn Tabby server: %s", exc)
        return False


def start_if_enabled(
    health_probe: Callable[[], bool],
    sleep: Callable[[float], None] = time.sleep,
    popen: Callable[..., Any] = subprocess.Popen,
) -> bool:
    """
    Fire-and-forget launch used when autocomplete is saved with Tabby enabled.
    Spawns the server only when it is not already healthy, the CLI exists, and
    the port is free (installation itself stays the Set Up button's job).
    Returns True when a spawn was performed. Never raises.
    """
    try:
        ac = get_autocomplete_settings()
        if not ac.get("enabled") or ac.get("engine") in ("cloud", "ollama"):
            return False
        if health_probe():
            return False
        binary = find_tabby_binary()
        if binary is None:
            return False
        _base_url, host, port = _effective_endpoint()
        if port_occupied(host, port):
            return False
        if not _spawn_server(binary, popen):
            return False
        # Brief wait so a probe fired right after saving likely succeeds.
        for _ in range(6):
            if health_probe():
                break
            sleep(0.5)
        return True
    except Exception:
        logger.warning("start_if_enabled failed", exc_info=True)
        return False


def setup(
    health_probe: Callable[[], bool],
    sleep: Callable[[float], None] = time.sleep,
    popen: Callable[..., Any] = subprocess.Popen,
    run: Callable[..., Any] = subprocess.run,
) -> dict[str, Any]:
    """
    Ensures Tabby is installed and serving. `health_probe`/`popen`/`run` are
    injectable for tests. Never raises; returns an honest status dict.
    """
    if health_probe():
        return {
            "installed": True,
            "version": None,
            "reachable": True,
            "message": "Tabby is already installed and running.",
        }

    binary = find_tabby_binary()

    if binary is None:
        cmd = install_command(platform.system())
        if cmd is None:
            return {
                "installed": False,
                "version": None,
                "reachable": False,
                "message": (
                    f"No supported package manager found. Install Tabby manually from {TABBY_RELEASES_URL} "
                    "and make sure the 'tabby' command is on your PATH."
                ),
            }
        try:
            run(cmd, check=True, capture_output=True, timeout=600)
        except Exception as exc:
            return {
                "installed": False,
                "version": None,
                "reachable": False,
                "message": f"Automatic installation failed ({exc.__class__.__name__}). "
                f"Install Tabby manually from {TABBY_RELEASES_URL}.",
            }
        binary = find_tabby_binary()
        if binary is None:
            return {
                "installed": False,
                "version": None,
                "reachable": False,
                "message": "Tabby was installed but is not on this process's PATH yet. "
                "Restart OpenResearch (or your terminal) and try again.",
            }

    version = _read_version(binary)

    # Something else may already be squatting on the configured port (Slack,
    # Steam's debug server, another dev server...). Spawning into it would just
    # die with 'address in use', so surface a clear conflict message instead.
    _base_url, host, port = _effective_endpoint()
    if port_occupied(host, port):
        return {
            "installed": True,
            "version": version,
            "reachable": False,
            "message": (
                f"Port {port} is already used by another program, so Tabby cannot serve there. "
                f"Point the Base URL at a free port (for example http://127.0.0.1:9090), save, "
                f"and run Set Up again."
            ),
        }

    spawned = _spawn_server(binary, popen)
    if not spawned:
        return {
            "installed": True,
            "version": version,
            "reachable": False,
            "log_tail": _log_tail(),
            "message": f"Tabby is installed but the server could not be started. See {_log_file_path()}.",
        }

    for _ in range(_STARTUP_POLL_ATTEMPTS):
        if health_probe():
            break
        sleep(_STARTUP_POLL_INTERVAL_SECONDS)
    reachable = health_probe()

    if reachable:
        message = "Tabby server started and healthy."
    else:
        message = (
            "Tabby was launched but is not answering yet — the model may still be downloading. "
            f"Check {_log_file_path()} and try 'Test Connection' again in a few minutes."
        )
    return {
        "installed": True,
        "version": version,
        "reachable": reachable,
        "log_tail": _log_tail(),
        "message": message,
    }
