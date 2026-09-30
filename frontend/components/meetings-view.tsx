"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { MeetingForm } from "@/components/meeting-form";
import { MeetingList } from "@/components/meeting-list";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WeekStats } from "@/components/week-stats";
import { api, type MeetingInput } from "@/lib/api";

/** The meetings page: week-over-week stats, the form and the list. */
export function MeetingsView() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["meetings"],
    queryFn: api.listMeetings,
  });

  const create = useMutation({
    mutationFn: (input: MeetingInput) => api.createMeeting(input),
    onSuccess: async (meeting) => {
      await queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success(`Added "${meeting.title}"`);
    },
  });

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Meetings"
        description="Every meeting on the team calendar, and how this week compares with the last."
      />

      {/* Stats depend on today's date, so they render in the browser only,
          once the list has arrived - never baked into the static export. */}
      {data ? (
        <WeekStats meetings={data} />
      ) : (
        <Skeleton className="h-44 w-full" />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[340px_1fr]">
        <MeetingForm
          onCreate={async (input) => {
            await create.mutateAsync(input);
          }}
        />
        <MeetingList
          meetings={data ?? []}
          loading={isPending}
          error={error?.message ?? null}
        />
      </div>
    </div>
  );
}
