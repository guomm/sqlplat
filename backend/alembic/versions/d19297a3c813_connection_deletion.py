"""Preserve referenced connections after administrative deletion."""

import sqlalchemy as sa
from alembic import op

revision = "d19297a3c813"
down_revision = "b5200e225547"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "connections",
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    with op.batch_alter_table("connections") as batch:
        batch.alter_column("deleted", existing_type=sa.Boolean(), server_default=None)


def downgrade():
    op.drop_column("connections", "deleted")
