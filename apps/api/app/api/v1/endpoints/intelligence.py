from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

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
from app.services.auth import get_current_user, verify_user_access_to_owner
from app.services.intelligence_service import intelligence_service

router = APIRouter()


def _check_project_access(
    db: Session, user: User, project_id: str, required_roles: list[str] | None = None
) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not verify_user_access_to_owner(
        db, user.id, project.owner_id, required_roles=required_roles
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this project"
        )
    return project


@router.post(
    "/projects/{project_id}/intelligence/verify-claims", response_model=ClaimVerificationResponse
)
def verify_claims_endpoint(
    project_id: str,
    request: ClaimVerificationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClaimVerificationResponse:
    """
    8.1 Claim Verification (Roadmap 8.1):
    Mechanically flags sentences with zero supporting citations.
    Support strength / confidence scoring is explicitly deferred.
    """
    _check_project_access(db, current_user, project_id)
    return intelligence_service.verify_claims(db=db, project_id=project_id, request=request)


@router.post(
    "/projects/{project_id}/intelligence/research-gaps", response_model=ResearchGapResponse
)
def research_gaps_endpoint(
    project_id: str,
    request: ResearchGapRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchGapResponse:
    """
    8.2 Research Gap Assistant (Roadmap 8.2):
    Surfaces author-stated limitations, future work, and raw evidence without confidence scoring.
    """
    _check_project_access(db, current_user, project_id)
    return intelligence_service.analyze_research_gaps(db=db, project_id=project_id, request=request)


@router.post(
    "/projects/{project_id}/intelligence/literature-matrix", response_model=LitMatrixResponse
)
def literature_matrix_endpoint(
    project_id: str,
    request: LitMatrixRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LitMatrixResponse:
    """
    8.3 Literature Review Matrix (Roadmap 8.3):
    Generates structured comparison matrix (Method/Dataset/Results/Limitations) with cell source references.
    """
    _check_project_access(db, current_user, project_id)
    return intelligence_service.generate_literature_matrix(
        db=db, project_id=project_id, request=request
    )


@router.post("/projects/{project_id}/intelligence/paper-review", response_model=PaperReviewResponse)
def paper_review_endpoint(
    project_id: str,
    request: PaperReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaperReviewResponse:
    """
    8.4 Research Paper Review Engine (Roadmap 8.4):
    Analyzes document across Structure, Citations, Writing, Argumentation, and Sources.
    """
    _check_project_access(db, current_user, project_id)
    return intelligence_service.review_paper(db=db, project_id=project_id, request=request)
