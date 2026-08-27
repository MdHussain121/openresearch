"""System schemas (provider status, cache, literature search)."""

from typing import Any

from pydantic import BaseModel, Field


class ProviderStatusItem(BaseModel):
    provider_name: str
    tier: str  # 'free' | 'paid' | 'custom'
    is_usage_based: bool
    requests_made: int
    requests_remaining: int | None = None
    monthly_quota: int | None = None
    cache_hits: int
    cache_misses: int
    cache_hit_rate: float
    status: str  # 'healthy' | 'warning' | 'exceeded'


class ProviderQuotaResponse(BaseModel):
    providers: list[ProviderStatusItem]
    total_cached_queries: int
    overall_cache_hit_rate: float
    notice: str = "OpenAlex free tier includes 100k requests/month. Queries are cached with 24h TTL to preserve quota."


class CacheClearResponse(BaseModel):
    cleared_entries: int
    status: str = "ok"


class LiteratureResult(BaseModel):
    title: str
    authors: list[dict[str, Any]] = []
    year: int | None = None
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    pmid: str | None = None
    venue: str | None = None
    url: str | None = None
    pdf_url: str | None = None
    open_access: bool = False
    citation_count: int | None = None
    source: str


class LiteratureSourceResult(BaseModel):
    source: str
    status: str = "ok"
    error: str | None = None
    total: int | None = None
    results: list[LiteratureResult] = Field(default_factory=list)


class LiteratureSearchResponse(BaseModel):
    query: str
    sources: list[LiteratureSourceResult]
