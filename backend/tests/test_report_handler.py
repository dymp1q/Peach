import json
from typing import Any

import pytest

from app.reports import lambda_handler


class _FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **_: Any) -> None:  # noqa: N803
        self.objects[f"{Bucket}/{Key}"] = Body


@pytest.fixture
def s3(monkeypatch: pytest.MonkeyPatch) -> _FakeS3:
    fake = _FakeS3()
    monkeypatch.setattr(lambda_handler, "_s3", fake)
    monkeypatch.setattr(lambda_handler, "build_weekly_report", lambda week: f"csv {week}".encode())
    monkeypatch.setattr(lambda_handler, "last_week", lambda: "2026-W40")
    monkeypatch.setenv("REPORTS_BUCKET", "bucket")
    monkeypatch.delenv("FAIL_WEEK", raising=False)
    return fake


def _sqs(*bodies: dict[str, Any]) -> dict[str, Any]:
    return {"Records": [{"eventSource": "aws:sqs", "body": json.dumps(b)} for b in bodies]}


def test_detects_each_trigger() -> None:
    assert lambda_handler.detect_trigger({"source": "schedule"}) == "schedule"
    assert lambda_handler.detect_trigger(_sqs({}), {"source": "report-now"}) == "sqs"
    assert lambda_handler.detect_trigger(_sqs({}), {"source": "schedule"}) == "schedule"
    assert lambda_handler.detect_trigger({}) == "manual"


def test_schedule_without_a_week_builds_last_week(s3: _FakeS3) -> None:
    assert lambda_handler.handler({"source": "schedule"}) == {"reports": ["reports/2026-W40.csv"]}
    assert s3.objects == {"bucket/reports/2026-W40.csv": b"csv 2026-W40"}


def test_sqs_message_names_the_week(s3: _FakeS3) -> None:
    lambda_handler.handler(_sqs({"week": "2026-W39", "source": "report-now"}))
    assert list(s3.objects) == ["bucket/reports/2026-W39.csv"]


def test_same_week_twice_is_one_file(s3: _FakeS3) -> None:
    lambda_handler.handler(_sqs({"week": "2026-W39"}))
    lambda_handler.handler(_sqs({"week": "2026-W39"}))
    assert list(s3.objects) == ["bucket/reports/2026-W39.csv"]


def test_logs_which_event_started_it(s3: _FakeS3, caplog: pytest.LogCaptureFixture) -> None:
    lambda_handler.log.addHandler(caplog.handler)
    try:
        lambda_handler.handler(_sqs({"week": "2026-W39", "source": "report-now"}))
    finally:
        lambda_handler.log.removeHandler(caplog.handler)
    line = json.loads(lambda_handler._JsonLines().format(caplog.records[0]))
    assert line == {
        "level": "INFO",
        "message": "report-builder triggered",
        "trigger": "sqs",
        "source": "report-now",
        "week": "2026-W39",
        "via": "sqs",
    }


def test_schedule_through_the_queue_logs_as_schedule(
    s3: _FakeS3, caplog: pytest.LogCaptureFixture
) -> None:
    lambda_handler.log.addHandler(caplog.handler)
    try:
        lambda_handler.handler(_sqs({"week": None, "source": "schedule"}))
    finally:
        lambda_handler.log.removeHandler(caplog.handler)
    assert caplog.records[0].fields["trigger"] == "schedule"
    assert list(s3.objects) == ["bucket/reports/2026-W40.csv"]


def test_fail_week_raises(s3: _FakeS3, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAIL_WEEK", "2026-W30")
    with pytest.raises(RuntimeError, match="on purpose"):
        lambda_handler.handler(_sqs({"week": "2026-W30"}))
    assert s3.objects == {}
