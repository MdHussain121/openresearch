"""
Local AI provider key management for OpenResearch.

Stores user-supplied API keys for cloud LLM providers in a local JSON file so
the app can call AI models without any login or server-side account. The file
lives under storage/ which is gitignored; keys are never returned in full over
the API (masked responses only).
"""

import ipaddress
import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.core.config import settings

logger = logging.getLogger("openresearch.provider_settings")

PROVIDER_DEFINITIONS: list[dict[str, Any]] = [
    {
        "provider": "openai",
        "label": "OpenAI",
        "default_base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "requires_base_url": False,
        "requires_api_key": True,
    },
    {
        "provider": "anthropic",
        "label": "Anthropic",
        "default_base_url": "https://api.anthropic.com",
        "default_model": "claude-3-5-haiku-latest",
        "requires_base_url": False,
        "requires_api_key": True,
    },
    {
        "provider": "custom",
        "label": "Custom (OpenAI-compatible)",
        "default_base_url": "",
        "default_model": "",
        "requires_base_url": True,
        "requires_api_key": True,
    },
    {
        # Keyless local autocomplete engine. Managed via /ai/autocomplete-settings,
        # never selectable as the active chat provider and excluded from the
        # generic provider key list.
        "provider": "tabby",
        "label": "Tabby (local autocomplete)",
        "default_base_url": None,  # resolved from TABBY_BASE_URL at call time
        "default_model": None,  # resolved from TABBY_MODEL at call time
        "requires_base_url": False,
        "requires_api_key": False,
        "autocomplete_only": True,
    },
]

_AUTOCOMPLETE_ONLY = {d["provider"] for d in PROVIDER_DEFINITIONS if d.get("autocomplete_only")}

# Allowed values for the autocomplete routing engine.
AUTOCOMPLETE_ENGINES = ("auto", "tabby", "cloud", "ollama")


def default_tabby_base_url() -> str:
    return (settings.TABBY_BASE_URL or "http://localhost:8080").strip().rstrip("/")


def default_tabby_model() -> str:
    return (settings.TABBY_MODEL or "").strip()


_KNOWN_PROVIDERS = {d["provider"] for d in PROVIDER_DEFINITIONS}

# Global cloud request cap (requests/minute) shared by all cloud providers.
# None means unlimited. Stored once in the provider store, set from Settings.
MAX_RATE_LIMIT_RPM = 10000

