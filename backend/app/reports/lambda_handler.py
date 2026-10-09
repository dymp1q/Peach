"""The report builder as a Lambda function (lab 5).

The backend's own image, started with a different command:
python -m awslambdaric app.reports.lambda_handler.handler. It sits in the
VPC next to the database, with no route to the internet; it reaches S3 through
the gateway endpoint and never talks to SES - the mailer does that, triggered
by the file this function writes.

It is invoked two ways, and handles both shapes:
- directly, with the payload as the event: {"source": "schedule"};
- by SQS, one record per message, the payload as the record's body:
  {"week": "2026-W39", "source": "report-now"}.
"""

import json
import logging
import os
import sys
from typing import Any

import boto3

from app.reports.weekly import build_weekly_report, last_week, report_key

log = logging.getLogger("report-builder")


class _JsonLines(logging.Formatter):
    """One JSON object per line, so CloudWatch shows the fields side by side
    and Logs Insights can filter on them."""

    def format(self, record: logging.LogRecord) -> str:
        line = {"level": record.levelname, "message": record.getMessage()}
        line |= getattr(record, "fields", {})
        if record.exc_info:
            line["error"] = self.formatException(record.exc_info)
        return json.dumps(line, ensure_ascii=False)


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonLines())
    log.handlers[:] = [handler]
    log.setLevel(logging.INFO)
    log.propagate = False


_configure_logging()
_s3: Any = None


def _s3_client() -> Any:
    # Created on first use: importing the module must not need AWS credentials.
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def detect_trigger(event: dict[str, Any], request: dict[str, Any] | None = None) -> str:
    """Which event started this run. The schedule sends its message through the
    queue, so a message whose source is "schedule" counts as the schedule; any
    other message (make report-now, later the API) is "sqs". A direct
    invocation names its own source, or is "manual"."""
    records = event.get("Records") or []
    if records and records[0].get("eventSource") == "aws:sqs":
        return "schedule" if (request or {}).get("source") == "schedule" else "sqs"
    return str(event.get("source") or "manual")


def _requests(event: dict[str, Any]) -> list[dict[str, Any]]:
    records = event.get("Records") or []
    if records and records[0].get("eventSource") == "aws:sqs":
        return [json.loads(record["body"] or "{}") for record in records]
    return [event]


def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    built = []
    for request in _requests(event):
        trigger = detect_trigger(event, request)
        # The caller decides the week; none means the week that just ended.
        week = request.get("week") or last_week()
        fields = {"trigger": trigger, "source": request.get("source") or trigger, "week": week}
        if event.get("Records"):
            fields["via"] = "sqs"
        log.info("report-builder triggered", extra={"fields": fields})
        _fail_on_purpose(week)

        body = build_weekly_report(week)
        key = report_key(week)
        _s3_client().put_object(
            Bucket=os.environ["REPORTS_BUCKET"],
            Key=key,
            Body=body,
            ContentType="text/csv; charset=utf-8",
        )
        log.info(
            "report written",
            extra={"fields": {"trigger": trigger, "week": week, "key": key, "bytes": len(body)}},
        )
        built.append(key)
    return {"reports": built}


def _fail_on_purpose(week: str) -> None:
    """Step 7, "break it": FAIL_WEEK=2026-W30 makes that one week raise, so its
    message goes round three times and lands in the dead-letter queue."""
    if week and week == os.environ.get("FAIL_WEEK"):
        raise RuntimeError(f"FAIL_WEEK={week}: failing on purpose to exercise the DLQ")
