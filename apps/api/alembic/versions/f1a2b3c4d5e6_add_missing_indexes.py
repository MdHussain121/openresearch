"""add missing indexes on hot query paths

Revision ID: f1a2b3c4d5e6
Revises: c4d9f2b8a7e1
Create Date: 2026-08-26 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "c4d9f2b8a7e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES_TO_ADD = [
    ("document_comments", "ix_document_comments_user_id", ["user_id"]),
    ("document_versions", "ix_document_versions_user_id", ["user_id"]),
    ("papers", "ix_papers_pmid", ["pmid"]),
    ("memberships", "ix_memberships_user_id", ["user_id"]),
]


def upgrade() -> None:
    """Add indexes on hot FK/filter columns (H4 findings). Idempotent for fresh installs."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    for table_name, index_name, columns in _INDEXES_TO_ADD:
        existing = {idx["name"] for idx in inspector.get_indexes(table_name)}
        if index_name not in existing:
            op.create_index(index_name, table_name, columns)


def downgrade() -> None:
    """Drop the added indexes."""
    for table_name, index_name, _columns in reversed(_INDEXES_TO_ADD):
        op.drop_index(index_name, table_name=table_name)
