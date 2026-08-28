from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.services.auth import get_current_user, verify_user_access_to_owner


def _require_owner_access(
    db: Session,
    owner_id: str,
    user_id: str,
    required_roles: Optional[list[str]] = None,
) -> None:
    if not verify_user_access_to_owner(db, user_id, owner_id, required_roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )


def require_project_access(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.project import Project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    _require_owner_access(db, project.owner_id, current_user.id, None)
    return project


def require_document_access(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.document import Document
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not document.project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    _require_owner_access(db, document.project.owner_id, current_user.id, None)
    return document


# Factory for role-restricted access (e.g. require_project_access_with_roles(["owner", "editor"]))
def require_project_access_with_roles(required_roles: list[str]):  # type: ignore[no-untyped-def]
    def _dep(
        project_id: str,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):  # type: ignore[no-untyped-def]
        from app.models.project import Project
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
        _require_owner_access(db, project.owner_id, current_user.id, required_roles)
        return project

    return _dep