_BLOCKED_HOSTS = {"metadata.google.internal", "169.254.169.254", "instance-data"}
_BLOCKED_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def validate_provider_base_url(url: str) -> None:
    """Reject provider base URLs pointing to private/link-local/metadata endpoints."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Provider base URL must use http or https scheme, got '{parsed.scheme}'")
    hostname = parsed.hostname or ""
    if hostname.lower() in _BLOCKED_HOSTS:
        raise ValueError(
            f"Provider base URL must not target metadata/internal endpoint: {hostname}"
        )
    try:
        addr = ipaddress.ip_address(hostname)
        for net in _BLOCKED_NETS:
            if addr in net:
                raise ValueError(
                    f"Provider base URL must not target private/reserved IP: {hostname}"
                )
    except ValueError:
        # hostname is not an IP literal — that's fine (e.g. api.openai.com)
        pass
    # Block common metadata IP literal patterns even with port tricks
    if hostname == "169.254.169.254":
        raise ValueError("Provider base URL must not target cloud metadata endpoint")


_lock = threading.Lock()


def validate_rate_limit_rpm(value: int | None) -> int | None:
    """Normalizes a user-supplied RPM cap; raises ValueError when out of range."""
    if value is None:
        return None
    try:
        rpm = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Rate limit must be a whole number of requests per minute") from exc
    if rpm < 0:
        raise ValueError("Rate limit cannot be negative")
    if rpm > MAX_RATE_LIMIT_RPM:
        raise ValueError(f"Rate limit cannot exceed {MAX_RATE_LIMIT_RPM} requests/minute")
    return rpm


def get_global_rate_limit() -> int | None:
    with _lock:
        store = _load_store()
    value = store.get("rate_limit_rpm")
    return int(value) if isinstance(value, int) and value > 0 else None


def set_global_rate_limit(rpm: int | None) -> int | None:
    normalized = validate_rate_limit_rpm(rpm)
    with _lock:
        store = _load_store()
        store["rate_limit_rpm"] = normalized
        _save_store(store)
    return normalized


def _store_path() -> Path:
    return Path(settings.UPLOAD_DIR).resolve().parent / "provider_keys.json"


def _load_store() -> dict[str, Any]:
    path = _store_path()
    if not path.exists():
        return {"providers": {}, "active": None, "rate_limit_rpm": None}
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        logger.exception("Failed to read provider key store at %s", path)
        return {"providers": {}, "active": None, "rate_limit_rpm": None}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("Corrupt JSON in provider key store at %s; quarantining", path)
        try:
            quarantine = path.with_name(f"provider_keys.json.corrupt-{int(time.time())}")
            path.replace(quarantine)
            logger.info("Corrupt store moved to %s", quarantine)
        except OSError:
            logger.exception("Failed to quarantine corrupt provider key store")
        return {"providers": {}, "active": None, "rate_limit_rpm": None}
    if not isinstance(data, dict):
        logger.error("Provider key store at %s is not a JSON object; quarantining", path)
        try:
            quarantine = path.with_name(f"provider_keys.json.corrupt-{int(time.time())}")
            path.replace(quarantine)
            logger.info("Non-dict store moved to %s", quarantine)
        except OSError:
            logger.exception("Failed to quarantine non-dict provider key store")
        return {"providers": {}, "active": None, "rate_limit_rpm": None}
    data.setdefault("providers", {})
    data.setdefault("active", None)
    data.setdefault("rate_limit_rpm", None)
    if not isinstance(data.get("providers"), dict):
        data["providers"] = {}
    if data.get("active") is not None and not isinstance(data["active"], str):
        data["active"] = None
    if data.get("rate_limit_rpm") is not None and not isinstance(data["rate_limit_rpm"], int):
        data["rate_limit_rpm"] = None
    return data


def _save_store(store: dict[str, Any]) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, prefix=".provider_keys_tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(store, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def mask_key(api_key: str | None) -> str | None:
    if not api_key:
        return None
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:3]}...{api_key[-4:]}"


def _requires_api_key(definition: dict[str, Any] | None) -> bool:
    return bool(definition.get("requires_api_key", True)) if definition else True


def _public_entry(provider: str, stored: dict[str, Any] | None) -> dict[str, Any]:
    definition = next((d for d in PROVIDER_DEFINITIONS if d["provider"] == provider), None)
    label = definition["label"] if definition else provider
    requires_key = _requires_api_key(definition)
    if not stored or (requires_key and not stored.get("api_key")):
        return {
            "provider": provider,
            "label": label,
            "configured": False,
            "masked_key": None,
            "model": None,
            "base_url": None,
        }
    return {
        "provider": provider,
        "label": label,
        "configured": True,
        "masked_key": mask_key(stored.get("api_key")),
        "model": stored.get("model") or (definition["default_model"] if definition else None),
        "base_url": stored.get("base_url")
        or (definition["default_base_url"] if definition else None),
    }


def list_provider_configs() -> list[dict[str, Any]]:
    with _lock:
        store = _load_store()
    entries = []
    for definition in PROVIDER_DEFINITIONS:
        if definition.get("autocomplete_only"):
            continue  # keyless autocomplete engines are surfaced via /ai/autocomplete-settings
        entries.append(
            _public_entry(definition["provider"], store["providers"].get(definition["provider"]))
        )
    return entries


def get_active_provider_name() -> str | None:
    with _lock:
        store = _load_store()
    active = store.get("active")
    if active and active in _KNOWN_PROVIDERS and active not in _AUTOCOMPLETE_ONLY:
        entry = store["providers"].get(active)
        if entry and entry.get("api_key"):
            return active
    # Fall back to the first configured provider in definition order.
    for definition in PROVIDER_DEFINITIONS:
        if definition.get("autocomplete_only"):
            continue
        entry = store["providers"].get(definition["provider"])
        if entry and entry.get("api_key"):
            return definition["provider"]
    return None


def get_provider_credentials(provider: str) -> dict[str, Any] | None:
    """Returns raw credentials (api_key/model/base_url/rate_limit_rpm) for a configured provider."""
    with _lock:
        store = _load_store()
    stored = store["providers"].get(provider)
    if not stored:
        return None
    definition = next((d for d in PROVIDER_DEFINITIONS if d["provider"] == provider), None)
    if not stored.get("api_key") and _requires_api_key(definition):
        return None
    return {
        "provider": provider,
        "api_key": stored.get("api_key"),
        "model": stored.get("model") or (definition["default_model"] if definition else None),
        "base_url": stored.get("base_url")
        or (definition["default_base_url"] if definition else None),
    }


def set_provider_config(
    provider: str,
    api_key: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    is_active: bool = True,
) -> dict[str, Any] | None:
    if provider not in _KNOWN_PROVIDERS:
        return None
    definition = next(d for d in PROVIDER_DEFINITIONS if d["provider"] == provider)
    with _lock:
        store = _load_store()
        stored = dict(store["providers"].get(provider) or {})
        if api_key is not None:
            stored["api_key"] = api_key.strip()
        if model is not None:
            stored["model"] = model.strip()
        elif not stored.get("model") and definition["default_model"]:
            stored["model"] = definition["default_model"]
        if base_url is not None:
            stripped_url = base_url.strip().rstrip("/")
            if stripped_url:
                validate_provider_base_url(stripped_url)
            stored["base_url"] = stripped_url
        elif not stored.get("base_url") and definition["default_base_url"]:
            stored["base_url"] = definition["default_base_url"]
        if definition["requires_base_url"] and not stored.get("base_url"):
            raise ValueError("A base URL is required for custom OpenAI-compatible providers")
        store["providers"][provider] = stored
        if is_active:
            store["active"] = provider
        _save_store(store)
    return _public_entry(provider, stored)


def delete_provider_config(provider: str) -> bool:
    if provider not in _KNOWN_PROVIDERS:
        return False
    with _lock:
        store = _load_store()
        existed = provider in store["providers"]
        store["providers"].pop(provider, None)
        if store.get("active") == provider:
            store["active"] = None
        _save_store(store)
    return existed


# ------------------------------------------------------------- Autocomplete
def _default_autocomplete_settings() -> dict[str, Any]:
    return {
        "enabled": bool(settings.TABBY_AUTOCOMPLETE_ENABLED),
        "engine": "auto",
        "base_url": default_tabby_base_url(),
        "model": default_tabby_model(),
    }


def get_autocomplete_settings() -> dict[str, Any]:
    """Effective autocomplete settings: env defaults overlaid with the local store."""
    with _lock:
        store = _load_store()
    stored = store.get("autocomplete")
    merged = _default_autocomplete_settings()
    if isinstance(stored, dict):
        if isinstance(stored.get("enabled"), bool):
            merged["enabled"] = stored["enabled"]
        if stored.get("engine") in AUTOCOMPLETE_ENGINES:
            merged["engine"] = stored["engine"]
        if isinstance(stored.get("base_url"), str) and stored["base_url"].strip():
            merged["base_url"] = stored["base_url"].strip().rstrip("/")
        if isinstance(stored.get("model"), str) and stored["model"].strip():
            merged["model"] = stored["model"].strip()
    return merged


def set_autocomplete_settings(
    enabled: bool | None = None,
    engine: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Persists autocomplete routing preferences; raises ValueError on invalid input."""
    if engine is not None and engine not in AUTOCOMPLETE_ENGINES:
        raise ValueError(f"Engine must be one of: {', '.join(AUTOCOMPLETE_ENGINES)}")
    with _lock:
        store = _load_store()
        stored = dict(store.get("autocomplete") or {})
        if enabled is not None:
            stored["enabled"] = bool(enabled)
        if engine is not None:
            stored["engine"] = engine
        if base_url is not None:
            stripped = base_url.strip().rstrip("/")
            if stripped:
                stored["base_url"] = stripped
        if model is not None:
            stripped_model = model.strip()
            if stripped_model:
                stored["model"] = stripped_model
        store["autocomplete"] = stored
        _save_store(store)
    return get_autocomplete_settings()


def clear_runtime_cache() -> None:
    """Reserved for future in-memory caching of provider configs."""
    return
