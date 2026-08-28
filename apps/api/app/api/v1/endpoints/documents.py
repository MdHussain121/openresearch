from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.v1.dependencies.auth import require_document_access, require_project_access
from app.core.database import get_db
from app.models.document import Document
from app.models.project import Project
from app.models.user import User
from app.schemas.models import (
    DocumentCreate,
    DocumentListItem,
    DocumentResponse,
    DocumentUpdate,
)
from app.services.auth import get_current_user, verify_user_access_to_owner

router = APIRouter()


@router.post("/documents", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def create_document(
    doc_in: DocumentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Document:
    project = db.query(Project).filter(Project.id == doc_in.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not verify_user_access_to_owner(
        db, current_user.id, project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to create documents in this project",
        )

    document = Document(
        project_id=doc_in.project_id,
        title=doc_in.title,
        content_json=doc_in.content_json,
        plain_text=doc_in.plain_text,
        version=1,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/projects/{project_id}/documents", response_model=list[DocumentListItem])
def list_project_documents(
    project_id: str,
    skip: int = Query(0, ge=0, description="Offset for pagination"),
    limit: int = Query(100, ge=1, le=500, description="Limit for pagination"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _project: Project = Depends(require_project_access),
) -> list[Document]:
    return (
        db.query(Document)
        .filter(Document.project_id == project_id)
        .order_by(Document.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> Document:
    return document


@router.patch("/documents/{document_id}", response_model=DocumentResponse)
def update_document(
    document_id: str,
    doc_in: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> Document:
    # Optimistic locking validation (§3.3)
    if doc_in.version is not None and doc_in.version != document.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Document version conflict. Provided version ({doc_in.version}) does not match current version "
                f"({document.version})."
            ),
        )

    if doc_in.title is not None:
        document.title = doc_in.title
    if doc_in.content_json is not None:
        document.content_json = doc_in.content_json
    if doc_in.plain_text is not None:
        document.plain_text = doc_in.plain_text

    document.version = (document.version or 1) + 1
    document.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(document)
    return document


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> None:
    if not verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Viewers cannot delete documents")
    db.delete(document)
    db.commit()
    return
