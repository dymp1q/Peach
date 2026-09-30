from fastapi import APIRouter, HTTPException, Response, status

from app.db import SessionDep
from app.schemas import MeetingCreate, MeetingRead
from app.services import meetings as meetings_service

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingRead], summary="List meetings")
async def list_meetings(session: SessionDep) -> list[MeetingRead]:
    meetings = await meetings_service.list_meetings(session)
    return [MeetingRead.model_validate(meeting) for meeting in meetings]


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
