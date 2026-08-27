from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.citation import Citation
    from app.models.project import Project


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled Paper")
    content_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True
    )  # Structured Tiptap document state
    plain_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
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
    project: Mapped[Project] = relationship("Project", back_populates="documents")
    citations: Mapped[list[Citation]] = relationship(
        "Citation", back_populates="document", cascade="all, delete-orphan"
    )
