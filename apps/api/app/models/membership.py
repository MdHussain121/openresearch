from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.owner import Owner
    from app.models.user import User


class Membership(Base):
    """
    Grants access between a User and an Owner.
    Enforces authorization uniformly (Roadmap 1.3).
    """

    __tablename__ = "memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("owners.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="owner"
    )  # 'owner' | 'editor' | 'viewer'
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("owner_id", "user_id", name="uq_owner_user_membership"),
        Index("ix_memberships_user_id", "user_id"),
    )

    # Relationships
    owner: Mapped[Owner | None] = relationship("Owner", back_populates="memberships")
    user: Mapped[User | None] = relationship("User", back_populates="memberships")
