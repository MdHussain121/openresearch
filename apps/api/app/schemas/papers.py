"""Paper & Annotation schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class PaperCreate(BaseModel):
    project_id: str
    title: str
    authors: list[dict[str, Any]] | None = None
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    pmid: str | None = None
    year: int | None = None
    pdf_path: str | None = None
    metadata_json: dict[str, Any] | None = None
    extraction_status: str = "ok"


class PaperResponse(BaseModel):
    id: str
    project_id: str
    title: str
    authors: list[dict[str, Any]] | None = None
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    year: int | None = None
    extraction_status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaperDetailResponse(BaseModel):
    id: str
    project_id: str
    title: str
    authors: list[dict[str, Any]] | None = None
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    pmid: str | None = None
    year: int | None = None
    metadata_json: dict[str, Any] | None = None
    extraction_status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaperStatusResponse(BaseModel):
    paper_id: str
    step: (
        str  # Currently always 'ready' -- see audit-11 H-5; real transitions need a background queue
    )
    step_index: int  # Currently always 4
    extraction_status: str  # 'ok' | 'unverified'
    chunks_count: int = 0
    message: str | None = None


class AnnotationCreate(BaseModel):
    paper_id: str
    page_number: int = 1
    selected_text: str
    highlight_color: str = "yellow"
    note_text: str | None = None
    position_data: dict[str, Any] | None = None


class AnnotationUpdate(BaseModel):
    highlight_color: str | None = None
    note_text: str | None = None
    ai_thread: list[dict[str, Any]] | None = None


class AnnotationResponse(BaseModel):
    id: str
    paper_id: str
    user_id: str
    page_number: int
    selected_text: str
    highlight_color: str
    note_text: str | None = None
    ai_thread: list[dict[str, Any]] | None = None
    position_data: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
