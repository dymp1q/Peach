import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import { getIdToken, signOut } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({
  getIdToken: vi.fn(async () => "id-token"),
  signOut: vi.fn(),
}));

function mockFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("api", () => {
  it("parses a list response", async () => {
    mockFetch({ items: [], total: 0 });
    await expect(api.listItems()).resolves.toEqual({ items: [], total: 0 });
  });

  it("passes pagination through as query parameters", async () => {
    const spy = mockFetch({ items: [], total: 0 });
    await api.listItems({ limit: 5, offset: 10 });
    expect(spy.mock.calls[0][0]).toContain("/api/v1/items?limit=5&offset=10");
  });

  it("raises ApiError carrying the detail from the backend", async () => {
    mockFetch({ detail: "Item not found" }, { status: 404 });
    await expect(api.listItems()).rejects.toMatchObject({
      status: 404,
      message: "Item not found",
    });
  });

  it("sends the ID token as a bearer token", async () => {
    const spy = mockFetch({ items: [], total: 0 });
    await api.listItems();
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer id-token");
  });

  it("does not call the API at all when signed out", async () => {
    vi.mocked(getIdToken).mockResolvedValueOnce(null);
    const spy = mockFetch({ items: [], total: 0 });
    await expect(api.listItems()).rejects.toMatchObject({ status: 401 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("signs out when the API rejects the token", async () => {
    mockFetch({ detail: "Token expired" }, { status: 401 });
    await expect(api.listItems()).rejects.toMatchObject({ status: 401 });
    expect(signOut).toHaveBeenCalled();
  });

  it("deletes a meeting without sending a token", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => undefined,
    } as Response);
    await expect(api.deleteMeeting(7)).resolves.toBeUndefined();
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("/api/meetings/7");
    expect(init?.method).toBe("DELETE");
    expect(
      (init?.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it("raises ApiError when the network is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("failed");
    });
    await expect(api.listItems()).rejects.toBeInstanceOf(ApiError);
  });
});
