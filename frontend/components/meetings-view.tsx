"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { MeetingForm } from "@/components/meeting-form";
import { MeetingList } from "@/components/meeting-list";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { WeekStats } from "@/components/week-stats";
import { api, type Meeting, type MeetingInput } from "@/lib/api";

/** The meetings page: week-over-week stats, the form and the list. */
export function MeetingsView() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Meeting | null>(null);
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

  const remove = useMutation({
    mutationFn: (meeting: Meeting) => api.deleteMeeting(meeting.id),
    onSuccess: async (_result, meeting) => {
      setPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success(`Deleted "${meeting.title}"`);
    },
    onError: (err: Error) => toast.error(err.message),
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
          onDelete={setPendingDelete}
        />
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meeting?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{pendingDelete?.title}&quot; will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                // Keep the dialog open until the API has answered.
                event.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete);
              }}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
