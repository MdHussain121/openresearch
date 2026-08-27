from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.chunk import PaperChunk
    from app.models.document import Document
    from app.models.owner import Owner
    from app.models.paper import Paper


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("owners.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    owner: Mapped[Owner | None] = relationship("Owner", back_populates="projects")
    documents: Mapped[list[Document]] = relationship(
        "Document", back_populates="project", cascade="all, delete-orphan"
    )
    papers: Mapped[list[Paper]] = relationship(
        "Paper", back_populates="project", cascade="all, delete-orphan"
    )
    chunks: Mapped[list[PaperChunk]] = relationship(
        "PaperChunk", back_populates="project", cascade="all, delete-orphan"
    )
