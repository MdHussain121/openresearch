"""Version schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class VersionCreate(BaseModel):
    title: str | None = None
    content_json: dict[str, Any] | None = None
    plain_text: str | None = None
    change_summary: str | None = None


class VersionResponse(BaseModel):
    id: str
    document_id: str
    version_number: int
    user_id: str | None = None
    author_name: str
    title: str
    content_json: dict[str, Any] | None = None
    plain_text: str | None = None
    change_summary: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VersionDiffItem(BaseModel):
    change_type: str  # 'equal' | 'insert' | 'delete'
    text: str


class VersionDiffResponse(BaseModel):
    v1_id: str
    v2_id: str
    v1_version: int
    v2_version: int
    diff_summary: str
    diff_items: list[VersionDiffItem]
