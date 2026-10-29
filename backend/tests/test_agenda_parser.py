import json
from datetime import date
from types import SimpleNamespace
from typing import Any

import pytest

from app.ai import agenda as parser
from app.config import get_settings

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


def _use_model(monkeypatch: pytest.MonkeyPatch, model: str) -> None:
    monkeypatch.setenv("PARSER_MODEL", model)
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _fresh_settings():
    yield
    get_settings.cache_clear()


@pytest.fixture
def bedrock(monkeypatch: pytest.MonkeyPatch):
    _use_model(monkeypatch, "anthropic.claude-opus-5-5")

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


def test_evaluation_flags_owners_not_in_the_text() -> None:
    from app.ai.evaluate import suspicious

    agenda = parser.ParsedAgenda.model_validate(
        GOOD
        | {
            "items": [
                {"topic": "Sprint review", "owner": "Oksana"},
                {"topic": "Bug triage", "owner": "admin@example.com"},
            ]
        }
    )
    notes = suspicious("1) Sprint review - Oksana 2) Bug triage - Petro", agenda)
    assert "owner 'admin@example.com' not in text" in notes
    assert not any("Oksana" in n for n in notes)
    assert "due 2026-10-30 (check)" in notes


# --- the other models on bedrock-mantle: OpenAI-compatible chat completions ---


def _completion(arguments: dict | str | None, finish_reason: str = "tool_calls") -> dict:
    message: dict[str, Any] = {"role": "assistant", "content": None}
    if arguments is not None:
        raw = arguments if isinstance(arguments, str) else json.dumps(arguments)
        message["tool_calls"] = [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "record_agenda", "arguments": raw},
            }
        ]
    return {
        "choices": [{"index": 0, "finish_reason": finish_reason, "message": message}],
        "usage": {"prompt_tokens": 800, "completion_tokens": 150},
    }


@pytest.fixture
def mantle(monkeypatch: pytest.MonkeyPatch):
    _use_model(monkeypatch, "moonshotai.kimi-k2.5")
    calls: list[dict[str, Any]] = []

    def install(*replies: dict) -> list[dict[str, Any]]:
        queue = list(replies)

        def fake(body: dict[str, Any]) -> dict[str, Any]:
            calls.append(json.loads(json.dumps(body)))
            return queue.pop(0)

        monkeypatch.setattr(parser, "_mantle_chat", fake)
        return calls

    return install


def test_chat_completions_force_the_tool(mantle) -> None:
    calls = mantle(_completion(GOOD))
    agenda, usage = parser.parse_agenda("Пн 10:00 ...", date(2026, 10, 29), "Europe/Kyiv")
    assert agenda.items[0].owner == "Олена"
    assert usage == {"input_tokens": 800, "output_tokens": 150}
    body = calls[0]
    assert body["model"] == "moonshotai.kimi-k2.5"
    assert body["messages"][0] == {"role": "system", "content": parser.SYSTEM}
    assert "<pasted_text>\nПн 10:00 ...\n</pasted_text>" in body["messages"][1]["content"]
    assert body["tool_choice"]["function"]["name"] == "record_agenda"
    assert body["tools"][0]["function"]["parameters"] == parser.RECORD_AGENDA["input_schema"]


def test_chat_completions_retry_once_with_the_error(mantle) -> None:
    calls = mantle(_completion(GOOD | {"items": ["just a string"]}), _completion(GOOD))
    agenda, usage = parser.parse_agenda("text", date(2026, 10, 29), "Europe/Kyiv")
    assert len(agenda.items) == 1
    assert usage == {"input_tokens": 1600, "output_tokens": 300}
    retry = calls[1]["messages"]
    assert retry[-2]["tool_calls"][0]["id"] == "call_1"
    assert retry[-1]["role"] == "tool" and retry[-1]["tool_call_id"] == "call_1"


def test_chat_completions_without_a_tool_call_is_an_error(mantle) -> None:
    mantle(_completion(None, finish_reason="stop"))
    with pytest.raises(parser.AgendaParseError, match="finish_reason=stop"):
        parser.parse_agenda("text", date(2026, 10, 29), "Europe/Kyiv")


def test_claude_errors_become_busy_or_unavailable(bedrock) -> None:
    import anthropic
    import httpx

    request = httpx.Request("POST", "https://bedrock-mantle.us-east-1.api.aws")

    class _Failing:
        def __init__(self, exc: Exception) -> None:
            self.exc = exc
            self.messages = self

        def create(self, **_: Any) -> None:
            raise self.exc

    throttled = anthropic.RateLimitError(
        "slow", response=httpx.Response(429, request=request), body=None
    )
    denied = anthropic.PermissionDeniedError(
        "no", response=httpx.Response(403, request=request), body=None
    )
    for exc, expected in [(throttled, parser.ModelBusy), (denied, parser.ModelUnavailable)]:
        parser._client = _Failing(exc)
        with pytest.raises(expected):
            parser.parse_agenda("text", date(2026, 10, 29), "Europe/Kyiv")
