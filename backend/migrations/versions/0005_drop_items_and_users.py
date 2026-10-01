"""drop the course template's items and users tables

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-01

Spry's first slice has no sign-in and no task board, so the template's items
(and the users that owned them) go. The earlier revisions stay: databases that
already ran them need this one to move on.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("items")
    op.drop_table("users")


def downgrade() -> None:
    uuid_pk = {"server_default": sa.text("gen_random_uuid()"), "nullable": False}
    stamps = [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), **uuid_pk),
        sa.Column("cognito_sub", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=True),
        *stamps,
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cognito_sub", name="uq_users_cognito_sub"),
    )
    op.create_table(
        "items",
        sa.Column("id", postgresql.UUID(as_uuid=True), **uuid_pk),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="todo", nullable=False),
        *[c.copy() for c in stamps],
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_items_owner_id_users", ondelete="CASCADE"
        ),
        sa.CheckConstraint("status IN ('todo', 'in_progress', 'done')", name="ck_items_status"),
    )
    op.create_index("ix_items_created_at", "items", ["created_at"])
    op.create_index("ix_items_owner_id", "items", ["owner_id"])
