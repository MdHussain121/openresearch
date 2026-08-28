from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.dependencies.auth import require_project_access
from app.core.database import get_db
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    DiscoveryRecommendation,
    ResearchGraphResponse,
)
from app.services.auth import get_current_user
from app.services.graph_service import ResearchGraphService

router = APIRouter()


@router.get("/projects/{project_id}/research-graph", response_model=ResearchGraphResponse)
def get_project_research_graph(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> ResearchGraphResponse:
    """
    Generates an interactive Citation & Knowledge Graph across project papers, authors, and topics (Roadmap 9.3).
    """
    return ResearchGraphService.build_project_graph(db, project_id)


@router.get("/projects/{project_id}/discover-related", response_model=list[DiscoveryRecommendation])
async def discover_related_papers(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> list[DiscoveryRecommendation]:
    """
    Discovers related academic work via live Crossref queries on the project's dominant topics (Roadmap 9.3).
    Returns [] when the library is empty or the external lookup fails.
    """
    return await ResearchGraphService.discover_related_work(db, project_id)
