from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.document import Document
from app.models.project import Project
from app.models.user import User
from app.services.auth import get_current_user, verify_user_access_to_owner


def require_project_access(
    project_id: str,
    roles: list[str] | None = None,
):
    def _check(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> Project:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
        if not verify_user_access_to_owner(
            db, current_user.id, project.owner_id, required_roles=roles
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this project",
            )
        return project

    return _check


def require_document_access(
    document_id: str,
    roles: list[str] | None = None,
):
    def _check(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> Document:
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        if not verify_user_access_to_owner(
            db, current_user.id, document.project.owner_id, required_roles=roles
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this document",
            )
        return document

    return _check