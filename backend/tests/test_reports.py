from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Meeting
from app.reports.weekly import (
    last_week,
    parse_week,
    previous_week,
    render_weekly_report,
    report_key,
    week_bounds,
)


def _meeting(title: str, start: str, end: str, attendees: int = 2) -> Meeting:
    return Meeting(
        title=title,
        starts_at=datetime.fromisoformat(start),
        ends_at=datetime.fromisoformat(end),
        attendee_count=attendees,
    )


def _rows(csv_bytes: bytes) -> list[str]:
    return csv_bytes.decode("utf-8-sig").splitlines()


def test_week_bounds_are_kyiv_mondays() -> None:
    start, end = week_bounds("2026-W40")
    assert start.isoformat() == "2026-09-28T00:00:00+03:00"
    assert end.isoformat() == "2026-10-05T00:00:00+03:00"


def test_week_across_the_dst_change() -> None:
    # Kyiv leaves summer time on Sunday 25 Oct 2026, inside W43: that week is an hour longer.
    start, end = week_bounds("2026-W43")
    assert (start.utcoffset(), end.utcoffset()) == (timedelta(hours=3), timedelta(hours=2))
    assert (end.astimezone(UTC) - start.astimezone(UTC)).total_seconds() == (7 * 24 + 1) * 3600


@pytest.mark.parametrize("bad", ["2026-40", "2026-W0", "2026-W54", "W40", "2026-W40.csv", ""])
def test_rejects_malformed_weeks(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_week(bad)


def test_previous_week_crosses_the_year() -> None:
    assert previous_week("2026-W01") == "2025-W52"
    assert previous_week("2026-W40") == "2026-W39"


def test_last_week_is_decided_by_the_caller() -> None:
    # Monday 5 Oct 2026, 07:00 Kyiv -> the report covers W40.
    assert last_week(datetime(2026, 10, 5, 4, 0, tzinfo=UTC)) == "2026-W40"


def test_same_week_same_key() -> None:
    assert report_key("2026-W40") == report_key("2026-W40") == "reports/2026-W40.csv"


async def test_report_counts_compares_and_ranks(session: AsyncSession) -> None:
    session.add_all(
        [
            # W40 (28 Sep - 4 Oct)
            _meeting("Planning", "2026-09-28T09:00:00+03:00", "2026-09-28T10:00:00+03:00", 6),
            _meeting("Workshop", "2026-09-30T10:00:00+03:00", "2026-09-30T13:30:00+03:00", 12),
            _meeting("Зустріч", "2026-10-04T23:00:00+03:00", "2026-10-04T23:30:00+03:00"),
            # W39
            _meeting("Old", "2026-09-22T09:00:00+03:00", "2026-09-22T11:00:00+03:00"),
            # W41: Monday 00:00 Kyiv is already the next week
            _meeting("Next", "2026-10-05T00:00:00+03:00", "2026-10-05T01:00:00+03:00"),
        ]
    )
    await session.flush()

    rows = _rows(await render_weekly_report(session, "2026-W40"))

    assert "week,2026-W40" in rows
    assert "meetings,3,1,+2,+200.0%" in rows
    assert "hours,5.00,2.00,+3.00,+150.0%" in rows
    top = rows[rows.index("rank,title,starts_at,duration_hours,attendees") + 1 :]
    assert top == [
        "1,Workshop,2026-09-30 10:00,3.50,12",
        "2,Planning,2026-09-28 09:00,1.00,6",
        "3,Зустріч,2026-10-04 23:00,0.50,2",
    ]


async def test_report_is_deterministic(session: AsyncSession) -> None:
    session.add(_meeting("A", "2026-09-29T09:00:00+03:00", "2026-09-29T10:00:00+03:00"))
    await session.flush()
    assert await render_weekly_report(session, "2026-W40") == await render_weekly_report(
        session, "2026-W40"
    )


async def test_empty_week(session: AsyncSession) -> None:
    rows = _rows(await render_weekly_report(session, "2020-W10"))
    assert "meetings,0,0,0,n/a" in rows
    assert ",(no meetings this week)" in rows
