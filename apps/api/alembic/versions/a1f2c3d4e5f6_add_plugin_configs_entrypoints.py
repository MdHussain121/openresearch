"""add plugin_configs.entrypoints

Revision ID: a1f2c3d4e5f6
Revises: 180baac94a46
Create Date: 2026-08-25 22:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1f2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "180baac94a46"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: entrypoints is included in the baseline migration (ec9eb70fcc96)."""
    pass


def downgrade() -> None:
    """No-op: entrypoints is included in the baseline migration."""
    pass
