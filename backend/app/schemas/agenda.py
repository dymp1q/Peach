from datetime import UTC, date, datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_serializer

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class AgendaItem(BaseModel):
    topic: Text
    owner: Name | None = None  # a name or an email, exactly as written
    minutes: Annotated[int, Field(ge=1, le=480)] | None = None


class ActionItem(BaseModel):
    task: Text
    owner: Name | None = None
    due: date | None = None


class AgendaSave(BaseModel):
    """Request body of POST /api/meetings/{id}/agenda - see PROJECT.md section 4.

    The ai_* fields are filled when the form started from the parser's
    suggestion: the API stores them next to what the user saved."""

    items: Annotated[list[AgendaItem], Field(min_length=1, max_length=50)]
    action_items: Annotated[list[ActionItem], Field(max_length=50)] = []
    ai_suggestion: dict[str, Any] | None = None
    ai_model: Annotated[str, StringConstraints(max_length=100)] | None = None
    ai_prompt_version: Annotated[str, StringConstraints(max_length=50)] | None = None


class AgendaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_id: int
    items: list[AgendaItem]
    action_items: list[ActionItem]
    ai_suggestion: dict[str, Any] | None
    ai_model: str | None
    ai_prompt_version: str | None
    saved_at: datetime

    @field_serializer("saved_at")
    def _as_utc(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
