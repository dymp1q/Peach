import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Panel } from "@/components/panel";
import type { Meeting } from "@/lib/api";
import { cn } from "@/lib/utils";
import { addDays, percentChange, weekOverWeek } from "@/lib/week";

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function formatHours(hours: number): string {
  return hours.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

function Trend({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous);
  if (change === null) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3.5" />
        {current > 0 ? "new this week" : "no meetings either week"}
      </span>
    );
  }
  const up = change > 0;
  const flat = Math.round(change) === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        flat
          ? "text-muted-foreground"
          : up
            ? "text-trend-up"
            : "text-trend-down",
      )}
    >
      <Icon className="size-3.5" />
      {flat ? "same as" : `${up ? "+" : ""}${Math.round(change)}% vs`} last week
    </span>
  );
}

function StatCard({
  label,
  hint,
  accent,
  value,
  current,
  previous,
}: {
  label: string;
  hint: string;
  accent: string;
  value: string;
  current: number;
  previous: number;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-l-4 bg-card px-4 py-4",
        accent,
      )}
    >
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <p className="text-3xl font-semibold tracking-tight text-primary">
        {value}
      </p>
      <Trend current={current} previous={previous} />
    </div>
  );
}

export function WeekStats({ meetings }: { meetings: Meeting[] }) {
  const { weekStart, current, previous } = weekOverWeek(meetings);
  const range = `${dayMonth.format(weekStart)} – ${dayMonth.format(addDays(weekStart, 6))}`;

  return (
    <Panel title="This week" subtitle={`${range} · compared with last week`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Meetings"
          hint="Starting this week"
          accent="border-l-accent-green"
          value={String(current.meetings)}
          current={current.meetings}
          previous={previous.meetings}
        />
        <StatCard
          label="Meeting hours"
          hint="Time on the calendar"
          accent="border-l-accent-blue"
          value={`${formatHours(current.hours)} h`}
          current={current.hours}
          previous={previous.hours}
        />
        <StatCard
          label="Hours"
          hint="Total this week"
          accent="border-l-accent-purple"
          value={`${formatHours(current.hours)} h`}
          current={current.hours}
          previous={previous.hours}
        />
      </div>
    </Panel>
  );
}
