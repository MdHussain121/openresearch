from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.user import User


class DocumentComment(Base):
    """
    Inline comments and discussion threads on documents (Roadmap 9.2).
    Supports selection anchoring (from_pos, to_pos, selected_text) and threaded replies.
    """

    __tablename__ = "document_comments"
    __table_args__ = (Index("ix_document_comments_user_id", "user_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    author_name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("document_comments.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    selected_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    from_pos: Mapped[int | None] = mapped_column(Integer, nullable=True)
    to_pos: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

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
    document: Mapped[Document] = relationship("Document", backref="comments")
    user: Mapped[User | None] = relationship("User")
    parent: Mapped[DocumentComment | None] = relationship(
        "DocumentComment", remote_side="DocumentComment.id", back_populates="replies"
    )
    replies: Mapped[list[DocumentComment]] = relationship(
        "DocumentComment", back_populates="parent", cascade="all, delete-orphan"
    )
