from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.paper import Paper
    from app.models.user import User


class PaperAnnotation(Base):
    __tablename__ = "paper_annotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    paper_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )

    page_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    selected_text: Mapped[str] = mapped_column(Text, nullable=False)
    highlight_color: Mapped[str] = mapped_column(String(50), nullable=False, default="yellow")
    note_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_thread: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON, nullable=True
    )  # Array of message objects: [{role, message, timestamp}]
    position_data: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True
    )  # Optional coordinates / bounding rects

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    paper: Mapped[Paper] = relationship("Paper", back_populates="annotations")
    user: Mapped[User | None] = relationship("User")
