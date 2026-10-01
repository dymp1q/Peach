import { useState, type ChangeEvent, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MeetingInput } from "@/lib/api";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function initialValues() {
  const start = new Date();
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return {
    title: "",
    date: toDateInput(start),
    startTime: toTimeInput(start),
    endTime: toTimeInput(end),
    attendees: "2",
  };
}

export function MeetingForm({
  onCreate,
}: {
  onCreate: (meeting: MeetingInput) => Promise<void>;
}) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set =
    (field: keyof typeof values) => (event: ChangeEvent<HTMLInputElement>) =>
      setValues((v) => ({ ...v, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Date + time are the viewer's local time; the API gets UTC.
    const startsAt = new Date(`${values.date}T${values.startTime}`);
    const endsAt = new Date(`${values.date}T${values.endTime}`);
    // An end time earlier than the start runs past midnight: 23:00-00:30.
    if (values.endTime < values.startTime) endsAt.setDate(endsAt.getDate() + 1);
    if (endsAt <= startsAt) {
      setError("The meeting must end after it starts.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onCreate({
        title: values.title.trim(),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        attendee_count: Number(values.attendees),
      });
      setValues(initialValues());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="New meeting">
      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-lg border border-l-4 border-l-accent-blue bg-card p-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={values.title}
            onChange={set("title")}
            placeholder="Weekly planning"
            maxLength={200}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={values.date}
            onChange={set("date")}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="start">Starts</Label>
            <Input
              id="start"
              type="time"
              value={values.startTime}
              onChange={set("startTime")}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="end">Ends</Label>
            <Input
              id="end"
              type="time"
              value={values.endTime}
              onChange={set("endTime")}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="attendees">Attendees</Label>
          <Input
            id="attendees"
            type="number"
            min={1}
            max={10000}
            value={values.attendees}
            onChange={set("attendees")}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={saving}>
          <Plus data-icon="inline-start" className="size-4" />
          {saving ? "Adding…" : "Add meeting"}
        </Button>
      </form>
    </Panel>
  );
}
