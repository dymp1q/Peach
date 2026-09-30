from typing import Any

import pytest
from httpx import AsyncClient


@pytest.fixture
def client(anon_client: AsyncClient) -> AsyncClient:
    """Meetings need no sign-in: every test here runs without a token."""
    return anon_client


def _meeting(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "Weekly planning",
        "starts_at": "2026-10-01T09:00:00Z",
        "ends_at": "2026-10-01T10:00:00Z",
        "attendee_count": 6,
    } | overrides


async def test_list_is_empty_at_first(client: AsyncClient) -> None:
    response = await client.get("/api/meetings")
    assert response.status_code == 200
    assert response.json() == []


async def test_create_returns_the_meeting(client: AsyncClient) -> None:
    response = await client.post("/api/meetings", json=_meeting())
    assert response.status_code == 201
    body = response.json()
    assert isinstance(body["id"], int)
    assert body | {"id": 0} == _meeting() | {"id": 0}


async def test_datetimes_come_back_in_utc(client: AsyncClient) -> None:
    response = await client.post(
        "/api/meetings",
        json=_meeting(starts_at="2026-10-01T12:00:00+03:00", ends_at="2026-10-01T13:30:00+03:00"),
    )
    assert response.status_code == 201
    assert response.json()["starts_at"] == "2026-10-01T09:00:00Z"
    assert response.json()["ends_at"] == "2026-10-01T10:30:00Z"


async def test_list_is_ordered_by_start(client: AsyncClient) -> None:
    await client.post(
        "/api/meetings",
        json=_meeting(
            title="Later", starts_at="2026-10-02T09:00:00Z", ends_at="2026-10-02T10:00:00Z"
        ),
    )
    await client.post("/api/meetings", json=_meeting(title="Earlier"))

    response = await client.get("/api/meetings")
    assert [m["title"] for m in response.json()] == ["Earlier", "Later"]


async def test_title_is_trimmed(client: AsyncClient) -> None:
    response = await client.post("/api/meetings", json=_meeting(title="  Retro  "))
    assert response.json()["title"] == "Retro"


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": "   "},
        {"title": "x" * 201},
        {"attendee_count": 0},
        {"ends_at": "2026-10-01T09:00:00Z"},  # equal to starts_at
        {"ends_at": "2026-10-01T08:00:00Z"},  # before starts_at
        {"starts_at": "2026-10-01T09:00:00"},  # no UTC offset
    ],
)
async def test_invalid_meeting_is_rejected(client: AsyncClient, overrides: dict) -> None:
    response = await client.post("/api/meetings", json=_meeting(**overrides))
    assert response.status_code == 422
    listed = await client.get("/api/meetings")
    assert listed.json() == []
