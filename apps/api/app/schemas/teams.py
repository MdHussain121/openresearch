"""Team schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


class TeamCreate(BaseModel):
    name: str
    description: str | None = None


class TeamUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class TeamMemberAdd(BaseModel):
    email: EmailStr
    role: str = "editor"  # 'owner' | 'editor' | 'viewer'

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        allowed = {"owner", "editor", "viewer"}
        if v not in allowed:
            raise ValueError(f"role must be one of: {', '.join(sorted(allowed))}")
        return v


class TeamMemberUpdate(BaseModel):
    role: str  # 'owner' | 'editor' | 'viewer'

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        allowed = {"owner", "editor", "viewer"}
        if v not in allowed:
            raise ValueError(f"role must be one of: {', '.join(sorted(allowed))}")
        return v


class TeamMemberResponse(BaseModel):
    id: str
    owner_id: str
    user_id: str
    email: EmailStr | None = None
    name: str | None = None
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeamResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    owner_type: str = "team"
    created_by_user_id: str | None = None
    member_count: int = 1
    current_user_role: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
