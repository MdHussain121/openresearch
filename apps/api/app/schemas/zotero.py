"""Zotero sync & import schemas."""

from pydantic import BaseModel, Field

from app.schemas.papers import PaperResponse


class ZoteroImportRequest(BaseModel):
    api_key: str | None = None
    user_id: str | None = None
    collection_id: str | None = None
    csl_json_content: str | None = Field(default=None, max_length=1_000_000)


class ZoteroImportResponse(BaseModel):
    total_imported: int
    papers: list[PaperResponse]
    skipped_count: int = 0
    message: str


class ZoteroSyncRequest(BaseModel):
    api_key: str
    user_id: str
    collection_id: str | None = None


class ZoteroSyncResponse(BaseModel):
    synced_items_count: int
    new_papers: list[PaperResponse]
    last_synced_version: int | None = None
