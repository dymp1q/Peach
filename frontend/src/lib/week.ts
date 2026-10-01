// Week-over-week numbers, computed in the browser from GET /api/meetings.
// A week starts on Monday 00:00 in the viewer's local time zone.

import type { Meeting } from "@/lib/api";

const HOUR_MS = 60 * 60 * 1000;

export function startOfWeek(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export type WeekTotals = {
  meetings: number;
  hours: number;
  personHours: number;
};

function totals(meetings: Meeting[], from: Date, to: Date): WeekTotals {
  const inWeek = meetings.filter((meeting) => {
    const start = new Date(meeting.starts_at);
    return start >= from && start < to;
  });
  let hours = 0;
  let personHours = 0;
  for (const meeting of inWeek) {
    const duration =
      (new Date(meeting.ends_at).getTime() -
        new Date(meeting.starts_at).getTime()) /
      HOUR_MS;
    hours += duration;
    personHours += duration * meeting.attendee_count;
  }
  return { meetings: inWeek.length, hours, personHours };
}

export function weekOverWeek(meetings: Meeting[], now = new Date()) {
  const thisWeek = startOfWeek(now);
  return {
    weekStart: thisWeek,
    current: totals(meetings, thisWeek, addDays(thisWeek, 7)),
    previous: totals(meetings, addDays(thisWeek, -7), thisWeek),
  };
}

/** Percent change from `previous` to `current`; null when there is no base. */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
