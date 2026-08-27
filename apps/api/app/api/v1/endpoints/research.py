from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.models.user import User
from app.schemas.models import LiteratureSearchResponse
from app.services.auth import get_current_user
from app.services.literature_search_service import (
    PROVIDER_NAMES,
    literature_search_service,
)

router = APIRouter()


@router.get("/research/search", response_model=LiteratureSearchResponse)
async def search_online_literature(
    q: str = Query(..., min_length=1, max_length=512, description="Free-text literature query"),
    sources: str = Query(
        ",".join(PROVIDER_NAMES.keys()),
        description=f"Comma-separated providers: {', '.join(PROVIDER_NAMES.keys())}",
    ),
    year_start: int | None = Query(None, ge=1000, le=2100),
    year_end: int | None = Query(None, ge=1000, le=2100),
    open_access_only: bool = Query(False),
    limit: int = Query(10, ge=1, le=50, description="Max results per source"),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Search keyless academic APIs (OpenAlex, Crossref, arXiv, Semantic Scholar) in parallel."""
    selected: list[str] = []
    for raw_source in sources.split(","):
        source_key = raw_source.strip().lower()
        if not source_key:
            continue
        if source_key not in PROVIDER_NAMES:
            raise HTTPException(status_code=400, detail=f"Unknown source: {source_key}")
        if source_key not in selected:
            selected.append(source_key)

    if not selected:
        raise HTTPException(status_code=400, detail="At least one source must be selected")

    if year_start and year_end and year_start > year_end:
        raise HTTPException(status_code=400, detail="year_start must be <= year_end")

    return await literature_search_service.search(
        query=q.strip(),
        sources=selected,
        limit=limit,
        offset=offset,
        year_start=year_start,
        year_end=year_end,
        open_access_only=open_access_only,
    )
