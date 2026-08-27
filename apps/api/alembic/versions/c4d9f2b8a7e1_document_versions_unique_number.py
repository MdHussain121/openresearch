"""document_versions: enforce unique (document_id, version_number)

Revision ID: c4d9f2b8a7e1
Revises: a1f2c3d4e5f6
Create Date: 2026-08-25 23:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c4d9f2b8a7e1"
down_revision: Union[str, Sequence[str], None] = "a1f2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: unique constraint is included in the baseline migration (ec9eb70fcc96)."""
    pass


def downgrade() -> None:
    """No-op: unique constraint is included in the baseline migration."""
    pass
