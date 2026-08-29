import logging
import os
import uuid
from typing import Any, Literal

import anyio
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.v1.dependencies.auth import require_project_access
from app.core.config import settings
from app.core.constants import BYTES_PER_MB
from app.core.database import get_db
from app.models.annotation import PaperAnnotation
from app.models.chunk import PaperChunk
from app.models.paper import Paper
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    AnnotationCreate,
    AnnotationResponse,
    AnnotationUpdate,
    AskPaperAIRequest,
    AskPaperAIResponse,
    GroundedPassage,
    PaperDetailResponse,
    PaperResponse,
    PaperStatusResponse,
)
from app.services.auth import get_current_user, verify_user_access_to_owner
from app.services.pdf_extractor import PDFExtractionError, PDFValidator, pdf_extractor
from app.services.rag_service import rag_service

router = APIRouter()
logger = logging.getLogger("openresearch.papers")

UPLOAD_CHUNK_SIZE_BYTES = BYTES_PER_MB


def get_upload_dir(project_id: str) -> str:
    """Ensure upload directory exists for project."""
    dir_path = os.path.join(settings.UPLOAD_DIR, project_id)
    os.makedirs(dir_path, exist_ok=True)
    return dir_path


@router.post(
    "/projects/{project_id}/papers/upload",
    response_model=PaperDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_paper(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> Paper:
    """
    Upload and extract PDF paper:
    1. Validates declared and streamed size before buffering (never loads full body in memory).
    2. Saves PDF file securely via bounded chunked streaming.
    3. Runs GROBID / local pdfplumber extraction pipeline.
    4. Computes extraction confidence and status.
    5. Saves Paper record and extracted metadata.
    """

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * BYTES_PER_MB
    declared_length = request.headers.get("content-length")
    if declared_length and declared_length.isdigit() and int(declared_length) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum limit of {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    safe_filename = PDFValidator.sanitize_filename(file.filename or "paper.pdf")
    unique_filename = f"{uuid.uuid4()}_{safe_filename}"
    proj_dir = await anyio.to_thread.run_sync(get_upload_dir, project_id)
    file_path = os.path.join(proj_dir, unique_filename)

    async def _stream_to_disk() -> None:
        written = 0
        header_checked = False
        try:
            async with await anyio.open_file(file_path, "wb") as out:
                while True:
                    chunk = await file.read(UPLOAD_CHUNK_SIZE_BYTES)
                    if not chunk:
                        break
                    if not header_checked:
                        try:
                            PDFValidator.validate_pdf_header(chunk)
                        except PDFExtractionError as pe:
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST, detail=str(pe)
                            ) from pe
                        header_checked = True
                    written += len(chunk)
                    if written > max_bytes:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"File size exceeds maximum limit of {settings.MAX_UPLOAD_SIZE_MB} MB.",
                        )
                    await out.write(chunk)
            if written == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty."
                )
        except Exception:
            try:
                os.remove(file_path)
            except OSError:
                logger.warning("Could not remove partial upload %s", file_path)
            raise

    await _stream_to_disk()

    try:
        await anyio.to_thread.run_sync(
            lambda: PDFValidator.validate_pdf_file(file_path, max_mb=settings.MAX_UPLOAD_SIZE_MB)
        )
    except PDFExtractionError as pe:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(pe)) from pe

    # Run extraction pipeline (§11a)
    try:
        extraction = await pdf_extractor.extract_pdf(file_path, filename=file.filename or "")
    except Exception:
        logger.exception(
            "PDF extraction failed entirely for %s; storing as unverified", safe_filename
        )
        # Honest minimal record: filename-derived title only, no fabricated metadata
        extraction = {
            "title": os.path.splitext(safe_filename)[0].replace("_", " ").title(),
            "authors": [],
            "abstract": None,
            "doi": None,
            "arxiv_id": None,
            "pmid": None,
            "year": None,
            "page_count": 0,
            "extraction_status": "unverified",
            "confidence_score": None,
            "sections": [],
            "tables": [],
            "equations": [],
            "references": [],
            "pages": [],
        }

    def _save_and_chunk():
        # Store paper in database
        paper = Paper(
            project_id=project_id,
            title=extraction.get("title") or "Untitled Paper",
            authors=extraction.get("authors"),
            abstract=extraction.get("abstract"),
            doi=extraction.get("doi"),
            arxiv_id=extraction.get("arxiv_id"),
            pmid=extraction.get("pmid"),
            year=extraction.get("year"),
            pdf_path=file_path,
            metadata_json=extraction,
            extraction_status=extraction.get("extraction_status", "ok"),
        )
        db.add(paper)
        db.commit()
        db.refresh(paper)

        # RAG Pipeline: Chunk and index embeddings immediately (§32, §41)
        try:
            rag_service.chunk_paper(db, paper)
        except Exception:
            logger.exception(
                "RAG indexing failed for paper %s; paper saved without searchable chunks", paper.id
            )

        return paper

    return await anyio.to_thread.run_sync(_save_and_chunk)


