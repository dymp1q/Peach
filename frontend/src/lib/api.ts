import { z } from "zod";

/** Where the API lives. Compiled in at build time: http://localhost:8000 in
 *  development, https://api.<domain> for the deployed site. */
export function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || "http://localhost:8000";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Could not reach the API");
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new ApiError(
      response.status,
      detail ?? `Request failed (${response.status})`,
    );
  }

  if (response.status === 204) {
    return schema.parse(undefined);
  }
  return schema.parse(await response.json());
}

/* --- schemas mirroring the API contract in PROJECT.md section 4 --- */

export const meetingSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  starts_at: z.string(), // ISO 8601, UTC with "Z"
  ends_at: z.string(),
  attendee_count: z.number().int(),
});

export const meetingInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title is too long"),
  starts_at: z.string(),
  ends_at: z.string(),
  attendee_count: z.number().int().min(1).max(10_000),
});

export const agendaItemSchema = z.object({
  topic: z.string(),
  owner: z.string().nullable().default(null),
  minutes: z.number().int().nullable().default(null),
});

export const actionItemSchema = z.object({
  task: z.string(),
  owner: z.string().nullable().default(null),
  due: z.string().nullable().default(null), // YYYY-MM-DD
});

export const agendaSchema = z.object({
  meeting_id: z.number().int(),
  items: z.array(agendaItemSchema),
  action_items: z.array(actionItemSchema),
  ai_suggestion: z.record(z.string(), z.unknown()).nullable(),
  ai_model: z.string().nullable(),
  ai_prompt_version: z.string().nullable(),
  saved_at: z.string(),
});

export type Meeting = z.infer<typeof meetingSchema>;
export type MeetingInput = z.infer<typeof meetingInputSchema>;
export type AgendaItem = z.infer<typeof agendaItemSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type Agenda = z.infer<typeof agendaSchema>;

/** The body of POST /api/meetings/{id}/agenda. The ai_* fields carry what
 *  the parser suggested, when the form started from it. */
export type AgendaInput = {
  items: AgendaItem[];
  action_items: ActionItem[];
  ai_suggestion?: Record<string, unknown> | null;
  ai_model?: string | null;
  ai_prompt_version?: string | null;
};

/* --- endpoints --- */

export const api = {
  listMeetings: () => request("/api/meetings", z.array(meetingSchema)),

  createMeeting: (payload: MeetingInput) =>
    request("/api/meetings", meetingSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteMeeting: (id: number) =>
    request(`/api/meetings/${id}`, z.undefined(), { method: "DELETE" }),

  getMeeting: (id: number) => request(`/api/meetings/${id}`, meetingSchema),

  /** null when the meeting has no agenda yet. */
  getAgenda: async (id: number) => {
    try {
      return await request(`/api/meetings/${id}/agenda`, agendaSchema);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },

  saveAgenda: (id: number, payload: AgendaInput) =>
    request(`/api/meetings/${id}/agenda`, agendaSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
