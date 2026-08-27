"""Citation & BibTeX schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.schemas.papers import PaperResponse


class CitationCreate(BaseModel):
    document_id: str
    paper_id: str
    position: int = 0
    citation_style: str = "apa"
    attribution_scope: str = "sentence"
    page_number: int | None = None
    relevant_passage: str | None = None


class CitationResponse(BaseModel):
    id: str
    document_id: str
    paper_id: str
    position: int
    citation_style: str
    attribution_scope: str
    page_number: int | None = None
    relevant_passage: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CitationDetailResponse(BaseModel):
    id: str
    document_id: str
    paper_id: str
    position: int
    citation_style: str
    attribution_scope: str
    page_number: int | None = None
    relevant_passage: str | None = None
    paper_title: str | None = None
    authors: list[dict[str, Any]] | None = None
    year: int | None = None
    doi: str | None = None
    extraction_status: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class IdentifierResolveRequest(BaseModel):
    identifier: str
    id_type: str | None = "auto"  # 'auto' | 'doi' | 'arxiv' | 'pmid'


class IdentifierResolveResponse(BaseModel):
    identifier: str
    id_type: str  # 'doi' | 'arxiv' | 'pmid'
    title: str | None = None
    authors: list[dict[str, Any]] = []
    year: int | None = None
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    pmid: str | None = None
    journal: str | None = None
    publisher: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    url: str | None = None
    bibtex: str | None = None
    extraction_status: str = "ok"


class AddByIdentifierRequest(BaseModel):
    project_id: str
    identifier: str
    id_type: str | None = "auto"


class BibtexImportRequest(BaseModel):
    project_id: str
    bibtex_content: str


class BibtexImportResponse(BaseModel):
    total_imported: int
    papers: list[PaperResponse]


class BibtexExportResponse(BaseModel):
    bibtex_content: str
    total_entries: int


class ContextRankingRequest(BaseModel):
    document_id: str
    paragraph_text: str
    query: str | None = None
    limit: int | None = 10


class ContextRankedPaper(BaseModel):
    paper_id: str
    title: str
    authors: list[dict[str, Any]]
    year: int | None = None
    score: float
    extraction_status: str


class ContextRankingResponse(BaseModel):
    results: list[ContextRankedPaper]