@router.post("/papers/{paper_id}/index")
def index_paper(
    paper_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Generate or refresh RAG chunks and semantic embeddings for a paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(
        db, current_user.id, paper.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to index this paper",
        )

    chunks = rag_service.chunk_paper(db, paper)
    return {"paper_id": paper.id, "indexed_chunks": len(chunks), "status": "ready"}


@router.get("/projects/{project_id}/papers", response_model=list[PaperResponse])
def list_papers(
    project_id: str,
    q: str | None = Query(None, description="Keyword search query"),
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=500, description="Pagination limit"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Paper]:
    """List all research papers in project with optional keyword search."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not verify_user_access_to_owner(db, current_user.id, project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view papers in this project",
        )

    query = db.query(Paper).filter(Paper.project_id == project_id)

    if q and q.strip():
        search_term = f"%{q.strip().lower()}%"
        # Search title, abstract, doi, arxiv_id
        query = query.filter(
            (Paper.title.ilike(search_term))
            | (Paper.abstract.ilike(search_term))
            | (Paper.doi.ilike(search_term))
            | (Paper.arxiv_id.ilike(search_term))
        )

    return query.order_by(Paper.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/papers/{paper_id}", response_model=PaperDetailResponse)
def get_paper(
    paper_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Paper:
    """Retrieve full details of a paper including structured sections, tables, and equations."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(db, current_user.id, paper.project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this paper",
        )

    return paper


@router.get("/papers/{paper_id}/status", response_model=PaperStatusResponse)
def get_paper_status(
    paper_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaperStatusResponse:
    """Get extraction and pipeline status for stepped indicator (UI/UX §6.1)."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(db, current_user.id, paper.project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this paper",
        )

    # Determine step based on extraction status and OCR
    meta = paper.metadata_json or {}
    ocr_triggered = meta.get("ocr_triggered", False)
    pre_ocr_chars = meta.get("pre_ocr_chars_per_page")

    step: Literal["upload", "extracting", "ocr", "embeddings", "ready"]
    if ocr_triggered:
        step = "ocr"
        step_index = 3  # upload=1, extracting=2, ocr=3, embeddings=4, ready=5
        message = "OCR processing in progress..."
        # Estimate OCR progress based on pre-ocr chars and current status
        # This is a rough estimate since extraction runs synchronously
        ocr_progress = {
            "current_page": meta.get("page_count", 0),
            "total_pages": meta.get("page_count", 0),
        } if pre_ocr_chars is not None else None
    else:
        step = "ready"
        step_index = 4
        message = "Extraction verified" if paper.extraction_status == "ok" else "Extraction unverified (low confidence)"
        ocr_progress = None

    return PaperStatusResponse(
        paper_id=paper.id,
        step=step,
        step_index=step_index,
        extraction_status=paper.extraction_status,
        chunks_count=db.query(PaperChunk).filter(PaperChunk.paper_id == paper.id).count(),
        message=message,
        ocr_progress=ocr_progress,
    )


@router.get("/papers/{paper_id}/pdf")
def stream_paper_pdf(
    paper_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Stream PDF file content for reader view."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(db, current_user.id, paper.project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this paper",
        )

    if not paper.pdf_path or not os.path.exists(paper.pdf_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="PDF file not found on disk"
        )

    return FileResponse(
        path=paper.pdf_path, media_type="application/pdf", filename=f"{paper.title}.pdf"
    )


@router.delete("/papers/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_paper(
    paper_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete paper and its PDF file from storage."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(
        db, current_user.id, paper.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this paper",
        )

    pdf_path = paper.pdf_path
    db.delete(paper)
    db.commit()

    if pdf_path and os.path.exists(pdf_path):
        try:
            os.remove(pdf_path)
        except OSError:
            logger.exception("Failed to delete PDF file %s for paper %s", pdf_path, paper.id)
    return


# --- Annotations, Highlights, and Notes ---


@router.get("/papers/{paper_id}/annotations", response_model=list[AnnotationResponse])
def get_paper_annotations(
    paper_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PaperAnnotation]:
    """Get all annotations, highlights, and notes for a paper."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(db, current_user.id, paper.project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view annotations",
        )

    return (
        db.query(PaperAnnotation)
        .filter(PaperAnnotation.paper_id == paper_id)
        .order_by(PaperAnnotation.page_number.asc(), PaperAnnotation.created_at.asc())
        .all()
    )


