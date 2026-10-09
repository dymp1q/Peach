"""The weekly meetings report (lab 5): one ISO week of meetings as a CSV file.

Plain functions with no AWS in them. The Lambda handler decides which week and
where the file goes; this module only turns a week into bytes, so it can be
run and tested against the Compose database like the rest of the backend.
"""

import asyncio
import csv
import io
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.models import Meeting

# Weeks start on Monday 00:00 in Kyiv, as on the site's "This week" panel.
TIMEZONE = ZoneInfo("Europe/Kyiv")
TOP_N = 5

_WEEK = re.compile(r"^(\d{4})-W(\d{2})$")


def parse_week(week: str) -> tuple[int, int]:
    """'2026-W40' -> (2026, 40). Raises ValueError for anything else."""
    match = _WEEK.match(week)
    if not match:
        raise ValueError(f"week must look like 2026-W40, got {week!r}")
    year, number = int(match[1]), int(match[2])
    date.fromisocalendar(year, number, 1)  # rejects W00, W54 and W53 in 52-week years
    return year, number


def week_bounds(week: str) -> tuple[datetime, datetime]:
    """The week's [Monday 00:00, next Monday 00:00) in Kyiv time."""
    year, number = parse_week(week)
    monday = date.fromisocalendar(year, number, 1)
    start = datetime.combine(monday, datetime.min.time(), TIMEZONE)
    end = datetime.combine(monday + timedelta(days=7), datetime.min.time(), TIMEZONE)
    return start, end


def previous_week(week: str) -> str:
    start, _ = week_bounds(week)
    return iso_week(start - timedelta(days=7))


def iso_week(moment: datetime | date) -> str:
    year, number, _ = moment.isocalendar()
    return f"{year}-W{number:02d}"


def last_week(now: datetime | None = None) -> str:
    """The ISO week before the one containing `now` (Kyiv time). For callers
    only: build_weekly_report itself never decides which week."""
    now = (now or datetime.now(UTC)).astimezone(TIMEZONE)
    return iso_week(now - timedelta(days=7))


def report_key(week: str) -> str:
    """The same week always maps to the same object, so a rebuild overwrites."""
    parse_week(week)
    return f"reports/{week}.csv"


@dataclass(frozen=True)
class Totals:
    meetings: int
    hours: float


def _hours(meeting: Meeting) -> float:
    return (meeting.ends_at - meeting.starts_at).total_seconds() / 3600


def _totals(meetings: Sequence[Meeting]) -> Totals:
    return Totals(len(meetings), sum(_hours(m) for m in meetings))


async def _meetings_in(session: AsyncSession, week: str) -> Sequence[Meeting]:
    start, end = week_bounds(week)
    result = await session.scalars(
        select(Meeting)
        .where(Meeting.starts_at >= start, Meeting.starts_at < end)
        .order_by(Meeting.starts_at, Meeting.id)
    )
    return result.all()


def _fmt_hours(hours: float) -> str:
    return f"{hours:.2f}"


def _change(now: float, before: float, *, hours: bool) -> tuple[str, str]:
    diff = now - before
    absolute = _fmt_hours(diff) if hours else str(int(diff))
    if diff > 0:
        absolute = f"+{absolute}"
    percent = "n/a" if before == 0 else f"{diff / before * 100:+.1f}%"
    return absolute, percent


async def render_weekly_report(session: AsyncSession, week: str) -> bytes:
    """The report for `week`, read through an existing session."""
    start, end = week_bounds(week)
    before_week = previous_week(week)
    this = await _meetings_in(session, week)
    before = await _meetings_in(session, before_week)
    now, prev = _totals(this), _totals(before)

    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["Spry weekly meetings report"])
    writer.writerow(["week", week])
    writer.writerow(
        ["period", start.date().isoformat(), (end - timedelta(days=1)).date().isoformat()]
    )
    writer.writerow(["timezone", str(TIMEZONE)])
    writer.writerow([])

    writer.writerow(["metric", week, before_week, "change", "change_pct"])
    meetings_change = _change(now.meetings, prev.meetings, hours=False)
    writer.writerow(["meetings", now.meetings, prev.meetings, *meetings_change])
    writer.writerow(
        [
            "hours",
            _fmt_hours(now.hours),
            _fmt_hours(prev.hours),
            *_change(now.hours, prev.hours, hours=True),
        ]
    )
    writer.writerow([])

    writer.writerow([f"top {TOP_N} longest meetings"])
    writer.writerow(["rank", "title", "starts_at", "duration_hours", "attendees"])
    longest = sorted(this, key=lambda m: (-_hours(m), m.starts_at, m.id))[:TOP_N]
    for rank, meeting in enumerate(longest, start=1):
        writer.writerow(
            [
                rank,
                meeting.title,
                meeting.starts_at.astimezone(TIMEZONE).strftime("%Y-%m-%d %H:%M"),
                _fmt_hours(_hours(meeting)),
                meeting.attendee_count,
            ]
        )
    if not longest:
        writer.writerow(["", "(no meetings this week)"])

    # UTF-8 with a BOM, so Excel shows Cyrillic titles correctly.
    return out.getvalue().encode("utf-8-sig")


async def _build(week: str) -> bytes:
    # A fresh engine with no pool: called from a Lambda, an idle pooled
    # connection would keep the database awake between invocations.
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            return await render_weekly_report(session, week)
    finally:
        await engine.dispose()


def build_weekly_report(week: str) -> bytes:
    """Query the meetings of one ISO week (e.g. "2026-W40") and return the CSV."""
    parse_week(week)
    return asyncio.run(_build(week))


if __name__ == "__main__":
    # Locally, against the Compose database: make report-local WEEK=2026-W40
    import sys

    week = sys.argv[1] if len(sys.argv) > 1 else last_week()
    sys.stdout.write(build_weekly_report(week).decode("utf-8-sig"))
