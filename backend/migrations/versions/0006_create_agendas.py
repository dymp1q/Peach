"""create agendas

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27

One agenda per meeting (lab 6): the items and action items the user saved,
plus what the LLM parser suggested, the model and the prompt version.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agendas",
        sa.Column(
            "meeting_id",
            sa.Integer(),
            sa.ForeignKey("meetings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("items", postgresql.JSONB(), nullable=False),
        sa.Column("action_items", postgresql.JSONB(), nullable=False),
        sa.Column("ai_suggestion", postgresql.JSONB(), nullable=True),
        sa.Column("ai_model", sa.String(length=100), nullable=True),
        sa.Column("ai_prompt_version", sa.String(length=50), nullable=True),
        sa.Column(
            "saved_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("agendas")
