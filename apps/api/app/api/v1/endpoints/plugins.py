from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.plugin import PluginConfig
from app.models.user import User
from app.schemas.models import (
    PluginConfigUpdate,
    PluginHookExecuteRequest,
    PluginHookExecuteResponse,
    PluginManifest,
    PluginResponse,
    PluginToggleRequest,
)
from app.services.auth import get_current_admin_user, get_current_user
from app.services.plugin_runtime import HOOK_REGISTRY, PluginEntrypointError
from app.services.plugin_service import PluginService

router = APIRouter()


@router.get("/plugins", response_model=list[PluginResponse])
def list_plugins(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PluginConfig]:
    """
    Lists all installed and available plugins across extension points (Roadmap 9.4).
    """
    return PluginService.list_plugins(db)


@router.get("/plugins/hooks", response_model=list[str])
def list_hooks(current_user: User = Depends(get_current_user)) -> list[str]:
    """Lists the executable hook names supported by the plugin runtime."""
    return sorted(HOOK_REGISTRY)


@router.post("/plugins/hooks/{hook_name}", response_model=PluginHookExecuteResponse)
def execute_hook(
    hook_name: str,
    body: PluginHookExecuteRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> PluginHookExecuteResponse:
    """
    Fans a payload out to every enabled plugin registered for this hook,
    invoking its entrypoint code and returning the transformed payload.
    """
    try:
        result, executions = PluginService.execute_hook_detailed(db, hook_name, body.payload)
    except PluginEntrypointError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PluginHookExecuteResponse(
        hook_name=hook_name,
        plugin_type=HOOK_REGISTRY[hook_name],
        payload=result,
        executions=executions,
    )


@router.get("/plugins/{plugin_id}", response_model=PluginResponse)
def get_plugin_details(
    plugin_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PluginConfig:
    plugin = PluginService.get_plugin(db, plugin_id)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return plugin


@router.post(
    "/plugins/register", response_model=PluginResponse, status_code=status.HTTP_201_CREATED
)
def register_plugin(
    manifest: PluginManifest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> PluginConfig:
    """
    Registers a new plugin manifest adhering to the AGPL-3.0 boundary (Admin only).
    """
    try:
        return PluginService.register_plugin(db, manifest)
    except PluginEntrypointError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/plugins/{plugin_id}/toggle", response_model=PluginResponse)
def toggle_plugin(
    plugin_id: str,
    toggle_in: PluginToggleRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> PluginConfig:
    """
    Enables or disables an active plugin (Admin only).
    """
    plugin = PluginService.toggle_plugin(db, plugin_id, toggle_in.enabled)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return plugin


@router.patch("/plugins/{plugin_id}/config", response_model=PluginResponse)
def update_plugin_config(
    plugin_id: str,
    config_in: PluginConfigUpdate,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
) -> PluginConfig:
    """
    Updates configuration settings for a registered plugin (Admin only).
    """
    plugin = PluginService.update_plugin_config(db, plugin_id, config_in.config_json)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return plugin
