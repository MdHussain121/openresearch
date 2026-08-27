from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PluginConfig(Base):
    """
    Persisted configuration and enabled state for plugins (Roadmap 9.4).
    Respects the AGPL-3.0 network boundary.
    """

    __tablename__ = "plugin_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    plugin_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False, default="1.0.0")
    plugin_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # 'research_provider' | 'ai_provider' | 'export_transformer' | 'citation_processor' | 'editor_extension'
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    license: Mapped[str] = mapped_column(String(50), nullable=False, default="MIT")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    entrypoints: Mapped[dict[str, str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
