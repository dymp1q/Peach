from fastapi import APIRouter, HTTPException, Response, status

from app.db import SessionDep
from app.schemas import AgendaRead, AgendaSave, MeetingCreate, MeetingRead
from app.services import agendas as agendas_service
from app.services import meetings as meetings_service

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingRead], summary="List meetings")
async def list_meetings(session: SessionDep) -> list[MeetingRead]:
    meetings = await meetings_service.list_meetings(session)
    return [MeetingRead.model_validate(meeting) for meeting in meetings]


@router.get("/{meeting_id}", response_model=MeetingRead, summary="Get one meeting")
async def get_meeting(meeting_id: int, session: SessionDep) -> MeetingRead:
    meeting = await meetings_service.get_meeting(session, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return MeetingRead.model_validate(meeting)


@router.post(
    "",
    response_model=MeetingRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a meeting",
)
async def create_meeting(payload: MeetingCreate, session: SessionDep) -> MeetingRead:
    meeting = await meetings_service.create_meeting(session, payload)
    return MeetingRead.model_validate(meeting)


@router.delete(
    "/{meeting_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a meeting",
)
async def delete_meeting(meeting_id: int, session: SessionDep) -> Response:
    if not await meetings_service.delete_meeting(session, meeting_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{meeting_id}/agenda", response_model=AgendaRead, summary="Get a meeting's agenda")
async def get_agenda(meeting_id: int, session: SessionDep) -> AgendaRead:
    agenda = await agendas_service.get_agenda(session, meeting_id)
    if agenda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agenda not found")
    return AgendaRead.model_validate(agenda)


@router.post(
    "/{meeting_id}/agenda",
    response_model=AgendaRead,
    summary="Save a meeting's agenda, replacing the previous one",
)
async def save_agenda(meeting_id: int, payload: AgendaSave, session: SessionDep) -> AgendaRead:
    # The only path that writes an agenda, whether it was typed by hand or
    # started from the parser's suggestion: the model never writes anything.
    agenda = await agendas_service.save_agenda(session, meeting_id, payload)
    if agenda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return AgendaRead.model_validate(agenda)
