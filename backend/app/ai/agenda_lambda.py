"""The agenda parser as a Lambda function behind a function URL (lab 6).

The backend's own image, started with python -m awslambdaric
app.ai.agenda_lambda.handler. Outside the VPC: it needs no database, reaches
Bedrock over the internet, and costs nothing while nobody pastes anything.
It never writes: the browser saves through the API.

    POST {"text": "...", "today": "2026-10-27", "tz": "Europe/Kyiv"}
    Authorization: Bearer <Cognito access token>

    200 {"agenda": {...}, "model": "...", "prompt_version": "agenda-v1"}
    400 bad body · 401 not signed in · 413 text over 10,000 characters
    422 no agenda found · 429 Bedrock is throttling · 502 the model failed
"""

import base64
import json
import logging
import sys
import time
from datetime import date
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.ai.agenda import (
    PROMPT_VERSION,
    AgendaParseError,
    ModelBusy,
    ModelUnavailable,
    cost_usd,
    parse_agenda,
)
from app.ai.auth import Unauthorized, verify_cognito_token
from app.config import get_settings

MAX_TEXT = 10_000

log = logging.getLogger("agenda-parser")


class _JsonLines(logging.Formatter):
    """One JSON object per line, so Logs Insights can filter on the fields."""

    def format(self, record: logging.LogRecord) -> str:
        line = {"level": record.levelname, "message": record.getMessage()}
        line |= getattr(record, "fields", {})
        return json.dumps(line, ensure_ascii=False)


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonLines())
    log.handlers[:] = [handler]
    log.setLevel(logging.INFO)
    log.propagate = False


_configure_logging()


def _answer(status: int, body: dict[str, Any]) -> dict[str, Any]:
    # CORS headers come from the function URL's own configuration.
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def _error(status: int, message: str) -> dict[str, Any]:
    return _answer(status, {"error": message})


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    body = json.loads(raw)
    if not isinstance(body, dict):
        raise ValueError("the body must be a JSON object")
    return body


def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    try:
        user = verify_cognito_token(headers.get("authorization", ""))
    except Unauthorized as e:
        return _error(401, f"sign in first ({e})")

    try:
        body = _body(event)
        text, tz = body["text"], body["tz"]
        today = date.fromisoformat(body["today"])
        ZoneInfo(tz)
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text is empty")
    except (ValueError, KeyError, TypeError, ZoneInfoNotFoundError) as e:
        return _error(400, f"bad request: {e}")
    # Before the model is called: a long text is a long bill.
    if len(text) > MAX_TEXT:
        return _error(413, f"the text is longer than {MAX_TEXT:,} characters")

    model = get_settings().parser_model
    started = time.monotonic()
    try:
        agenda, usage = parse_agenda(text, today, tz)
    except AgendaParseError as e:
        return _error(422, str(e))
    except ModelBusy:
        log.warning("bedrock throttled", extra={"fields": {"user": user.sub, "model": model}})
        return _error(429, "the parser is busy, try again in a minute")
    except ModelUnavailable as e:
        log.error("bedrock failed", extra={"fields": {"user": user.sub, "error": str(e)}})
        return _error(502, "the parser is not available right now")

    # Text with no agenda in it (a shopping list, one sentence) parses into no
    # items: the user is told so, rather than shown an empty form.
    event = "agenda_parsed" if agenda.items else "agenda_empty"
    log.info(
        event,
        extra={
            "fields": {
                "event": event,
                "user": user.sub,
                "model": model,
                "prompt_version": PROMPT_VERSION,
                **usage,
                "latency_ms": int((time.monotonic() - started) * 1000),
                "cost_usd": cost_usd(model, usage),
                "text_chars": len(text),
                "items": len(agenda.items),
            }
        },
    )
    if not agenda.items:
        return _error(422, "no agenda found in the text")
    payload = {"agenda": agenda.model_dump(mode="json"), "model": model}
    return _answer(200, payload | {"prompt_version": PROMPT_VERSION})
