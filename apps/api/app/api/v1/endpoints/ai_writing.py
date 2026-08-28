from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.v1.dependencies.auth import require_project_access
from app.core.database import get_db
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    AIEditRequest,
    AIEditResponse,
    AIOutlineRequest,
    AIOutlineResponse,
    AutocompleteRequest,
    AutocompleteResponse,
)
from app.services.ai_writing_service import (
    AIProviderUnavailableError,
    ai_writing_service,
)
from app.services.auth import get_current_user, verify_user_access_to_owner

router = APIRouter()


def _map_ai_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, AIProviderUnavailableError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/projects/{project_id}/ai/autocomplete", response_model=AutocompleteResponse)
def generate_autocomplete(
    project_id: str,
    data: AutocompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> AutocompleteResponse:
    """
    AI Autocomplete Engine (Roadmap Phase 6.1):
    Supports two tiers:
    - 'ghost': Fast inline completion (target <300ms perceived latency)
    - 'continuation': Paragraph-level continuation triggered via Ctrl+/
    """
    if not verify_user_access_to_owner(db, current_user.id, _project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access AI writing assistance for this project",
        )

    try:
        return ai_writing_service.generate_autocomplete(db=db, project_id=project_id, request=data)
    except (AIProviderUnavailableError, ValueError) as exc:
        raise _map_ai_errors(exc) from exc


@router.post("/projects/{project_id}/ai/stream-autocomplete")
async def stream_autocomplete(
    project_id: str,
    data: AutocompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> StreamingResponse:
    """
    SSE streaming endpoint for AI Autocomplete / continuation (§3.5).
    """
    if not verify_user_access_to_owner(db, current_user.id, _project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access AI writing assistance for this project",
        )

    return StreamingResponse(
        ai_writing_service.stream_autocomplete(db=db, project_id=project_id, request=data),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/projects/{project_id}/ai/edit", response_model=AIEditResponse)
def generate_ai_edit(
    project_id: str,
    data: AIEditRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> AIEditResponse:
    """
    AI Editing Actions Engine (Roadmap Phase 6.2):
    Supports 9 actions:
    - improve clarity, make academic, simplify, shorten, expand, fix grammar, improve flow, translate, explain.
    Reversible accept/reject flow: original text is never destroyed automatically.
    The 'explain' action requires an LLM provider; it has no rule-based fallback.
    """
    if not verify_user_access_to_owner(db, current_user.id, _project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to use AI editing for this project",
        )

    try:
        return ai_writing_service.generate_ai_edit(db=db, project_id=project_id, request=data)
    except (AIProviderUnavailableError, ValueError) as exc:
        raise _map_ai_errors(exc) from exc


@router.post("/projects/{project_id}/ai/outline", response_model=AIOutlineResponse)
def generate_ai_outline(
    project_id: str,
    data: AIOutlineRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> AIOutlineResponse:
    """
    Outline Generator (Roadmap Phase 6.3):
    Template-based 7-section academic outline from topic and research library.
    NOTE: This does NOT call an LLM. Output is a deterministic structural template
    with the topic string interpolated. Honest labeling per audit-11 H-2.
    """
    if not verify_user_access_to_owner(db, current_user.id, _project.owner_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to generate outlines for this project",
        )

    return ai_writing_service.generate_ai_outline(db=db, project_id=project_id, request=data)
