import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_PARSER_URL", "https://parser.example.com/");
const { MAX_TEXT, ParseError, localToday, parseAgenda } =
  await import("@/lib/parser");

const result = {
  agenda: {
    title: "Синк по прайсингу",
    starts_at: "2026-10-26T10:00:00+02:00",
    duration_minutes: 45,
    items: [{ topic: "Нові тарифи Pro", owner: "Олена", minutes: 15 }],
    action_items: [],
    language: "uk",
  },
  model: "anthropic.claude-opus-5-5",
  prompt_version: "agenda-v1",
};

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("parseAgenda", () => {
  it("sends the text, today, the time zone and the token", async () => {
    const spy = mockFetch(result);
    await expect(parseAgenda("Пн 10:00", "tok")).resolves.toEqual(result);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://parser.example.com/");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    const body = JSON.parse(init?.body as string);
    expect(body.text).toBe("Пн 10:00");
    expect(body.today).toBe(localToday());
    expect(body.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it.each([
    [413, "too-long"],
    [422, "no-agenda"],
    [429, "busy"],
    [401, "signed-out"],
    [502, "unavailable"],
  ])("maps %i to %s", async (status, kind) => {
    mockFetch({ error: "x" }, status);
    await expect(parseAgenda("text", "tok")).rejects.toMatchObject({ kind });
  });

  it("refuses a long text without calling the parser", async () => {
    const spy = mockFetch(result);
    await expect(
      parseAgenda("x".repeat(MAX_TEXT + 1), "tok"),
    ).rejects.toBeInstanceOf(ParseError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    await expect(parseAgenda("text", "tok")).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("lets Cancel through as an AbortError, not a message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("aborted", "AbortError"),
    );
    await expect(parseAgenda("text", "tok")).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("formats today in local time", () => {
    expect(localToday(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
  });
});
