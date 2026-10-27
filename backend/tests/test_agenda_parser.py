from datetime import date
from types import SimpleNamespace
from typing import Any

import pytest

from app.ai import agenda as parser

GOOD = {
    "title": "Синк по прайсингу",
    "starts_at": "2026-10-26T10:00:00+02:00",
    "duration_minutes": 45,
    "items": [{"topic": "Нові тарифи Pro", "owner": "Олена", "minutes": 15}],
    "action_items": [{"task": "Порівняння з конкурентами", "owner": "Taras", "due": "2026-10-30"}],
    "language": "uk",
}


def _reply(tool_input: dict | None, stop_reason: str = "tool_use") -> SimpleNamespace:
    content = []
    if tool_input is not None:
        content.append(
            SimpleNamespace(type="tool_use", id="toolu_1", name="record_agenda", input=tool_input)
        )
    return SimpleNamespace(
        content=content,
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=1000, output_tokens=200),
    )


class _FakeBedrock:
    def __init__(self, *replies: SimpleNamespace) -> None:
        self.replies = list(replies)
        self.calls: list[dict[str, Any]] = []
        self.messages = self

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        return self.replies.pop(0)


@pytest.fixture
def bedrock(monkeypatch: pytest.MonkeyPatch):
    def install(*replies: SimpleNamespace) -> _FakeBedrock:
        fake = _FakeBedrock(*replies)
        monkeypatch.setattr(parser, "_client", fake)
        return fake

    return install


def test_a_good_answer_is_validated_and_counted(bedrock) -> None:
    fake = bedrock(_reply(GOOD))
    agenda, usage = parser.parse_agenda("Пн 10:00 ...", date(2026, 10, 23), "Europe/Kyiv")
    assert agenda.items[0].owner == "Олена"
    assert agenda.action_items[0].due == date(2026, 10, 30)
    assert usage == {"input_tokens": 1000, "output_tokens": 200}
    prompt = fake.calls[0]["messages"][0]["content"]
    # Without today's date the model cannot know which Monday "Пн" is.
    assert "Today is Friday 2026-10-23, time zone Europe/Kyiv" in prompt
    assert "<pasted_text>\nПн 10:00 ...\n</pasted_text>" in prompt
    assert fake.calls[0]["tools"][0]["name"] == "record_agenda"


def test_an_invalid_answer_gets_one_retry_with_the_error(bedrock) -> None:
    fake = bedrock(_reply(GOOD | {"duration_minutes": 0}), _reply(GOOD))
    agenda, usage = parser.parse_agenda("text", date(2026, 10, 23), "Europe/Kyiv")
    assert agenda.duration_minutes == 45
    assert usage == {"input_tokens": 2000, "output_tokens": 400}
    retry = fake.calls[1]["messages"]
    assert retry[-1]["content"][0]["type"] == "tool_result"
    assert retry[-1]["content"][0]["is_error"] is True
    assert "duration_minutes" in retry[-1]["content"][0]["content"]


def test_invalid_twice_is_an_error(bedrock) -> None:
    bad = GOOD | {"items": "not a list"}
    bedrock(_reply(bad), _reply(bad))
    with pytest.raises(parser.AgendaParseError, match="twice"):
        parser.parse_agenda("text", date(2026, 10, 23), "Europe/Kyiv")


def test_no_tool_call_is_an_error(bedrock) -> None:
    bedrock(_reply(None, stop_reason="refusal"))
    with pytest.raises(parser.AgendaParseError, match="refusal"):
        parser.parse_agenda("text", date(2026, 10, 23), "Europe/Kyiv")


def test_cost_uses_the_list_prices() -> None:
    usage = {"input_tokens": 5500, "output_tokens": 300}
    assert parser.cost_usd("anthropic.claude-opus-5-5", usage) == pytest.approx(0.028)
    assert parser.cost_usd("anthropic.claude-haiku-5-5", usage) == pytest.approx(0.0007)
    assert parser.cost_usd("someone.else", usage) is None
