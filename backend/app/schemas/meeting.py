from datetime import UTC, datetime
from typing import Annotated, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_serializer,
    model_validator,
)


class MeetingCreate(BaseModel):
    """Request body of POST /api/meetings - see PROJECT.md section 4."""

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    # AwareDatetime rejects a datetime without a UTC offset with a 422.
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    attendee_count: Annotated[int, Field(ge=1, le=10_000)]

    @model_validator(mode="after")
    def _ends_after_starts(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class MeetingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    starts_at: datetime
    ends_at: datetime
    attendee_count: int

    @field_serializer("starts_at", "ends_at")
    def _as_utc(self, value: datetime) -> str:
        """Always answer in UTC with a Z suffix, e.g. 2026-10-01T09:00:00Z."""
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
