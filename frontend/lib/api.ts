import { z } from "zod";

import { getIdToken, signOut } from "@/lib/auth";

/** Browser code must reach the API through the published port; server components
 *  resolve the Compose service name instead. */
export function apiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.INTERNAL_API_URL ?? "http://backend:8000";
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
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
  { auth = true }: { auth?: boolean } = {},
): Promise<T> {
  // Every /api/v1 route needs a signed-in user; don't send what would bounce.
  // Public routes (meetings) go out without a token.
  const token = auth ? await getIdToken() : null;
  if (auth && !token) throw new ApiError(401, "You are signed out");

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Could not reach the API");
  }

  // The API no longer accepts this session (revoked, or the pool changed):
  // drop it, and the auth gate sends the user back to the login page.
  if (auth && response.status === 401) signOut();

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

/* --- schemas mirroring the API contract in README section 5 --- */

export const itemStatuses = ["todo", "in_progress", "done"] as const;
export const itemStatusSchema = z.enum(itemStatuses);

export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: itemStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const itemListSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int(),
});

export const healthSchema = z.object({
  status: z.string(),
  database: z.string(),
});

export const itemInputSchema = z.object({
  name: z.string().min(1, "Name is required").max(120, "Name is too long"),
  description: z.string().max(2000, "Description is too long").optional(),
  status: itemStatusSchema,
});

// Meetings: public, at /api/meetings (PROJECT.md section 4).
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

export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type Item = z.infer<typeof itemSchema>;
export type ItemList = z.infer<typeof itemListSchema>;
export type Health = z.infer<typeof healthSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;

/* --- endpoints --- */

export const api = {
  readiness: () => request("/api/v1/health/ready", healthSchema),

  listItems: (params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    const suffix = query.size > 0 ? `?${query}` : "";
    return request(`/api/v1/items${suffix}`, itemListSchema);
  },

  createItem: (payload: ItemInput) =>
    request("/api/v1/items", itemSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateItem: (id: string, payload: Partial<ItemInput>) =>
    request(`/api/v1/items/${id}`, itemSchema, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteItem: (id: string) =>
    request(`/api/v1/items/${id}`, z.undefined(), { method: "DELETE" }),

  listMeetings: () =>
    request("/api/meetings", z.array(meetingSchema), undefined, {
      auth: false,
    }),

  createMeeting: (payload: MeetingInput) =>
    request(
      "/api/meetings",
      meetingSchema,
      { method: "POST", body: JSON.stringify(payload) },
      { auth: false },
    ),

  deleteMeeting: (id: number) =>
    request(
      `/api/meetings/${id}`,
      z.undefined(),
      { method: "DELETE" },
      { auth: false },
    ),
};
