import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";

function mockFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const meeting = {
  id: 1,
  title: "Weekly planning",
  starts_at: "2026-10-01T09:00:00Z",
  ends_at: "2026-10-01T10:00:00Z",
  attendee_count: 6,
};

afterEach(() => vi.restoreAllMocks());

describe("api", () => {
  it("parses the meeting list", async () => {
    mockFetch([meeting]);
    await expect(api.listMeetings()).resolves.toEqual([meeting]);
  });

  it("posts a new meeting as JSON", async () => {
    const spy = mockFetch(meeting, { status: 201 });
    const input = {
      title: meeting.title,
      starts_at: meeting.starts_at,
      ends_at: meeting.ends_at,
      attendee_count: meeting.attendee_count,
    };
    await expect(api.createMeeting(input)).resolves.toEqual(meeting);
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("/api/meetings");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(input);
  });

  it("deletes a meeting by id", async () => {
    const spy = mockFetch(undefined, { status: 204 });
    await expect(api.deleteMeeting(7)).resolves.toBeUndefined();
    expect(spy.mock.calls[0][0]).toContain("/api/meetings/7");
    expect(spy.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("sends no Authorization header: the site has no sign-in", async () => {
    const spy = mockFetch([]);
    await api.listMeetings();
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("raises ApiError carrying the detail from the backend", async () => {
    mockFetch({ detail: "Meeting not found" }, { status: 404 });
    await expect(api.deleteMeeting(9)).rejects.toMatchObject({
      status: 404,
      message: "Meeting not found",
    });
  });

  it("rejects a response that breaks the contract", async () => {
    mockFetch([{ id: "not-a-number", title: 1 }]);
    await expect(api.listMeetings()).rejects.toThrow();
  });

  it("raises ApiError when the network is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("failed");
    });
    await expect(api.listMeetings()).rejects.toBeInstanceOf(ApiError);
  });
});
