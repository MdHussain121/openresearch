"""Project schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    owner_id: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectResponse(BaseModel):
    id: str
    owner_id: str
    name: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
