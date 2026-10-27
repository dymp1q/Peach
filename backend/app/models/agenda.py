from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Agenda(Base):
    """One meeting's agenda: what the user saved, and what the model suggested (lab 6)."""

    __tablename__ = "agendas"

    meeting_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meetings.id", ondelete="CASCADE"), primary_key=True
    )
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    action_items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    # The parser's answer as it came, before the user touched it. The difference
    # between it and items/action_items is the quality signal: every correction
    # is feedback. Empty when the agenda was typed by hand.
    ai_suggestion: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    ai_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ai_prompt_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
