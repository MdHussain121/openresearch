from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.annotation import PaperAnnotation
    from app.models.chunk import PaperChunk
    from app.models.citation import Citation
    from app.models.project import Project


class Paper(Base):
    __tablename__ = "papers"
    __table_args__ = (Index("ix_papers_pmid", "pmid"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    authors: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON, nullable=True
    )  # Array of author objects
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    arxiv_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    pmid: Mapped[str | None] = mapped_column(String(255), nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    # Required in Phase 1 migration (§11a, Roadmap 1.3): 'ok' | 'unverified'
    extraction_status: Mapped[str] = mapped_column(String(50), nullable=False, default="ok")

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
    project: Mapped[Project] = relationship("Project", back_populates="papers")
    citations: Mapped[list[Citation]] = relationship(
        "Citation", back_populates="paper", cascade="all, delete-orphan"
    )
    annotations: Mapped[list[PaperAnnotation]] = relationship(
        "PaperAnnotation", back_populates="paper", cascade="all, delete-orphan"
    )
    chunks: Mapped[list[PaperChunk]] = relationship(
        "PaperChunk", back_populates="paper", cascade="all, delete-orphan"
    )

    @property
    def primary_author_name(self) -> str:
        """Returns the primary author's family or display name, avoiding Law of Demeter violations."""
        if self.authors and len(self.authors) > 0:
            first = self.authors[0]
            if isinstance(first, dict):
                return (
                    first.get("familyName") or first.get("literal") or first.get("name") or "Author"
                )
            return str(first)
        return "Author"
