"""Auth & User schemas."""

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(
        min_length=8, max_length=128, description="Password must be between 8 and 128 characters"
    )
    name: str = Field(min_length=1, max_length=255)

    @field_validator("password")
    @classmethod
    def validate_password_complexity(cls, v: str) -> str:
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: EmailStr
    name: str
    personal_owner_id: str
    is_admin: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: UserResponse


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class TokenData(BaseModel):
    user_id: str | None = None
    email: str | None = None


class OwnerResponse(BaseModel):
    id: str
    owner_type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MembershipResponse(BaseModel):
    id: str
    owner_id: str
    user_id: str
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
