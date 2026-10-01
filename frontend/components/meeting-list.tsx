import { CalendarX2, Trash2, Users } from "lucide-react";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { Meeting } from "@/lib/api";
import { cn } from "@/lib/utils";

const day = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

/** Long titles would stretch the card: over 30 characters, keep 27 + "...". */
export function shortTitle(title: string): string {
  return title.length > 30 ? `${title.slice(0, 27)}...` : title;
}

function formatDuration(start: Date, end: Date): string {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function MeetingCard({
  meeting,
  now,
  onDelete,
}: {
  meeting: Meeting;
  now: Date;
  onDelete: (meeting: Meeting) => void;
}) {
  const start = new Date(meeting.starts_at);
  const end = new Date(meeting.ends_at);
  const past = end < now;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border border-l-4 bg-card px-4 py-3",
        past ? "border-l-accent-gray opacity-70" : "border-l-accent-green",
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-semibold" title={meeting.title}>
          {shortTitle(meeting.title)}
        </p>
        <p className="text-xs text-muted-foreground">
          {day.format(start)} · {time.format(start)}–{time.format(end)} ·{" "}
          {formatDuration(start, end)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span
          className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
          title={`${meeting.attendee_count} attendees`}
        >
          <Users className="size-3.5" />
          {meeting.attendee_count}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${meeting.title}`}
          title="Delete"
          onClick={() => onDelete(meeting)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function MeetingList({
  meetings,
  loading,
  error,
  onDelete,
}: {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;
  onDelete: (meeting: Meeting) => void;
}) {
  const now = new Date();

  return (
    <Panel
      title="Meetings"
      subtitle={
        loading
          ? "Loading…"
          : `${meetings.length} ${meetings.length === 1 ? "meeting" : "meetings"}, earliest first`
      }
    >
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-white px-4 py-3 text-sm text-destructive">
          Could not load meetings: {error}
        </p>
      ) : !loading && meetings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-panel-border bg-white/60 px-4 py-10 text-center">
          <CalendarX2 className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No meetings yet</p>
          <p className="text-xs text-muted-foreground">
            Add the first one with the form.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <MeetingCard meeting={meeting} now={now} onDelete={onDelete} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
