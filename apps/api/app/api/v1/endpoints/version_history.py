import difflib

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.document import Document
from app.models.project import Project
from app.models.user import User
from app.models.version import DocumentVersion
from app.schemas.models import (
    VersionCreate,
    VersionDiffItem,
    VersionDiffResponse,
    VersionResponse,
)
from app.services.auth import get_current_user, verify_user_access_to_owner

router = APIRouter()

_MAX_VERSION_NUMBER_RETRIES = 3


def _allocate_version_number(db: Session, document_id: str) -> int:
    highest = (
        db.query(DocumentVersion.version_number)
        .filter(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
        .first()
    )
    return (highest[0] + 1) if highest else 1


def _commit_version(db: Session, checkpoint: DocumentVersion) -> None:
    """
    Insert a version snapshot, retrying on unique-constraint collisions caused by
    concurrent writers (the (document_id, version_number) pair is unique).
    """
    for attempt in range(_MAX_VERSION_NUMBER_RETRIES):
        try:
            db.commit()
            return
        except IntegrityError:
            db.rollback()
            if attempt == _MAX_VERSION_NUMBER_RETRIES - 1:
                raise
            checkpoint.version_number = _allocate_version_number(db, checkpoint.document_id)


def _check_doc_access(
    db: Session, user: User, document_id: str, required_roles: list[str] | None = None
) -> Document:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    project = db.query(Project).filter(Project.id == doc.project_id).first()
    if not project or not verify_user_access_to_owner(
        db, user.id, project.owner_id, required_roles=required_roles
    ):
        raise HTTPException(status_code=403, detail="You do not have access to this document")
    return doc


@router.get("/documents/{document_id}/versions", response_model=list[VersionResponse])
def list_document_versions(
    document_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DocumentVersion]:
    """
    Lists the revision history timeline for a document.
    """
    _check_doc_access(db, current_user, document_id)

    return (
        db.query(DocumentVersion)
        .filter(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.desc())
        .all()
    )


@router.post(
    "/documents/{document_id}/versions",
    response_model=VersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_document_version(
    document_id: str,
    version_in: VersionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentVersion:
    """
    Creates a named snapshot / milestone version of the current document state.
    """
    doc = _check_doc_access(db, current_user, document_id, required_roles=["owner", "editor"])

    next_version = _allocate_version_number(db, document_id)

    content_json = (
        version_in.content_json if version_in.content_json is not None else doc.content_json
    )
    plain_text = version_in.plain_text if version_in.plain_text is not None else doc.plain_text
    title = version_in.title or doc.title

    version_obj = DocumentVersion(
        document_id=document_id,
        version_number=next_version,
        user_id=current_user.id,
        author_name=current_user.name or current_user.email,
        title=title,
        content_json=content_json,
        plain_text=plain_text,
        change_summary=version_in.change_summary or f"Version {next_version} snapshot",
    )
    db.add(version_obj)
    _commit_version(db, version_obj)
    db.refresh(version_obj)
    return version_obj


@router.get("/documents/{document_id}/versions/{version_id}", response_model=VersionResponse)
def get_document_version(
    document_id: str,
    version_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentVersion:
    _check_doc_access(db, current_user, document_id)

    version = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.id == version_id, DocumentVersion.document_id == document_id)
        .first()
    )
    if not version:
        raise HTTPException(status_code=404, detail="Document version not found")
    return version


@router.post(
    "/documents/{document_id}/versions/{version_id}/restore",
    response_model=VersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def restore_document_version(
    document_id: str,
    version_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentVersion:
    """
    Restores the live document content to a prior snapshot while saving a new version checkpoint.
    """
    doc = _check_doc_access(db, current_user, document_id, required_roles=["owner", "editor"])

    target_version = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.id == version_id, DocumentVersion.document_id == document_id)
        .first()
    )
    if not target_version:
        raise HTTPException(status_code=404, detail="Target version not found")

    # Update current document state and create checkpoint atomically
    for attempt in range(_MAX_VERSION_NUMBER_RETRIES):
        try:
            doc.title = target_version.title
            doc.content_json = target_version.content_json
            doc.plain_text = target_version.plain_text
            doc.version = doc.version + 1

            next_ver = _allocate_version_number(db, document_id)
            restore_checkpoint = DocumentVersion(
                document_id=document_id,
                version_number=next_ver,
                user_id=current_user.id,
                author_name=current_user.name or current_user.email,
                title=doc.title,
                content_json=doc.content_json,
                plain_text=doc.plain_text,
                change_summary=f"Restored from Version {target_version.version_number}",
            )
            db.add(restore_checkpoint)
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == _MAX_VERSION_NUMBER_RETRIES - 1:
                raise

    db.refresh(doc)
    db.refresh(restore_checkpoint)
    return restore_checkpoint


@router.get(
    "/documents/{document_id}/versions/{v1_id}/diff/{v2_id}", response_model=VersionDiffResponse
)
def compute_version_diff(
    document_id: str,
    v1_id: str,
    v2_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VersionDiffResponse:
    """
    Computes a granular, line-by-line diff between two document revisions.
    """
    _check_doc_access(db, current_user, document_id)

    v1 = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.id == v1_id, DocumentVersion.document_id == document_id)
        .first()
    )
    v2 = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.id == v2_id, DocumentVersion.document_id == document_id)
        .first()
    )

    if not v1 or not v2:
        raise HTTPException(status_code=404, detail="One or both versions not found")

    text1_lines = (v1.plain_text or "").splitlines(keepends=True)
    text2_lines = (v2.plain_text or "").splitlines(keepends=True)

    matcher = difflib.SequenceMatcher(None, text1_lines, text2_lines)
    diff_items: list[VersionDiffItem] = []
    insertions = 0
    deletions = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            diff_items.append(
                VersionDiffItem(change_type="equal", text="".join(text1_lines[i1:i2]))
            )
        elif tag == "insert":
            text_inserted = "".join(text2_lines[j1:j2])
            diff_items.append(VersionDiffItem(change_type="insert", text=text_inserted))
            insertions += len(text2_lines[j1:j2])
        elif tag == "delete":
            text_deleted = "".join(text1_lines[i1:i2])
            diff_items.append(VersionDiffItem(change_type="delete", text=text_deleted))
            deletions += len(text1_lines[i1:i2])
        elif tag == "replace":
            text_deleted = "".join(text1_lines[i1:i2])
            text_inserted = "".join(text2_lines[j1:j2])
            diff_items.append(VersionDiffItem(change_type="delete", text=text_deleted))
            diff_items.append(VersionDiffItem(change_type="insert", text=text_inserted))
            deletions += len(text1_lines[i1:i2])
            insertions += len(text2_lines[j1:j2])

    summary = f"+{insertions} lines added, -{deletions} lines removed"

    return VersionDiffResponse(
        v1_id=v1.id,
        v2_id=v2.id,
        v1_version=v1.version_number,
        v2_version=v2.version_number,
        diff_summary=summary,
        diff_items=diff_items,
    )
