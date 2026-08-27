import json
import logging
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    ChatRequest,
    ChatResponse,
    RAGSearchRequest,
    RAGSearchResponse,
)
from app.services.auth import get_current_user, verify_user_access_to_owner
from app.services.rag_service import rag_service

router = APIRouter()
logger = logging.getLogger("openresearch.chat")


def _resolve_mode(raw_mode: str) -> str:
    mode = raw_mode.lower() if raw_mode else "project"
    return mode if mode in ["document", "library", "project", "general"] else "project"


@router.post("/projects/{project_id}/chat", response_model=ChatResponse)
def project_chat(
    project_id: str,
    data: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    """
    AI Research Chat (Roadmap Phase 4):
    Supports 4 persistent modes:
    - 'document': Grounded in active paper_id
    - 'library': Grounded in selected paper_ids
    - 'project': Grounded in all project research papers
    - 'general': Ungrounded general AI assistance with persistent warning

    Implements Rules 1–5 (§33) and Multi-Source Clause Attribution (§26a).
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not verify_user_access_to_owner(db, current_user.id, project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access research chat for this project",
        )

    mode = _resolve_mode(data.mode)

    return rag_service.generate_chat_response(
        db=db,
        project_id=project_id,
        message=data.message,
        mode=mode,
        paper_id=data.paper_id,
        paper_ids=data.paper_ids,
        conversation_history=data.conversation_history,
    )


@router.post("/projects/{project_id}/chat/stream")
def project_chat_stream(
    project_id: str,
    data: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """
    SSE streaming variant of the AI Research Chat.

    Frame sequence (each as a `data:` line containing JSON):
      {"type": "meta", ...}     → mode/grounding/sources/trust legend (sent first)
      {"type": "thinking", text}   — model reasoning deltas
      {"type": "content", text}    — answer deltas
      {"type": "done", ...}     → final insufficient-evidence flags
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not verify_user_access_to_owner(db, current_user.id, project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access research chat for this project",
        )

    mode = _resolve_mode(data.mode)

    def event_stream() -> Iterator[str]:
        try:
            for frame in rag_service.stream_chat_response(
                db=db,
                project_id=project_id,
                message=data.message,
                mode=mode,
                paper_id=data.paper_id,
                paper_ids=data.paper_ids,
                conversation_history=data.conversation_history,
            ):
                yield f"data: {json.dumps(frame)}\n\n"
        except Exception:
            logger.exception("chat stream failed for project %s", project_id)
            yield f"data: {json.dumps({'type': 'error', 'code': 'stream_failed'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/projects/{project_id}/rag/search", response_model=RAGSearchResponse)
def rag_search(
    project_id: str,
    data: RAGSearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RAGSearchResponse:
    """
    Hybrid retrieval search over paper chunks (BM25 keyword + vector semantic cosine similarity).
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not verify_user_access_to_owner(db, current_user.id, project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to search papers in this project",
        )

    mode = "document" if data.paper_id else ("library" if data.paper_ids else "project")

    passages = rag_service.hybrid_search(
        db=db,
        project_id=project_id,
        query=data.query,
        mode=mode,
        paper_id=data.paper_id,
        paper_ids=data.paper_ids,
        limit=data.limit or 5,
        min_threshold=data.threshold or 0.18,
    )

    return RAGSearchResponse(query=data.query, total_results=len(passages), passages=passages)
