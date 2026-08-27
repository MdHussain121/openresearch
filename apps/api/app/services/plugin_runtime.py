"""Plugin runtime: resolves and executes registered plugin entrypoint hooks.

Entrypoints are ``"module.path:function_name"`` strings stored on each
``PluginConfig.entrypoints`` row keyed by hook name (e.g. ``on_export``).
Only modules inside the configured namespace allowlist may be imported,
and a failing plugin never breaks the dispatch loop.
"""

import importlib
import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.plugin import PluginConfig

logger = logging.getLogger("openresearch.plugin_runtime")

HOOK_REGISTRY: dict[str, str] = {
    "on_paper_extract": "research_provider",
    "on_citation_format": "citation_processor",
    "on_ai_transform": "ai_provider",
    "on_export": "export_transformer",
}

_RESOLUTION_CACHE: dict[str, Callable[..., dict[str, Any]]] = {}


class PluginEntrypointError(ValueError):
    """Raised when an entrypoint spec is malformed, disallowed, or unresolvable."""


def allowed_module_prefixes() -> tuple[str, ...]:
    raw = getattr(settings, "PLUGIN_ALLOWED_MODULE_PREFIXES", "app.plugins.")
    return tuple(p.strip().rstrip(".") + "." for p in raw.split(",") if p.strip())


def validate_entrypoint_spec(spec: str) -> None:
    if not isinstance(spec, str) or spec.count(":") != 1:
        raise PluginEntrypointError(f"Invalid entrypoint '{spec}'; expected 'module.path:function'")
    module_name, attr = spec.split(":", 1)
    if not module_name or not attr.replace(".", "").replace("_", "").isalnum():
        raise PluginEntrypointError(f"Invalid entrypoint '{spec}'")
    if (
        module_name.startswith(".")
        or ".." in module_name
        or "/" in module_name
        or "\\" in module_name
    ):
        raise PluginEntrypointError(f"Illegal module path in entrypoint '{spec}'")
    prefixes = allowed_module_prefixes()
    if not any(module_name.startswith(prefix) for prefix in prefixes):
        raise PluginEntrypointError(
            f"Module '{module_name}' is outside the allowed plugin namespaces: {', '.join(prefixes)}"
        )


def resolve_entrypoint(spec: str) -> Callable[..., dict[str, Any]]:
    validate_entrypoint_spec(spec)
    if spec in _RESOLUTION_CACHE:
        return _RESOLUTION_CACHE[spec]

    module_name, attr = spec.split(":", 1)
    try:
        module = importlib.import_module(module_name)
        func = getattr(module, attr)
    except (ImportError, AttributeError) as exc:
        raise PluginEntrypointError(f"Cannot resolve entrypoint '{spec}': {exc}") from exc
    if not callable(func):
        raise PluginEntrypointError(f"Entrypoint '{spec}' is not callable")

    _RESOLUTION_CACHE[spec] = func
    return func


def clear_resolution_cache() -> None:
    _RESOLUTION_CACHE.clear()


def dispatch_hook(
    db: Session, hook_name: str, payload: dict[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Runs every enabled plugin of the hook's matching type against the payload.
    Returns ``(result_payload, execution_log)``; per-plugin failures are isolated.
    """
    expected_type = HOOK_REGISTRY.get(hook_name)
    if expected_type is None:
        raise PluginEntrypointError(
            f"Unknown hook '{hook_name}'; valid hooks: {sorted(HOOK_REGISTRY)}"
        )

    result = dict(payload)
    executions: list[dict[str, Any]] = []
    ran_plugin_ids: list[str] = []

    plugins = (
        db.query(PluginConfig)
        .filter(PluginConfig.enabled.is_(True), PluginConfig.plugin_type == expected_type)
        .order_by(PluginConfig.name.asc())
        .all()
    )

    for plugin in plugins:
        spec = (plugin.entrypoints or {}).get(hook_name)
        if not spec:
            executions.append(
                {"plugin_id": plugin.plugin_id, "status": "skipped", "reason": "no_entrypoint"}
            )
            continue
        try:
            func = resolve_entrypoint(spec)
            output = func(result, dict(plugin.config_json or {}))
            if not isinstance(output, dict):
                raise PluginEntrypointError("Hook must return a dict payload")
            result = output
            ran_plugin_ids.append(plugin.plugin_id)
            executions.append({"plugin_id": plugin.plugin_id, "status": "ok"})
        except Exception as exc:
            logger.warning("Plugin %s failed on hook %s: %s", plugin.plugin_id, hook_name, exc)
            executions.append({"plugin_id": plugin.plugin_id, "status": "error", "error": str(exc)})

    _apply_legacy_tags(hook_name, result, ran_plugin_ids)
    return result, executions


def _apply_legacy_tags(hook_name: str, result: dict[str, Any], ran_plugin_ids: list[str]) -> None:
    """Preserves the pre-runtime enrichment markers for API compatibility."""
    if not ran_plugin_ids:
        return
    if hook_name == "on_paper_extract":
        existing = result.get("enriched_by")
        merged = list(existing) if isinstance(existing, list) else []
        result["enriched_by"] = merged + [pid for pid in ran_plugin_ids if pid not in merged]
    elif hook_name == "on_citation_format":
        result["processed_by_csl"] = True
    elif hook_name == "on_export":
        result["supports_custom_transform"] = True
