import base64
import json
import time
from datetime import date
from types import SimpleNamespace
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.ai import agenda_lambda, auth
from app.ai.agenda import AgendaParseError, ModelBusy, ModelUnavailable, ParsedAgenda
from app.config import get_settings

ISSUER = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_test"
CLIENT_ID = "web-client"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(**overrides: Any) -> str:
    claims = {
        "sub": "user-1",
        "iss": ISSUER,
        "client_id": CLIENT_ID,
        "token_use": "access",
        "exp": int(time.time()) + 300,
    } | overrides
    return jwt.encode(claims, KEY, algorithm="RS256")


@pytest.fixture(autouse=True)
def cognito(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COGNITO_ISSUER", ISSUER)
    monkeypatch.setenv("COGNITO_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("PARSER_MODEL", "anthropic.claude-opus-5-5")
    get_settings.cache_clear()
    keys = SimpleNamespace(get_signing_key_from_jwt=lambda _: SimpleNamespace(key=KEY.public_key()))
    monkeypatch.setattr(auth, "_jwks_client", lambda issuer: keys)
    yield
    get_settings.cache_clear()


def _event(body: Any, token: str | None = None, *, encode: bool = False) -> dict[str, Any]:
    raw = json.dumps(body)
    return {
        "headers": {"authorization": f"Bearer {token or _token()}"},
        "body": base64.b64encode(raw.encode()).decode() if encode else raw,
        "isBase64Encoded": encode,
    }


BODY = {"text": "Пн 10:00, синк", "today": "2026-10-27", "tz": "Europe/Kyiv"}
AGENDA = ParsedAgenda(items=[{"topic": "Синк"}], language="uk")


@pytest.fixture
def parsed(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    calls: list[tuple] = []

    def fake(text: str, today: date, tz: str):
        calls.append((text, today, tz))
        return AGENDA, {"input_tokens": 1200, "output_tokens": 300}

    monkeypatch.setattr(agenda_lambda, "parse_agenda", fake)
    return calls


def test_parses_and_logs_one_line(parsed, caplog: pytest.LogCaptureFixture) -> None:
    response = agenda_lambda.handler(_event(BODY, encode=True))
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["agenda"]["items"][0]["topic"] == "Синк"
    assert body["prompt_version"] == "agenda-v1"
    assert parsed == [("Пн 10:00, синк", date(2026, 10, 27), "Europe/Kyiv")]

    # The line exactly as CloudWatch gets it.
    record = next(r for r in caplog.records if r.getMessage() == "agenda_parsed")
    line = json.loads(agenda_lambda._JsonLines().format(record))
    assert line["event"] == "agenda_parsed"
    assert line["user"] == "user-1"
    assert line["model"] == "anthropic.claude-opus-5-5"
    assert line["input_tokens"] == 1200 and line["output_tokens"] == 300
    assert line["cost_usd"] == pytest.approx(0.0108)
    assert "latency_ms" in line
    assert "синк" not in json.dumps(line, ensure_ascii=False)  # the text itself is not logged


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        _token(token_use="id"),
        _token(client_id="someone-else"),
        _token(iss="https://evil.example.com"),
        _token(exp=int(time.time()) - 10),
    ],
)
def test_anything_but_our_access_token_is_401(parsed, token: str) -> None:
    assert agenda_lambda.handler(_event(BODY, token))["statusCode"] == 401
    assert parsed == []


def test_no_header_is_401(parsed) -> None:
    assert agenda_lambda.handler({"headers": {}, "body": json.dumps(BODY)})["statusCode"] == 401


def test_long_text_is_413_before_the_model(parsed) -> None:
    response = agenda_lambda.handler(_event(BODY | {"text": "x" * 10_001}))
    assert response["statusCode"] == 413
    assert parsed == []


@pytest.mark.parametrize(
    "body",
    [
        {"today": "2026-10-27", "tz": "Europe/Kyiv"},
        BODY | {"today": "Monday"},
        BODY | {"tz": "Mars/Base"},
        BODY | {"text": "   "},
    ],
)
def test_bad_body_is_400(parsed, body: dict) -> None:
    assert agenda_lambda.handler(_event(body))["statusCode"] == 400


def _raise(exc: Exception):
    def fake(*_: Any) -> None:
        raise exc

    return fake


def test_no_agenda_is_422(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agenda_lambda, "parse_agenda", _raise(AgendaParseError("no agenda")))
    assert agenda_lambda.handler(_event(BODY))["statusCode"] == 422


def test_throttling_is_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agenda_lambda, "parse_agenda", _raise(ModelBusy("slow down")))
    assert agenda_lambda.handler(_event(BODY))["statusCode"] == 429


def test_model_failure_is_502(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agenda_lambda, "parse_agenda", _raise(ModelUnavailable("403")))
    assert agenda_lambda.handler(_event(BODY))["statusCode"] == 502


def test_text_without_an_agenda_is_422(monkeypatch: pytest.MonkeyPatch, caplog) -> None:
    empty = ParsedAgenda(items=[], language="en")
    usage = {"input_tokens": 900, "output_tokens": 50}
    monkeypatch.setattr(agenda_lambda, "parse_agenda", lambda *_: (empty, usage))
    assert agenda_lambda.handler(_event(BODY))["statusCode"] == 422
    # It was still paid for, so it is still logged.
    assert any(r.getMessage() == "agenda_empty" for r in caplog.records)
