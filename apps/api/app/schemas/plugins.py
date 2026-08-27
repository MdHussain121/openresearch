"""Plugin schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PluginManifest(BaseModel):
    id: str
    name: str
    version: str = "1.0.0"
    plugin_type: str  # 'research_provider' | 'ai_provider' | 'export_transformer' | 'citation_processor' | 'editor_extension'
    description: str | None = None
    author: str | None = None
    license: str = "MIT"
    entrypoints: dict[str, str] | None = None
    settings_schema: dict[str, Any] | None = None


class PluginResponse(BaseModel):
    id: str
    plugin_id: str
    name: str
    version: str
    plugin_type: str
    description: str | None = None
    author: str | None = None
    license: str
    enabled: bool
    config_json: dict[str, Any] | None = None
    entrypoints: dict[str, str] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PluginToggleRequest(BaseModel):
    enabled: bool


class PluginConfigUpdate(BaseModel):
    config_json: dict[str, Any]


class PluginHookExecuteRequest(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)


class PluginHookExecuteResponse(BaseModel):
    hook_name: str
    plugin_type: str
    payload: dict[str, Any]
    executions: list[dict[str, Any]]
