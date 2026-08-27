"""baseline: create all application tables

Revision ID: ec9eb70fcc96
Revises:
Create Date: 2026-08-25 10:38:32.788625

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "ec9eb70fcc96"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all application tables from scratch."""

    op.create_table(
        "owners",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_type", sa.String(20), nullable=False, server_default="user"),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "personal_owner_id",
            sa.String(36),
            sa.ForeignKey("owners.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "memberships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(36),
            sa.ForeignKey("owners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", sa.String(20), nullable=False, server_default="owner"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "user_id", name="uq_owner_user_membership"),
    )
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])

    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_id",
            sa.String(36),
            sa.ForeignKey("owners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])

    op.create_table(
        "documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(255), nullable=False, server_default="Untitled Paper"),
        sa.Column("content_json", sa.JSON(), nullable=True),
        sa.Column("plain_text", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_documents_project_id", "documents", ["project_id"])

    op.create_table(
        "papers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("authors", sa.JSON(), nullable=True),
        sa.Column("abstract", sa.Text(), nullable=True),
        sa.Column("doi", sa.String(255), nullable=True),
        sa.Column("arxiv_id", sa.String(255), nullable=True),
        sa.Column("pmid", sa.String(255), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("pdf_path", sa.String(1000), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("extraction_status", sa.String(50), nullable=False, server_default="ok"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_papers_project_id", "papers", ["project_id"])
    op.create_index("ix_papers_doi", "papers", ["doi"])
    op.create_index("ix_papers_arxiv_id", "papers", ["arxiv_id"])
    op.create_index("ix_papers_pmid", "papers", ["pmid"])

    op.create_table(
        "citations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "paper_id",
            sa.String(36),
            sa.ForeignKey("papers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("citation_style", sa.String(50), nullable=False, server_default="apa"),
        sa.Column("attribution_scope", sa.String(20), nullable=False, server_default="sentence"),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("relevant_passage", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_citations_document_id", "citations", ["document_id"])
    op.create_index("ix_citations_paper_id", "citations", ["paper_id"])

    op.create_table(
        "paper_annotations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "paper_id",
            sa.String(36),
            sa.ForeignKey("papers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("selected_text", sa.Text(), nullable=False),
        sa.Column("highlight_color", sa.String(50), nullable=False, server_default="yellow"),
        sa.Column("note_text", sa.Text(), nullable=True),
        sa.Column("ai_thread", sa.JSON(), nullable=True),
        sa.Column("position_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_paper_annotations_paper_id", "paper_annotations", ["paper_id"])
    op.create_index("ix_paper_annotations_user_id", "paper_annotations", ["user_id"])

    op.create_table(
        "paper_chunks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "paper_id",
            sa.String(36),
            sa.ForeignKey("papers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("section", sa.String(255), nullable=False, server_default="General"),
        sa.Column("paragraph", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_paper_chunks_paper_id", "paper_chunks", ["paper_id"])
    op.create_index("ix_paper_chunks_project_id", "paper_chunks", ["project_id"])

    op.create_table(
        "document_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=False),
        sa.Column(
            "parent_id",
            sa.String(36),
            sa.ForeignKey("document_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("selected_text", sa.Text(), nullable=True),
        sa.Column("from_pos", sa.Integer(), nullable=True),
        sa.Column("to_pos", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_document_comments_document_id", "document_comments", ["document_id"])
    op.create_index("ix_document_comments_parent_id", "document_comments", ["parent_id"])
    op.create_index("ix_document_comments_user_id", "document_comments", ["user_id"])

    op.create_table(
        "document_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("author_name", sa.String(255), nullable=False, server_default="Collaborator"),
        sa.Column("title", sa.String(255), nullable=False, server_default="Untitled Paper"),
        sa.Column("content_json", sa.JSON(), nullable=True),
        sa.Column("plain_text", sa.Text(), nullable=True),
        sa.Column("change_summary", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "document_id", "version_number", name="uq_document_versions_document_version"
        ),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])
    op.create_index("ix_document_versions_user_id", "document_versions", ["user_id"])

    op.create_table(
        "plugin_configs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("plugin_id", sa.String(100), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("version", sa.String(50), nullable=False, server_default="1.0.0"),
        sa.Column("plugin_type", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("license", sa.String(50), nullable=False, server_default="MIT"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column("entrypoints", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    """Drop all application tables in reverse dependency order."""
    op.drop_table("plugin_configs")
    op.drop_table("document_versions")
    op.drop_table("document_comments")
    op.drop_table("paper_chunks")
    op.drop_table("paper_annotations")
    op.drop_table("citations")
    op.drop_table("papers")
    op.drop_table("documents")
    op.drop_table("projects")
    op.drop_table("memberships")
    op.drop_table("users")
    op.drop_table("owners")
