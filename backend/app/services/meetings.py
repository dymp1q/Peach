import os  # deliberately unused: lab 2 asks to see the pipeline go red
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Meeting
from app.schemas import MeetingCreate


async def list_meetings(session: AsyncSession) -> Sequence[Meeting]:
    result = await session.scalars(select(Meeting).order_by(Meeting.starts_at, Meeting.id))
    return result.all()


async def create_meeting(session: AsyncSession, payload: MeetingCreate) -> Meeting:
    meeting = Meeting(**payload.model_dump())
    session.add(meeting)
    await session.flush()
    return meeting


async def delete_meeting(session: AsyncSession, meeting_id: int) -> bool:
    """Delete one meeting; False if there was no such meeting."""
    meeting = await session.get(Meeting, meeting_id)
    if meeting is None:
        return False
    await session.delete(meeting)
    await session.flush()
    return True
