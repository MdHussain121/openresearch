from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.membership import Membership
    from app.models.owner import Owner


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 1:1 personal owner relationship in v1
    personal_owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("owners.id"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    personal_owner: Mapped[Owner | None] = relationship("Owner", back_populates="user")
    memberships: Mapped[list[Membership]] = relationship(
        "Membership", back_populates="user", cascade="all, delete-orphan"
    )
