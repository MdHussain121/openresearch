import re

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.core.authors import parse_bibtex_author_field
from app.core.database import get_db
from app.core.text_utils import normalize_author_record
from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    AddByIdentifierRequest,
    BibtexExportResponse,
    BibtexImportRequest,
    BibtexImportResponse,
    CitationCreate,
    CitationDetailResponse,
    ContextRankedPaper,
    ContextRankingRequest,
    ContextRankingResponse,
    IdentifierResolveRequest,
    IdentifierResolveResponse,
    PaperResponse,
)
from app.services.auth import get_current_user, verify_user_access_to_owner
from app.services.export.bibtex_exporter import serialize_paper_bibtex
from app.services.identifier_resolver import identifier_resolver

router = APIRouter()


# --- 1. Citation CRUD & Sync Endpoints ---


@router.get("/documents/{document_id}/citations", response_model=list[CitationDetailResponse])
def list_document_citations(
    document_id: str,
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=500, description="Pagination limit"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CitationDetailResponse]:
    """List all citations in a document with paper details."""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    if not verify_user_access_to_owner(db, current_user.id, document.project.owner_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    citations = (
        db.query(Citation)
        .options(joinedload(Citation.paper))
        .filter(Citation.document_id == document_id)
        .order_by(Citation.position.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    results: list[CitationDetailResponse] = []
    for c in citations:
        paper = c.paper
        results.append(
            CitationDetailResponse(
                id=c.id,
                document_id=c.document_id,
                paper_id=c.paper_id,
                position=c.position,
                citation_style=c.citation_style,
                attribution_scope=c.attribution_scope,
                page_number=c.page_number,
                relevant_passage=c.relevant_passage,
                paper_title=paper.title if paper else "Unknown Paper",
                authors=paper.authors if paper else [],
                year=paper.year if paper else None,
                doi=paper.doi if paper else None,
                extraction_status=paper.extraction_status if paper else "ok",
                created_at=c.created_at,
            )
        )
    return results


@router.post(
    "/documents/{document_id}/citations",
    response_model=CitationDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_citation(
    document_id: str,
    citation_in: CitationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CitationDetailResponse:
    """Insert a new citation into a document."""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    if not verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(status_code=403, detail="Permission denied")

    paper = db.query(Paper).filter(Paper.id == citation_in.paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    citation = Citation(
        document_id=document_id,
        paper_id=citation_in.paper_id,
        position=citation_in.position,
        citation_style=citation_in.citation_style,
        attribution_scope=citation_in.attribution_scope,
        page_number=citation_in.page_number,
        relevant_passage=citation_in.relevant_passage,
    )
    db.add(citation)
    db.commit()
    db.refresh(citation)

    return CitationDetailResponse(
        id=citation.id,
        document_id=citation.document_id,
        paper_id=citation.paper_id,
        position=citation.position,
        citation_style=citation.citation_style,
        attribution_scope=citation.attribution_scope,
        page_number=citation.page_number,
        relevant_passage=citation.relevant_passage,
        paper_title=paper.title,
        authors=paper.authors,
        year=paper.year,
        doi=paper.doi,
        extraction_status=paper.extraction_status,
        created_at=citation.created_at,
    )


@router.delete(
    "/documents/{document_id}/citations/{citation_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_citation(
    document_id: str,
    citation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete a single citation."""
    citation = (
        db.query(Citation)
        .filter(Citation.id == citation_id, Citation.document_id == document_id)
        .first()
    )
    if not citation:
        raise HTTPException(status_code=404, detail="Citation not found")

    document = citation.document
    if not verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(status_code=403, detail="Permission denied")

    db.delete(citation)
    db.commit()
    return


# --- 2. Identifier Resolution & Add by Identifier ---


@router.post("/citations/resolve-identifier", response_model=IdentifierResolveResponse)
async def resolve_identifier(
    payload: IdentifierResolveRequest,
    current_user: User = Depends(get_current_user),
) -> IdentifierResolveResponse:
    """Resolve DOI, arXiv ID, or PMID to rich metadata with preview."""
    meta = await identifier_resolver.resolve(payload.identifier, payload.id_type or "auto")
    return IdentifierResolveResponse(**meta)


@router.post(
    "/projects/{project_id}/papers/add-by-identifier",
    response_model=PaperResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_paper_by_identifier(
    project_id: str,
    payload: AddByIdentifierRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Paper:
    """Resolve metadata and directly create Paper record in project library."""

    def _verify_and_resolve_target():
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not verify_user_access_to_owner(
            db, current_user.id, project.owner_id, required_roles=["owner", "editor"]
        ):
            raise HTTPException(status_code=403, detail="Permission denied")
        return project

    await anyio.to_thread.run_sync(_verify_and_resolve_target)
    meta = await identifier_resolver.resolve(payload.identifier, payload.id_type or "auto")

    if meta.get("extraction_status") == "unresolved" or not meta.get("title"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Identifier '{payload.identifier}' could not be resolved via DOI, arXiv, or PubMed. "
                "No library record was created. Verify the identifier and try again."
            ),
        )

    def _save_paper():
        paper = Paper(
            project_id=project_id,
            title=meta.get("title"),
            authors=[normalize_author_record(a) for a in (meta.get("authors") or [])],
            abstract=meta.get("abstract"),
            doi=meta.get("doi"),
            arxiv_id=meta.get("arxiv_id"),
            pmid=meta.get("pmid"),
            year=meta.get("year"),
            metadata_json={
                "journal": meta.get("journal"),
                "publisher": meta.get("publisher"),
                "volume": meta.get("volume"),
                "issue": meta.get("issue"),
                "pages": meta.get("pages"),
                "url": meta.get("url"),
                "source_type": meta.get("id_type"),
            },
            extraction_status=meta.get("extraction_status", "ok"),
        )
        db.add(paper)
        db.commit()
        db.refresh(paper)
        return paper

    return await anyio.to_thread.run_sync(_save_paper)


# --- 3. BibTeX Import & Export (Roadmap 5.3) ---


@router.post(
    "/projects/{project_id}/papers/import-bibtex",
    response_model=BibtexImportResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_bibtex(
    project_id: str,
    payload: BibtexImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BibtexImportResponse:
    """Parse BibTeX string (.bib content) and add entries as papers to project library."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not verify_user_access_to_owner(
        db, current_user.id, project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(status_code=403, detail="Permission denied")

    content = payload.bibtex_content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="BibTeX content is empty")
    if len(content) > 2_000_000:
        raise HTTPException(status_code=413, detail="BibTeX content exceeds the 2 MB limit")

    entry_regex = re.compile(r"@([a-zA-Z]+)\s*\{\s*([^,]+),([\s\S]*?)(?=\n@|\n*$)", re.MULTILINE)
    imported_papers: list[Paper] = []

    matches = list(entry_regex.finditer(content))
    if len(matches) > 500:
        raise HTTPException(
            status_code=413, detail="BibTeX import is limited to 500 entries per request"
        )

    for match in matches:
        entry_type = match.group(1).lower()
        cite_key = match.group(2).strip()
        body = match.group(3)

        fields: dict[str, str] = {}
        field_regex = re.compile(
            r'([a-zA-Z0-9_-]+)\s*=\s*(?:\{([^}]*)\}|"([^"]*)"|([0-9a-zA-Z_-]+))'
        )
        for fm in field_regex.finditer(body):
            k = fm.group(1).lower().strip()
            v = (fm.group(2) or fm.group(3) or fm.group(4) or "").strip()
            fields[k] = v

        title = fields.get("title") or fields.get("booktitle") or f"BibTeX Entry ({cite_key})"
        raw_authors = fields.get("author") or fields.get("editor") or ""
        authors = parse_bibtex_author_field(raw_authors)

        year_val = None
        if fields.get("year"):
            y_digits = re.sub(r"[^0-9]", "", fields["year"])
            if y_digits:
                year_val = int(y_digits)

        paper = Paper(
            project_id=project_id,
            title=title,
            authors=authors,
            abstract=fields.get("abstract"),
            doi=fields.get("doi"),
            arxiv_id=fields.get("eprint")
            if fields.get("archiveprefix", "").lower() == "arxiv"
            else None,
            pmid=fields.get("pmid"),
            year=year_val,
            metadata_json={
                "citation_key": cite_key,
                "entry_type": entry_type,
                "journal": fields.get("journal") or fields.get("journaltitle"),
                "booktitle": fields.get("booktitle"),
                "volume": fields.get("volume"),
                "issue": fields.get("number") or fields.get("issue"),
                "pages": fields.get("pages"),
                "publisher": fields.get("publisher"),
                "raw_bibtex": match.group(0).strip(),
            },
            extraction_status="ok",
        )
        db.add(paper)
        imported_papers.append(paper)

    db.commit()
    for p in imported_papers:
        db.refresh(p)

    return BibtexImportResponse(
        total_imported=len(imported_papers),
        papers=[PaperResponse.model_validate(p) for p in imported_papers],
    )


@router.get("/projects/{project_id}/export/bibtex", response_model=BibtexExportResponse)
def export_project_bibtex(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BibtexExportResponse:
    """Export all papers in a project library to a .bib format."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not verify_user_access_to_owner(db, current_user.id, project.owner_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    papers = db.query(Paper).filter(Paper.project_id == project_id).all()
    bib_entries = [serialize_paper_bibtex(p) for p in papers]
    full_bibtex = "\n\n".join(bib_entries)

    return BibtexExportResponse(
        bibtex_content=full_bibtex,
        total_entries=len(papers),
    )


@router.get("/documents/{document_id}/export/bibtex", response_model=BibtexExportResponse)
def export_document_bibtex(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BibtexExportResponse:
    """Export all cited papers in a specific document as a .bib file."""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    if not verify_user_access_to_owner(db, current_user.id, document.project.owner_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    citations = db.query(Citation).filter(Citation.document_id == document_id).all()
    paper_ids = {c.paper_id for c in citations}
    papers = db.query(Paper).filter(Paper.id.in_(paper_ids)).all() if paper_ids else []

    bib_entries = [serialize_paper_bibtex(p) for p in papers]
    full_bibtex = "\n\n".join(bib_entries)

    return BibtexExportResponse(
        bibtex_content=full_bibtex,
        total_entries=len(papers),
    )


# --- 4. Context Relevance Ranking for @-Inline Citation Popover (UI/UX §4.1) ---


@router.post(
    "/documents/{document_id}/citations/rank-context", response_model=ContextRankingResponse
)
def rank_citations_for_context(
    document_id: str,
    payload: ContextRankingRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContextRankingResponse:
    """
    Ranks library papers for the @-triggered citation popover based on:
    1. Query text match (if query is typed).
    2. Paragraph text semantic context match (keywords / concepts).
    """
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    if not verify_user_access_to_owner(db, current_user.id, document.project.owner_id):
        raise HTTPException(status_code=403, detail="Permission denied")

    papers = db.query(Paper).filter(Paper.project_id == document.project_id).all()
    results: list[ContextRankedPaper] = []

    q = (payload.query or "").strip().lower()
    para_words = {w.lower() for w in re.findall(r"\b\w{4,}\b", payload.paragraph_text)}

    for p in papers:
        score = 0.0
        title_lower = (p.title or "").lower()
        abstract_lower = (p.abstract or "").lower()
        author_names = " ".join(
            [
                f"{a.get('familyName') or ''} {a.get('givenName') or ''}"
                for a in (p.authors or [])
                if isinstance(a, dict)
            ]
        ).lower()
        year_str = str(p.year) if p.year else ""

        if q:
            if title_lower.startswith(q):
                score += 30.0
            elif q in title_lower:
                score += 15.0
            if q in author_names:
                score += 20.0
            if q == year_str:
                score += 10.0
            if q in abstract_lower:
                score += 5.0
            if p.doi and q in p.doi.lower():
                score += 10.0
            if p.arxiv_id and q in p.arxiv_id.lower():
                score += 10.0
        else:
            score = 1.0

        # Context keyword overlap
        for w in para_words:
            if w in title_lower:
                score += 3.0
            if w in abstract_lower:
                score += 1.0

        if q and score <= 0.0:
            continue

        results.append(
            ContextRankedPaper(
                paper_id=p.id,
                title=p.title,
                authors=p.authors or [],
                year=p.year,
                score=round(score, 2),
                extraction_status=p.extraction_status,
            )
        )

    results.sort(key=lambda r: r.score, reverse=True)
    limit = payload.limit or 10
    return ContextRankingResponse(results=results[:limit])
