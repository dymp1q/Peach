import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AgendaForm, type AgendaSeed } from "@/components/agenda-form";
import { shortTitle } from "@/components/meeting-list";
import { PageHeader } from "@/components/page-header";
import { PasteAgenda } from "@/components/paste-agenda";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Agenda } from "@/lib/api";
import { authEnabled } from "@/lib/auth";
import { parserEnabled, type ParseResult } from "@/lib/parser";

const when = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** One meeting: its agenda form, and Paste an agenda next to it. */
export function MeetingPage({ meetingId }: { meetingId: number }) {
  const queryClient = useQueryClient();
  const meeting = useQuery({
    queryKey: ["meeting", meetingId],
    queryFn: () => api.getMeeting(meetingId),
  });
  const agenda = useQuery({
    queryKey: ["agenda", meetingId],
    queryFn: () => api.getAgenda(meetingId),
  });
  // A new seed remounts the form: after a parse, and after a save.
  const [draft, setDraft] = useState<{
    seed: AgendaSeed;
    version: number;
  } | null>(null);

  if (meeting.error || agenda.error) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className="rounded-lg border border-destructive/40 bg-white px-4 py-3 text-sm text-destructive">
          Could not load this meeting:{" "}
          {(meeting.error ?? agenda.error)?.message}
        </p>
      </div>
    );
  }
  if (!meeting.data || agenda.data === undefined) {
    return <Skeleton className="h-96 w-full" />;
  }

  const seed = draft?.seed ?? fromSaved(agenda.data);
  const suggestion = draft?.seed.suggestion ?? null;
  const start = new Date(meeting.data.starts_at);

  const onParsed = (result: ParseResult) =>
    setDraft((d) => ({
      seed: {
        items: result.agenda.items,
        action_items: result.agenda.action_items,
        suggestion: result,
      },
      version: (d?.version ?? 0) + 1,
    }));

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="flex flex-col gap-2">
        <BackLink />
        <PageHeader title={shortTitle(meeting.data.title)} />
        <p className="text-sm text-muted-foreground">
          {when.format(start)} · {meeting.data.attendee_count}{" "}
          {meeting.data.attendee_count === 1 ? "attendee" : "attendees"}
          {agenda.data &&
            ` · agenda saved ${when.format(new Date(agenda.data.saved_at))}`}
        </p>
      </div>

      {authEnabled && parserEnabled && <PasteAgenda onParsed={onParsed} />}

      {suggestion && <AlsoMentioned result={suggestion} />}

      <AgendaForm
        key={draft?.version ?? 0}
        seed={seed}
        onSave={async (input) => {
          const saved = await api.saveAgenda(meetingId, input);
          queryClient.setQueryData(["agenda", meetingId], saved);
          setDraft((d) => ({
            seed: fromSaved(saved),
            version: (d?.version ?? 0) + 1,
          }));
          toast.success("Agenda saved");
        }}
      />
    </div>
  );
}

function fromSaved(agenda: Agenda | null): AgendaSeed {
  return {
    items: agenda?.items ?? [],
    action_items: agenda?.action_items ?? [],
    suggestion: null,
  };
}

/** What the text says about the meeting itself. Shown, never applied: the
 *  meeting's own title and time stay as they are. */
function AlsoMentioned({ result }: { result: ParseResult }) {
  const { title, starts_at, duration_minutes } = result.agenda;
  const parts = [
    title && `"${title}"`,
    starts_at &&
      !Number.isNaN(Date.parse(starts_at)) &&
      when.format(new Date(starts_at)),
    duration_minutes && `${duration_minutes} min`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <p className="-mt-4 text-xs text-muted-foreground">
      The text also mentions {parts.join(", ")}. The meeting itself is not
      changed.
    </p>
  );
}

function BackLink() {
  return (
    <a
      href="/"
      className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      All meetings
    </a>
  );
}
