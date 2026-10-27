from typing import Any

import pytest
from httpx import AsyncClient

MEETING = {
    "title": "Pricing sync",
    "starts_at": "2026-10-26T08:00:00Z",
    "ends_at": "2026-10-26T08:45:00Z",
    "attendee_count": 4,
}


def _agenda(**overrides: Any) -> dict[str, Any]:
    return {
        "items": [
            {"topic": "New Pro plans", "owner": "Олена", "minutes": 15},
            {"topic": "Customer feedback", "owner": "Taras"},
        ],
        "action_items": [
            {"task": "Compare with competitors", "owner": "Taras", "due": "2026-10-30"}
        ],
    } | overrides


async def _meeting_id(client: AsyncClient) -> int:
    return (await client.post("/api/meetings", json=MEETING)).json()["id"]


async def test_get_one_meeting(client: AsyncClient) -> None:
    meeting_id = await _meeting_id(client)
    response = await client.get(f"/api/meetings/{meeting_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Pricing sync"
    assert (await client.get("/api/meetings/999999")).status_code == 404


async def test_no_agenda_yet_is_404(client: AsyncClient) -> None:
    meeting_id = await _meeting_id(client)
    response = await client.get(f"/api/meetings/{meeting_id}/agenda")
    assert response.status_code == 404


async def test_save_then_read_it_back(client: AsyncClient) -> None:
    meeting_id = await _meeting_id(client)
    saved = await client.post(f"/api/meetings/{meeting_id}/agenda", json=_agenda())
    assert saved.status_code == 200
    body = (await client.get(f"/api/meetings/{meeting_id}/agenda")).json()
    assert body["items"][0] == {"topic": "New Pro plans", "owner": "Олена", "minutes": 15}
    assert body["items"][1]["minutes"] is None
    assert body["action_items"][0]["due"] == "2026-10-30"
    assert body["ai_suggestion"] is None
    assert body["saved_at"].endswith("Z")


async def test_the_suggestion_is_stored_next_to_the_agenda(client: AsyncClient) -> None:
    meeting_id = await _meeting_id(client)
    suggestion = {"items": [{"topic": "New Pro plans", "owner": "Olena", "minutes": 15}]}
    await client.post(
        f"/api/meetings/{meeting_id}/agenda",
        json=_agenda(
            ai_suggestion=suggestion,
            ai_model="anthropic.claude-opus-5-5",
            ai_prompt_version="agenda-v1",
        ),
    )
    body = (await client.get(f"/api/meetings/{meeting_id}/agenda")).json()
    assert body["ai_suggestion"] == suggestion
    assert body["ai_model"] == "anthropic.claude-opus-5-5"
    assert body["ai_prompt_version"] == "agenda-v1"


async def test_saving_again_replaces_it(client: AsyncClient) -> None:
    meeting_id = await _meeting_id(client)
    await client.post(f"/api/meetings/{meeting_id}/agenda", json=_agenda())
    await client.post(
        f"/api/meetings/{meeting_id}/agenda",
        json=_agenda(items=[{"topic": "Only this"}], action_items=[]),
    )
    body = (await client.get(f"/api/meetings/{meeting_id}/agenda")).json()
    assert [i["topic"] for i in body["items"]] == ["Only this"]
    assert body["action_items"] == []


async def test_unknown_meeting_is_404(client: AsyncClient) -> None:
    response = await client.post("/api/meetings/999999/agenda", json=_agenda())
    assert response.status_code == 404


async def test_deleting_the_meeting_deletes_its_agenda(client: AsyncClient) -> None:
    meeting_id = await _meeting_id(client)
    await client.post(f"/api/meetings/{meeting_id}/agenda", json=_agenda())
    await client.delete(f"/api/meetings/{meeting_id}")
    assert (await client.get(f"/api/meetings/{meeting_id}/agenda")).status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"items": []},
        {"items": [{"topic": "   "}]},
        {"items": [{"topic": "Long", "minutes": 0}]},
        {"items": [{"topic": "Long", "minutes": 481}]},
        {"action_items": [{"task": "x", "due": "next Friday"}]},
    ],
)
async def test_invalid_agenda_is_rejected(client: AsyncClient, overrides: dict) -> None:
    meeting_id = await _meeting_id(client)
    response = await client.post(f"/api/meetings/{meeting_id}/agenda", json=_agenda(**overrides))
    assert response.status_code == 422
    assert (await client.get(f"/api/meetings/{meeting_id}/agenda")).status_code == 404
