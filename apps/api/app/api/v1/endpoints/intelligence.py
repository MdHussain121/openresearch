from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.dependencies.auth import require_project_access
from app.core.database import get_db
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    ClaimVerificationRequest,
    ClaimVerificationResponse,
    LitMatrixRequest,
    LitMatrixResponse,
    PaperReviewRequest,
    PaperReviewResponse,
    ResearchGapRequest,
    ResearchGapResponse,
)
from app.services.auth import get_current_user
from app.services.intelligence_service import intelligence_service

router = APIRouter()


@router.post(
    "/projects/{project_id}/intelligence/verify-claims", response_model=ClaimVerificationResponse
)
def verify_claims_endpoint(
    project_id: str,
    request: ClaimVerificationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> ClaimVerificationResponse:
    """
    8.1 Claim Verification (Roadmap 8.1):
    Mechanically flags sentences with zero supporting citations.
    Support strength / confidence scoring is explicitly deferred.
    """
    return intelligence_service.verify_claims(db=db, project_id=project_id, request=request)


@router.post(
    "/projects/{project_id}/intelligence/research-gaps", response_model=ResearchGapResponse
)
def research_gaps_endpoint(
    project_id: str,
    request: ResearchGapRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> ResearchGapResponse:
    """
    8.2 Research Gap Assistant (Roadmap 8.2):
    Surfaces author-stated limitations, future work, and raw evidence without confidence scoring.
    """
    return intelligence_service.analyze_research_gaps(db=db, project_id=project_id, request=request)


@router.post(
    "/projects/{project_id}/intelligence/literature-matrix", response_model=LitMatrixResponse
)
def literature_matrix_endpoint(
    project_id: str,
    request: LitMatrixRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> LitMatrixResponse:
    """
    8.3 Literature Review Matrix (Roadmap 8.3):
    Generates structured comparison matrix (Method/Dataset/Results/Limitations) with cell source references.
    """
    return intelligence_service.generate_literature_matrix(
        db=db, project_id=project_id, request=request
    )


@router.post("/projects/{project_id}/intelligence/paper-review", response_model=PaperReviewResponse)
def paper_review_endpoint(
    project_id: str,
    request: PaperReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> PaperReviewResponse:
    """
    8.4 Research Paper Review Engine (Roadmap 8.4):
    Analyzes document across Structure, Citations, Writing, Argumentation, and Sources.
    """
    return intelligence_service.review_paper(db=db, project_id=project_id, request=request)
