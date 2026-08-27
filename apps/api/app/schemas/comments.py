"""Comment schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CommentCreate(BaseModel):
    selected_text: str | None = None
    from_pos: int | None = None
    to_pos: int | None = None
    content: str
    parent_id: str | None = None


class CommentReplyCreate(BaseModel):
    content: str


class CommentUpdate(BaseModel):
    content: str | None = None
    resolved: bool | None = None


class CommentResponse(BaseModel):
    id: str
    document_id: str
    user_id: str
    author_name: str
    parent_id: str | None = None
    selected_text: str | None = None
    from_pos: int | None = None
    to_pos: int | None = None
    content: str
    resolved: bool
    created_at: datetime
    updated_at: datetime
    replies: list["CommentResponse"] | None = None

    model_config = ConfigDict(from_attributes=True)
