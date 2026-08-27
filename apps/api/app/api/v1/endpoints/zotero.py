from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    ZoteroImportRequest,
    ZoteroImportResponse,
    ZoteroSyncRequest,
    ZoteroSyncResponse,
)
from app.services.auth import get_current_user, verify_user_access_to_owner
from app.services.zotero_service import zotero_service

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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify Zotero references for this project",
        )
    return project


@router.post(
    "/projects/{project_id}/zotero/import",
    response_model=ZoteroImportResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_zotero_endpoint(
    project_id: str,
    request: ZoteroImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ZoteroImportResponse:
    """
    8.5 Zotero Import:
    Imports references into project library from Zotero CSL-JSON or Web API.
    """
    _check_project_access(db, current_user, project_id, required_roles=["owner", "editor"])
    return zotero_service.import_csl_or_api_data(db=db, project_id=project_id, request=request)


@router.post(
    "/projects/{project_id}/zotero/sync",
    response_model=ZoteroSyncResponse,
    status_code=status.HTTP_201_CREATED,
)
def sync_zotero_endpoint(
    project_id: str,
    request: ZoteroSyncRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ZoteroSyncResponse:
    """
    8.5 Zotero Real-Time Sync:
    Syncs items from Zotero API account into project.
    """
    _check_project_access(db, current_user, project_id, required_roles=["owner", "editor"])
    return zotero_service.sync_library(db=db, project_id=project_id, request=request)
