from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.user import User


class DocumentVersion(Base):
    """
    Document version history snapshot and audit trail (Roadmap 9.2).
    Captures content snapshots, author attribution, and change summaries.
    """

    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint(
            "document_id", "version_number", name="uq_document_versions_document_version"
        ),
        Index("ix_document_versions_user_id", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_name: Mapped[str] = mapped_column(String(255), nullable=False, default="Collaborator")
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled Paper")
    content_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    plain_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    # Relationships
    document: Mapped[Document | None] = relationship("Document", backref="versions")
    user: Mapped[User | None] = relationship("User")
