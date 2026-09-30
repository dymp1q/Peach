"""create meetings

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "meetings",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attendee_count", sa.Integer(), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="meetings_ends_after_starts"),
        sa.CheckConstraint("attendee_count >= 1", name="meetings_attendee_count_positive"),
    )
    op.create_index("ix_meetings_starts_at", "meetings", ["starts_at"])


def downgrade() -> None:
    op.drop_index("ix_meetings_starts_at", table_name="meetings")
    op.drop_table("meetings")
