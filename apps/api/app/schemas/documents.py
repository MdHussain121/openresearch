"""Document schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class DocumentCreate(BaseModel):
    project_id: str
    title: str = "Untitled Paper"
    content_json: dict[str, Any] | None = None
    plain_text: str | None = None


class DocumentUpdate(BaseModel):
    title: str | None = None
    content_json: dict[str, Any] | None = None
    plain_text: str | None = None
    version: int | None = None


class DocumentListItem(BaseModel):
    id: str
    project_id: str
    title: str
    version: int = 1
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentResponse(BaseModel):
    id: str
    project_id: str
    title: str
    content_json: dict[str, Any] | None = None
    plain_text: str | None = None
    version: int = 1
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
