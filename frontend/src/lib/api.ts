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

export type Meeting = z.infer<typeof meetingSchema>;
export type MeetingInput = z.infer<typeof meetingInputSchema>;

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
};
