from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.paper import Paper
    from app.models.project import Project


class PaperChunk(Base):
    __tablename__ = "paper_chunks"

    # Chunk schema: paper_id, page_number, section, paragraph, chunk_id
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    paper_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    page_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    section: Mapped[str] = mapped_column(String(255), default="General", nullable=False)
    paragraph: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Embedding vector stored as JSON array of floats for cross-engine compatibility (SQLite & pgvector)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    paper: Mapped[Paper | None] = relationship("Paper", back_populates="chunks")
    project: Mapped[Project | None] = relationship("Project", back_populates="chunks")
