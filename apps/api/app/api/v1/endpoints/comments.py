from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.api.v1.dependencies.auth import require_document_access
from app.core.database import get_db
from app.models.comment import DocumentComment
from app.models.document import Document
from app.models.user import User
from app.schemas.models import (
    CommentCreate,
    CommentReplyCreate,
    CommentResponse,
    CommentUpdate,
)
from app.services.auth import get_current_user, verify_user_access_to_owner

router = APIRouter()


def _build_comment_response(c: DocumentComment) -> CommentResponse:
    replies_resp = [_build_comment_response(r) for r in (c.replies or [])]
    return CommentResponse(
        id=c.id,
        document_id=c.document_id,
        user_id=c.user_id,
        author_name=c.author_name,
        parent_id=c.parent_id,
        selected_text=c.selected_text,
        from_pos=c.from_pos,
        to_pos=c.to_pos,
        content=c.content,
        resolved=c.resolved,
        created_at=c.created_at,
        updated_at=c.updated_at,
        replies=replies_resp if replies_resp else None,
    )


@router.get("/documents/{document_id}/comments", response_model=list[CommentResponse])
def list_comments(
    document_id: str,
    include_resolved: bool = True,
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(100, ge=1, le=500, description="Pagination limit"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> list[CommentResponse]:
    """
    Lists top-level inline comments with nested replies for a document.
    """
    query = (
        db.query(DocumentComment)
        .options(joinedload(DocumentComment.replies))
        .filter(DocumentComment.document_id == document_id, DocumentComment.parent_id.is_(None))
    )
    if not include_resolved:
        query = query.filter(DocumentComment.resolved.is_(False))

    comments = query.order_by(DocumentComment.created_at.asc()).offset(skip).limit(limit).all()
    return [_build_comment_response(c) for c in comments]


@router.post(
    "/documents/{document_id}/comments",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_comment(
    document_id: str,
    comment_in: CommentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> CommentResponse:
    """
    Creates an inline comment thread anchored to a selection or document.
    """
    if not verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to add comments to this document",
        )

    if comment_in.parent_id:
        parent = (
            db.query(DocumentComment)
            .filter(
                DocumentComment.id == comment_in.parent_id,
                DocumentComment.document_id == document_id,
            )
            .first()
        )
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Parent comment not found"
            )

    comment = DocumentComment(
        document_id=document_id,
        user_id=current_user.id,
        author_name=current_user.name or current_user.email,
        parent_id=comment_in.parent_id,
        selected_text=comment_in.selected_text,
        from_pos=comment_in.from_pos,
        to_pos=comment_in.to_pos,
        content=comment_in.content,
        resolved=False,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment)


@router.post(
    "/documents/{document_id}/comments/{comment_id}/replies",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_comment_reply(
    document_id: str,
    comment_id: str,
    reply_in: CommentReplyCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> CommentResponse:
    """
    Appends a threaded reply to an existing comment.
    """
    if not verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to reply to comments on this document",
        )

    parent = (
        db.query(DocumentComment)
        .filter(DocumentComment.id == comment_id, DocumentComment.document_id == document_id)
        .first()
    )
    if not parent:
        raise HTTPException(status_code=404, detail="Parent comment not found")

    reply = DocumentComment(
        document_id=document_id,
        user_id=current_user.id,
        author_name=current_user.name or current_user.email,
        parent_id=parent.id,
        content=reply_in.content,
        resolved=False,
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return _build_comment_response(reply)


@router.patch("/documents/{document_id}/comments/{comment_id}", response_model=CommentResponse)
def update_comment(
    document_id: str,
    comment_id: str,
    comment_in: CommentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> CommentResponse:
    """
    Updates comment content or toggles resolution status.
    """
    if not verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to update comments on this document",
        )

    comment = (
        db.query(DocumentComment)
        .filter(DocumentComment.id == comment_id, DocumentComment.document_id == document_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if comment_in.content is not None:
        if comment.user_id != current_user.id:
            raise HTTPException(
                status_code=403, detail="You can only edit your own comment content"
            )
        comment.content = comment_in.content

    if comment_in.resolved is not None:
        comment.resolved = comment_in.resolved

    db.commit()
    db.refresh(comment)
    return _build_comment_response(comment)


@router.delete(
    "/documents/{document_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_comment(
    document_id: str,
    comment_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    document: Document = Depends(require_document_access),
) -> None:
    """
    Deletes a comment and its threaded replies.
    """
    if not verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner", "editor"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete comments on this document",
        )

    comment = (
        db.query(DocumentComment)
        .filter(DocumentComment.id == comment_id, DocumentComment.document_id == document_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Author can delete, or project owner can delete
    is_owner = verify_user_access_to_owner(
        db, current_user.id, document.project.owner_id, required_roles=["owner"]
    )

    if comment.user_id != current_user.id and not is_owner:
        raise HTTPException(
            status_code=403, detail="You do not have permission to delete this comment"
        )

    db.delete(comment)
    db.commit()
    return
