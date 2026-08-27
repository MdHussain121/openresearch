"""add users.is_admin

Revision ID: 180baac94a46
Revises: ec9eb70fcc96
Create Date: 2026-08-25 21:16:46.999711

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "180baac94a46"
down_revision: Union[str, Sequence[str], None] = "ec9eb70fcc96"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: is_admin is included in the baseline migration (ec9eb70fcc96)."""
    pass


def downgrade() -> None:
    """No-op: is_admin is included in the baseline migration."""
    pass
