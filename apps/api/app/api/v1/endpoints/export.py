import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.v1.dependencies.auth import require_document_access
from app.core.database import get_db
from app.models.citation import Citation
from app.models.document import Document
from app.models.paper import Paper
from app.models.user import User
from app.schemas.models import ExportRequest
from app.services.auth import get_current_user
from app.services.export_service import export_service

router = APIRouter()

CITATION_STYLE_DESCRIPTION = (
    "Citation style (26 supported): apa, mla, chicago, chicago-notes, ieee, harvard, vancouver, nature, science, "
    "acm, acs, turabian, ama, nlm, cse, apsa, asa, aaa, mhra, oxford, oscola, bluebook, abnt, iso690, gbt7714, cell"
)


@router.post("/documents/{document_id}/export")
def export_document_post(
    document_id: str,
    payload: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> Response:
    """
    Export a research document to DOCX, PDF, Markdown, or BibTeX format.
    Preserves document structure, citations, math equations, tables, and bibliography.
    """
    citations = (
        db.query(Citation)
        .filter(Citation.document_id == document_id)
        .order_by(Citation.position.asc())
        .all()
    )
    paper_ids = {c.paper_id for c in citations}
    papers = db.query(Paper).filter(Paper.id.in_(paper_ids)).all() if paper_ids else []

    # If no document citations found, fallback to project papers for reference
    if not papers:
        papers = db.query(Paper).filter(Paper.project_id == document.project_id).all()

    try:
        content_data, filename, mime_type = export_service.export_document(
            document=document,
            citations=citations,
            papers=papers,
            export_format=payload.export_format,
            citation_style=payload.citation_style,
            include_bibliography=payload.include_bibliography,
            include_trust_markers=payload.include_trust_markers,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    }

    if isinstance(content_data, io.BytesIO):
        return StreamingResponse(content_data, media_type=mime_type, headers=headers)
    if isinstance(content_data, str):
        return Response(content=content_data.encode("utf-8"), media_type=mime_type, headers=headers)
    return Response(content=bytes(content_data), media_type=mime_type, headers=headers)


@router.get("/documents/{document_id}/export/{export_format}")
def export_document_get(
    document_id: str,
    export_format: str,
    style: str = Query("apa", description=CITATION_STYLE_DESCRIPTION),
    bib: bool = Query(True, description="Include bibliography"),
    trust: bool = Query(True, description="Include trust marker footnotes"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> Response:
    """
    Direct GET download URL for document export in specified format.
    """
    citations = (
        db.query(Citation)
        .filter(Citation.document_id == document_id)
        .order_by(Citation.position.asc())
        .all()
    )
    paper_ids = {c.paper_id for c in citations}
    papers = db.query(Paper).filter(Paper.id.in_(paper_ids)).all() if paper_ids else []

    if not papers:
        papers = db.query(Paper).filter(Paper.project_id == document.project_id).all()

    try:
        content_data, filename, mime_type = export_service.export_document(
            document=document,
            citations=citations,
            papers=papers,
            export_format=export_format,
            citation_style=style,
            include_bibliography=bib,
            include_trust_markers=trust,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    }

    if isinstance(content_data, io.BytesIO):
        return StreamingResponse(content_data, media_type=mime_type, headers=headers)
    return Response(
        content=content_data.encode("utf-8")
        if isinstance(content_data, str)
        else bytes(content_data),
        media_type=mime_type,
        headers=headers,
    )
