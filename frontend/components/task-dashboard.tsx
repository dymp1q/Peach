"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, itemStatuses, type Item, type ItemStatus } from "@/lib/api";
import { statusMeta } from "@/lib/item-status";
import { cn } from "@/lib/utils";

/** Monday 00:00 of the current week, local time. */
function startOfWeek(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function StatusBar({
  counts,
  total,
}: {
  counts: Record<ItemStatus, number>;
  total: number;
}) {
  const [hovered, setHovered] = useState<ItemStatus | null>(null);

  return (
    <div className="grid gap-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={itemStatuses
          .map((s) => `${statusMeta[s].label}: ${counts[s]}`)
          .join(", ")}
      >
        {itemStatuses.map((status) =>
          counts[status] === 0 ? null : (
            <div
              key={status}
              className={cn(
                "relative h-full transition-opacity",
                statusMeta[status].mark,
                hovered && hovered !== status && "opacity-40",
              )}
              style={{ width: `${(counts[status] / total) * 100}%` }}
              onMouseEnter={() => setHovered(status)}
              onMouseLeave={() => setHovered(null)}
            />
          ),
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {itemStatuses.map((status) => (
          <li
            key={status}
            className={cn(
              "flex items-center gap-2 transition-opacity",
              hovered && hovered !== status && "opacity-40",
            )}
            onMouseEnter={() => setHovered(status)}
            onMouseLeave={() => setHovered(null)}
          >
            <span
              aria-hidden
              className={cn("size-2.5 rounded-full", statusMeta[status].mark)}
            />
            <span className="text-muted-foreground">
              {statusMeta[status].label}
            </span>
            <span className="font-medium tabular-nums">{counts[status]}</span>
            {hovered === status && total > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                ({Math.round((counts[status] / total) * 100)}%)
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemLines({ items, empty }: { items: Item[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="grid gap-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        >
          <span className="truncate">{item.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {shortDate.format(new Date(item.updated_at))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TaskDashboard() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["items"],
    queryFn: () => api.listItems({ limit: 100 }),
  });

  const header = (
    <PageHeader
      title="Home"
      description="How your tasks are moving this week."
      action={
        <Button asChild variant="outline">
          <Link href="/items">
            Open board
            <ArrowRight data-icon="inline-end" className="size-4" />
          </Link>
        </Button>
      }
    />
  );

  if (isPending) {
    return (
      <div className="grid gap-8">
        {header}
        <Skeleton className="h-36 w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="grid gap-8">
        {header}
        <Alert variant="destructive">
          <AlertTitle>Could not load your tasks</AlertTitle>
          <AlertDescription className="flex items-center gap-4">
            {error.message}
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const items = data.items;
  const total = items.length;
  const counts = Object.fromEntries(
    itemStatuses.map((s) => [s, items.filter((i) => i.status === s).length]),
  ) as Record<ItemStatus, number>;
  const donePercent = total === 0 ? 0 : Math.round((counts.done / total) * 100);

  const weekStart = startOfWeek();
  const addedThisWeek = items.filter(
    (i) => new Date(i.created_at) >= weekStart,
  ).length;
  const completedThisWeek = items.filter(
    (i) => i.status === "done" && new Date(i.updated_at) >= weekStart,
  ).length;

  const byRecent = (a: Item, b: Item) =>
    b.updated_at.localeCompare(a.updated_at);
  const inProgress = items
    .filter((i) => i.status === "in_progress")
    .sort(byRecent)
    .slice(0, 5);
  const recentlyDone = items
    .filter((i) => i.status === "done")
    .sort(byRecent)
    .slice(0, 5);

  return (
    <div className="grid gap-8">
      {header}

      <section className="grid gap-5 rounded-xl border border-l-4 border-border border-l-primary bg-card p-6 shadow-notion-xs">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Tasks done</p>
            <p className="font-heading text-5xl font-bold tracking-tight tabular-nums">
              {donePercent}%
            </p>
            <p className="text-sm text-muted-foreground">
              {counts.done} of {total} {total === 1 ? "task" : "tasks"}
            </p>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-muted-foreground">Added this week</p>
              <p className="text-2xl font-semibold tabular-nums">
                {addedThisWeek}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Completed this week</p>
              <p className="text-2xl font-semibold tabular-nums">
                {completedThisWeek}
              </p>
            </div>
          </div>
        </div>
        <meter
          className="sr-only"
          min={0}
          max={100}
          value={donePercent}
          aria-label="Share of tasks done"
        />
        {total > 0 ? (
          <StatusBar counts={counts} total={total} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No tasks yet - add one on the board.
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {itemStatuses.map((status) => (
          <Link
            key={status}
            href="/items"
            className={cn(
              "grid gap-1 rounded-xl border border-border p-4 transition hover:shadow-notion-sm",
              statusMeta[status].column,
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span
                aria-hidden
                className={cn("size-2 rounded-full", statusMeta[status].dot)}
              />
              {statusMeta[status].label}
            </span>
            <span className="font-heading text-3xl font-semibold tabular-nums">
              {counts[status]}
            </span>
          </Link>
        ))}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="grid content-start gap-3">
          <h2 className="font-heading text-lg font-semibold">In progress</h2>
          <ItemLines items={inProgress} empty="Nothing in progress." />
        </div>
        <div className="grid content-start gap-3">
          <h2 className="font-heading text-lg font-semibold">
            Recently completed
          </h2>
          <ItemLines items={recentlyDone} empty="Nothing completed yet." />
        </div>
      </section>
    </div>
  );
}
