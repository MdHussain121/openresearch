import anyio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    DiscoveryRecommendation,
    ResearchGraphResponse,
)
from app.services.auth import get_current_user, verify_user_access_to_owner
from app.services.graph_service import ResearchGraphService

router = APIRouter()


def _check_project_access(db: Session, user: User, project_id: str) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not verify_user_access_to_owner(db, user.id, project.owner_id):
        raise HTTPException(status_code=403, detail="You do not have access to this project")
    return project


@router.get("/projects/{project_id}/research-graph", response_model=ResearchGraphResponse)
def get_project_research_graph(
    project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ResearchGraphResponse:
    """
    Generates an interactive Citation & Knowledge Graph across project papers, authors, and topics (Roadmap 9.3).
    """
    _check_project_access(db, current_user, project_id)
    return ResearchGraphService.build_project_graph(db, project_id)


@router.get("/projects/{project_id}/discover-related", response_model=list[DiscoveryRecommendation])
async def discover_related_papers(
    project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DiscoveryRecommendation]:
    """
    Discovers related academic work via live Crossref queries on the project's dominant topics (Roadmap 9.3).
    Returns [] when the library is empty or the external lookup fails.
    """
    await anyio.to_thread.run_sync(_check_project_access, db, current_user, project_id)
    return await ResearchGraphService.discover_related_work(db, project_id)
