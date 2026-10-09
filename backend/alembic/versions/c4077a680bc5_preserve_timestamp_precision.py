"""Preserve microseconds so queries submitted within one second sort correctly."""

from alembic import op
from sqlalchemy.dialects.mysql import DATETIME

revision = "c4077a680bc5"
down_revision = "bda5fd897bc1"
branch_labels = None
depends_on = None

COLUMNS = [
    ("users", "created_at", False),
    ("login_sessions", "expires_at", False),
    ("executions", "created_at", False),
    ("executions", "started_at", True),
    ("executions", "ended_at", True),
    ("statements", "expires_at", True),
]


def upgrade():
    if op.get_bind().dialect.name == "mysql":
        for table, column, nullable in COLUMNS:
            op.alter_column(
                table,
                column,
                existing_type=DATETIME(),
                type_=DATETIME(fsp=6),
                existing_nullable=nullable,
            )


def downgrade():
    if op.get_bind().dialect.name == "mysql":
        for table, column, nullable in COLUMNS:
            op.alter_column(
                table,
                column,
                existing_type=DATETIME(fsp=6),
                type_=DATETIME(),
                existing_nullable=nullable,
            )
