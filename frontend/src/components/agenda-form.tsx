import { useState, type FormEvent } from "react";
import { Plus, Save, X } from "lucide-react";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionItem, AgendaInput, AgendaItem } from "@/lib/api";
import type { ParseResult } from "@/lib/parser";
import { cn } from "@/lib/utils";

type ItemRow = {
  key: number;
  topic: string;
  owner: string;
  minutes: string;
  suggested: Partial<Record<"topic" | "owner" | "minutes", boolean>>;
};

type ActionRow = {
  key: number;
  task: string;
  owner: string;
  due: string;
  suggested: Partial<Record<"task" | "owner" | "due", boolean>>;
};

let nextKey = 1;

const itemRow = (item?: AgendaItem, fromModel = false): ItemRow => ({
  key: nextKey++,
  topic: item?.topic ?? "",
  owner: item?.owner ?? "",
  minutes: item?.minutes ? String(item.minutes) : "",
  // Only a field the model filled is marked; an empty one stays plain.
  suggested: fromModel
    ? { topic: !!item?.topic, owner: !!item?.owner, minutes: !!item?.minutes }
    : {},
});

const actionRow = (action?: ActionItem, fromModel = false): ActionRow => ({
  key: nextKey++,
  task: action?.task ?? "",
  owner: action?.owner ?? "",
  due: action?.due ?? "",
  suggested: fromModel
    ? { task: !!action?.task, owner: !!action?.owner, due: !!action?.due }
    : {},
});

/** Where the form starts: the saved agenda, the parser's suggestion, or empty. */
export type AgendaSeed = {
  items: AgendaItem[];
  action_items: ActionItem[];
  suggestion: ParseResult | null;
};

/** A text field that shows a "suggested" badge until the user touches it. */
function Field({
  suggested,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { suggested?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      <Input {...props} className={cn(suggested && "bg-tint-yellow pr-20")} />
      {suggested && (
        <span
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded bg-tint-yellow-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-tint-yellow-foreground"
          data-testid="suggested"
        >
          suggested
        </span>
      )}
    </div>
  );
}

export function AgendaForm({
  seed,
  onSave,
}: {
  seed: AgendaSeed;
  onSave: (agenda: AgendaInput) => Promise<void>;
}) {
  const fromModel = seed.suggestion !== null;
  const [items, setItems] = useState<ItemRow[]>(() =>
    seed.items.length
      ? seed.items.map((i) => itemRow(i, fromModel))
      : [itemRow()],
  );
  const [actions, setActions] = useState<ActionRow[]>(() =>
    seed.action_items.map((a) => actionRow(a, fromModel)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Typing in a field takes it over from the model: the badge goes.
  const editItem =
    (key: number, field: "topic" | "owner" | "minutes") =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setItems((rows) =>
        rows.map((r) =>
          r.key === key
            ? {
                ...r,
                [field]: event.target.value,
                suggested: { ...r.suggested, [field]: false },
              }
            : r,
        ),
      );
  const editAction =
    (key: number, field: "task" | "owner" | "due") =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setActions((rows) =>
        rows.map((r) =>
          r.key === key
            ? {
                ...r,
                [field]: event.target.value,
                suggested: { ...r.suggested, [field]: false },
              }
            : r,
        ),
      );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const agendaItems = items
      .filter((r) => r.topic.trim())
      .map((r) => ({
        topic: r.topic.trim(),
        owner: r.owner.trim() || null,
        minutes: r.minutes ? Number(r.minutes) : null,
      }));
    if (agendaItems.length === 0) {
      setError("Add at least one topic.");
      return;
    }
    if (
      agendaItems.some(
        (i) => i.minutes !== null && !(i.minutes >= 1 && i.minutes <= 480),
      )
    ) {
      setError("Minutes must be between 1 and 480.");
      return;
    }
    const actionItems = actions
      .filter((r) => r.task.trim())
      .map((r) => ({
        task: r.task.trim(),
        owner: r.owner.trim() || null,
        due: r.due || null,
      }));

    setError(null);
    setSaving(true);
    try {
      await onSave({
        items: agendaItems,
        action_items: actionItems,
        // What the model suggested goes along, next to what was saved: the
        // difference between them is the parser's quality signal.
        ...(seed.suggestion && {
          ai_suggestion: seed.suggestion.agenda,
          ai_model: seed.suggestion.model,
          ai_prompt_version: seed.suggestion.prompt_version,
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Agenda"
      subtitle={
        fromModel
          ? "Suggested from the pasted text - check every field, then save."
          : undefined
      }
    >
      <form
        onSubmit={submit}
        className="flex flex-col gap-5 rounded-lg border border-l-4 border-l-accent-blue bg-card p-4"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Topics</legend>
          <div className="hidden grid-cols-[minmax(0,1fr)_10rem_6rem_2rem] gap-2 text-xs text-muted-foreground sm:grid">
            <span>Topic</span>
            <span>Owner</span>
            <span>Minutes</span>
          </div>
          {items.map((row, index) => (
            <div
              key={row.key}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_6rem_2rem]"
            >
              <Field
                aria-label={`Topic ${index + 1}`}
                value={row.topic}
                onChange={editItem(row.key, "topic")}
                suggested={row.suggested.topic}
                maxLength={500}
                placeholder="What to discuss"
              />
              <Field
                aria-label={`Owner of topic ${index + 1}`}
                value={row.owner}
                onChange={editItem(row.key, "owner")}
                suggested={row.suggested.owner}
                maxLength={200}
                placeholder="Owner"
              />
              <Field
                aria-label={`Minutes for topic ${index + 1}`}
                type="number"
                min={1}
                max={480}
                value={row.minutes}
                onChange={editItem(row.key, "minutes")}
                suggested={row.suggested.minutes}
                placeholder="min"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="self-center text-muted-foreground"
                aria-label={`Remove topic ${index + 1}`}
                onClick={() =>
                  setItems((rows) =>
                    rows.length > 1
                      ? rows.filter((r) => r.key !== row.key)
                      : [itemRow()],
                  )
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setItems((rows) => [...rows, itemRow()])}
          >
            <Plus data-icon="inline-start" className="size-3.5" />
            Add topic
          </Button>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Action items</legend>
          {actions.map((row, index) => (
            <div
              key={row.key}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_2rem]"
            >
              <Field
                aria-label={`Task ${index + 1}`}
                value={row.task}
                onChange={editAction(row.key, "task")}
                suggested={row.suggested.task}
                maxLength={500}
                placeholder="Task"
              />
              <Field
                aria-label={`Owner of task ${index + 1}`}
                value={row.owner}
                onChange={editAction(row.key, "owner")}
                suggested={row.suggested.owner}
                maxLength={200}
                placeholder="Owner"
              />
              <Field
                aria-label={`Due date of task ${index + 1}`}
                type="date"
                value={row.due}
                onChange={editAction(row.key, "due")}
                suggested={row.suggested.due}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="self-center text-muted-foreground"
                aria-label={`Remove task ${index + 1}`}
                onClick={() =>
                  setActions((rows) => rows.filter((r) => r.key !== row.key))
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setActions((rows) => [...rows, actionRow()])}
          >
            <Plus data-icon="inline-start" className="size-3.5" />
            Add action item
          </Button>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          disabled={saving}
          className="self-start"
        >
          <Save data-icon="inline-start" className="size-4" />
          {saving ? "Saving…" : "Save agenda"}
        </Button>
      </form>
    </Panel>
  );
}