@router.post(
    "/papers/{paper_id}/annotations",
    response_model=AnnotationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_annotation(
    paper_id: str,
    data: AnnotationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaperAnnotation:
    """Create a new highlight, note, or anchored annotation."""
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(
        db, current_user.id, paper.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to add annotations",
        )

    annotation = PaperAnnotation(
        paper_id=paper_id,
        user_id=current_user.id,
        page_number=data.page_number,
        selected_text=data.selected_text,
        highlight_color=data.highlight_color or "yellow",
        note_text=data.note_text,
        position_data=data.position_data,
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return annotation


@router.patch("/papers/{paper_id}/annotations/{annotation_id}", response_model=AnnotationResponse)
def update_annotation(
    paper_id: str,
    annotation_id: str,
    data: AnnotationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaperAnnotation:
    """Update note, highlight color, or AI thread on an annotation."""
    annotation = (
        db.query(PaperAnnotation)
        .filter(PaperAnnotation.id == annotation_id, PaperAnnotation.paper_id == paper_id)
        .first()
    )
    if not annotation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")

    if not verify_user_access_to_owner(
        db, current_user.id, annotation.paper.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to edit this annotation",
        )

    if data.highlight_color is not None:
        annotation.highlight_color = data.highlight_color
    if data.note_text is not None:
        annotation.note_text = data.note_text
    if data.ai_thread is not None:
        annotation.ai_thread = data.ai_thread

    db.commit()
    db.refresh(annotation)
    return annotation


@router.delete(
    "/papers/{paper_id}/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_annotation(
    paper_id: str,
    annotation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete an annotation/highlight."""
    annotation = (
        db.query(PaperAnnotation)
        .filter(PaperAnnotation.id == annotation_id, PaperAnnotation.paper_id == paper_id)
        .first()
    )
    if not annotation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")

    if not verify_user_access_to_owner(
        db, current_user.id, annotation.paper.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this annotation",
        )

    db.delete(annotation)
    db.commit()
    return


# --- Selection-Anchored AI Assistance (UI/UX §4.6) ---


@router.post("/papers/{paper_id}/ask", response_model=AskPaperAIResponse)
def ask_paper_ai(
    paper_id: str,
    data: AskPaperAIRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AskPaperAIResponse:
    """
    Selection-anchored inline AI assistance (UI/UX §4.6):
    Answers questions about the highlighted passage using RAG retrieval over this
    paper's indexed chunks plus the configured LLM provider. Returns honest
    refusals when no provider is configured or no grounded evidence exists.
    """
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    if not verify_user_access_to_owner(db, current_user.id, paper.project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to query this paper",
        )

    selected = (data.selected_text or "").strip()
    question = (data.question or "").strip()
    prompt_type = data.prompt_type or "explain"

    query = question or selected
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Provide a question or selected text"
        )

    chunks_count = db.query(PaperChunk).filter(PaperChunk.paper_id == paper.id).count()

    if prompt_type == "custom" and not chunks_count:
        return AskPaperAIResponse(
            answer=(
                "This paper has no indexed content to query yet. Re-index it "
                "(POST /papers/{id}/index) after uploading a PDF with extractable text."
            ),
            prompt_type=prompt_type,
            grounded=False,
            sources=[],
            insufficient_evidence=True,
            source_passage=selected or None,
            page_number=data.page_number,
        )

    passages: list[GroundedPassage] = []
    if chunks_count:
        passages = rag_service.hybrid_search(
            db=db,
            project_id=paper.project_id,
            query=query,
            mode="document",
            paper_id=paper.id,
            limit=6,
        )

    if not passages:
        return AskPaperAIResponse(
            answer="Insufficient evidence found in your sources.",
            prompt_type=prompt_type,
            grounded=False,
            sources=[],
            insufficient_evidence=True,
            source_passage=selected or None,
            page_number=data.page_number,
        )

    instruction = {
        "explain": "Explain the highlighted passage in its research context.",
        "summarize": "Summarize the key takeaway of the highlighted passage.",
        "findings": "State the empirical findings that relate to the highlighted passage.",
    }.get(prompt_type)

    user_prompt = f"{instruction}\n\nHighlighted passage: {selected}\n" if selected else ""
    if question:
        user_prompt += f"\nQuestion: {question}"

    llm_answer = rag_service.grounded_answer(user_prompt or query, "document", passages)
    if llm_answer is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "No AI provider available. Configure a provider under Settings > AI Providers "
                "or start a local Ollama server."
            ),
        )

    if "Insufficient evidence found in your sources." in llm_answer:
        return AskPaperAIResponse(
            answer=llm_answer,
            prompt_type=prompt_type,
            grounded=False,
            sources=[],
            insufficient_evidence=True,
            source_passage=selected or None,
            page_number=data.page_number,
        )

    sources = [
        f"{p.paper_title} — p.{p.page_number} ({p.section})"
        if p.section
        else f"{p.paper_title} — p.{p.page_number}"
        for p in passages[:3]
    ]

    return AskPaperAIResponse(
        answer=llm_answer,
        prompt_type=prompt_type,
        grounded=True,
        sources=sources,
        insufficient_evidence=False,
        source_passage=selected or None,
        page_number=data.page_number,
    )
