from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agenda, Meeting
from app.schemas import AgendaSave


async def get_agenda(session: AsyncSession, meeting_id: int) -> Agenda | None:
    return await session.get(Agenda, meeting_id)


async def save_agenda(session: AsyncSession, meeting_id: int, payload: AgendaSave) -> Agenda | None:
    """Create or replace the meeting's agenda; None if there is no such meeting."""
    if await session.get(Meeting, meeting_id) is None:
        return None
    values = payload.model_dump(mode="json")
    agenda = await session.get(Agenda, meeting_id)
    if agenda is None:
        agenda = Agenda(meeting_id=meeting_id, **values)
        session.add(agenda)
    else:
        for field, value in values.items():
            setattr(agenda, field, value)
    await session.flush()
    await session.refresh(agenda)
    return agenda
