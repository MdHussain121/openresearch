from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.paper import Paper


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    paper_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    citation_style: Mapped[str] = mapped_column(String(50), nullable=False, default="apa")

    # Clause-level attribution support from Phase 1 (§26a, Roadmap 1.3): 'sentence' | 'clause'
    attribution_scope: Mapped[str] = mapped_column(String(20), nullable=False, default="sentence")
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    relevant_passage: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    document: Mapped[Document] = relationship("Document", back_populates="citations")
    paper: Mapped[Paper] = relationship("Paper", back_populates="citations")
