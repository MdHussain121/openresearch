import logging
import threading
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.models.user import User
from app.schemas.models import (
    AutocompleteProbeResponse,
    AutocompleteSettingsResponse,
    AutocompleteSettingsUpdate,
)
from app.services import tabby_setup_service
from app.services.auth import get_current_admin_user, get_current_user
from app.services.llm_service import llm_service
from app.services.provider_settings import (
    PROVIDER_DEFINITIONS,
    delete_provider_config,
    get_active_provider_name,
    get_autocomplete_settings,
    get_global_rate_limit,
    list_provider_configs,
    set_autocomplete_settings,
    set_global_rate_limit,
    set_provider_config,
)

router = APIRouter()

logger = logging.getLogger("openresearch.provider_settings")


def _start_tabby_in_background() -> None:
    """Best-effort local Tabby launch after settings are saved with it enabled."""
    try:
        tabby_setup_service.start_if_enabled(lambda: llm_service.probe_tabby(force=True))
    except Exception:
        logger.warning("Background Tabby start failed", exc_info=True)


class ProviderConfigUpdate(BaseModel):
    api_key: str | None = None
    model: str | None = None
    base_url: str | None = None
    is_active: bool = True


class RateLimitUpdate(BaseModel):
    rate_limit_rpm: int | None = None


@router.get("/ai/providers")
def list_ai_providers(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    """
    Local AI provider configuration (no login required).
    Lists supported providers, their configuration status, and masked keys.
    """
    return {
        "active": get_active_provider_name(),
        "providers": list_provider_configs(),
    }


@router.put("/ai/providers/{provider}")
def update_ai_provider(
    provider: str,
    config_in: ProviderConfigUpdate,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if provider not in {d["provider"] for d in PROVIDER_DEFINITIONS}:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider}'")
    try:
        entry = set_provider_config(
            provider,
            api_key=config_in.api_key,
            model=config_in.model,
            base_url=config_in.base_url,
            is_active=config_in.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"active": get_active_provider_name(), "provider": entry}


@router.get("/ai/rate-limit")
def read_cloud_rate_limit(current_user: User = Depends(get_current_user)) -> dict[str, int | None]:
    """Global cloud AI rate limit (requests/minute) shared by every provider; null = unlimited."""
    return {"rate_limit_rpm": get_global_rate_limit()}


@router.put("/ai/rate-limit")
def update_cloud_rate_limit(
    limit_in: RateLimitUpdate, current_user: User = Depends(get_current_user)
) -> dict[str, int | None]:
    try:
        rpm = set_global_rate_limit(limit_in.rate_limit_rpm)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"rate_limit_rpm": rpm}


@router.delete("/ai/providers/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def remove_ai_provider(provider: str, current_user: User = Depends(get_current_user)) -> None:
    if not delete_provider_config(provider):
        raise HTTPException(status_code=404, detail=f"No stored configuration for '{provider}'")


@router.get("/ai/autocomplete-settings", response_model=AutocompleteSettingsResponse)
def read_autocomplete_settings(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    """
    Inline autocomplete routing preferences (master toggle, engine, Tabby endpoint).
    """
    return get_autocomplete_settings()


@router.put("/ai/autocomplete-settings", response_model=AutocompleteSettingsResponse)
def update_autocomplete_settings(
    config_in: AutocompleteSettingsUpdate,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        updated = set_autocomplete_settings(**config_in.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # When the save turns Tabby on (engine auto/tabby), make sure a local server
    # is running. Spawned from a daemon thread so the PUT returns immediately.
    if updated["enabled"] and updated["engine"] in ("auto", "tabby"):
        threading.Thread(target=_start_tabby_in_background, daemon=True).start()
    return updated


@router.post("/ai/autocomplete-settings/probe", response_model=AutocompleteProbeResponse)
def probe_autocomplete_engine(
    current_user: User = Depends(get_current_user),
) -> AutocompleteProbeResponse:
    """
    Health-probes the configured local autocomplete engine (Tabby /v1/health),
    bypassing the availability cache so 'Test Connection' reflects live state.
    """
    reachable = llm_service.probe_tabby(force=True)
    base_url = get_autocomplete_settings()["base_url"]
    return AutocompleteProbeResponse(reachable=reachable, base_url=base_url)


@router.get("/ai/autocomplete-settings/status")
def read_tabby_setup_status(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    """
    Local Tabby installation status for the 'Set Up Tabby' flow:
    whether the CLI is installed (and its version) and whether the server responds.
    """
    return tabby_setup_service.get_status(reachable=llm_service.probe_tabby(force=True))


@router.post("/ai/autocomplete-settings/setup")
def run_tabby_setup(current_user: User = Depends(get_current_admin_user)) -> dict[str, Any]:
    """
    Best-effort one-click Tabby setup: installs the CLI when missing
    (winget/Homebrew), starts `tabby serve --model <model> --device cpu` detached,
    and polls the health endpoint briefly. Never raises; returns an honest status.
    """
    return tabby_setup_service.setup(health_probe=lambda: llm_service.probe_tabby(force=True))
