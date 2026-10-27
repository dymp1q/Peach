import { z } from "zod";

import { actionItemSchema, agendaItemSchema } from "@/lib/api";

/** The agenda parser (lab 6): a Lambda function URL, compiled in at build
 *  time like the API's. Empty means this build has no Paste an agenda. */
export const parserUrl = import.meta.env.VITE_PARSER_URL ?? "";
export const parserEnabled = Boolean(parserUrl);

/** The parser refuses more than this with a 413; the screen says so first. */
export const MAX_TEXT = 10_000;

export const parsedAgendaSchema = z.object({
  title: z.string().nullable().default(null),
  starts_at: z.string().nullable().default(null),
  duration_minutes: z.number().int().nullable().default(null),
  items: z.array(agendaItemSchema),
  action_items: z.array(actionItemSchema).default([]),
  language: z.string(),
});

const parseResultSchema = z.object({
  agenda: parsedAgendaSchema,
  model: z.string(),
  prompt_version: z.string(),
});

export type ParsedAgenda = z.infer<typeof parsedAgendaSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;

export type ParseErrorKind =
  "too-long" | "no-agenda" | "busy" | "signed-out" | "network" | "unavailable";

const messages: Record<ParseErrorKind, string> = {
  "too-long": `The text is too long: at most ${MAX_TEXT.toLocaleString("en")} characters.`,
  "no-agenda":
    "Could not find an agenda in this text. Try another text, or type the agenda below.",
  busy: "The parser is busy right now. Try again in a minute, or type the agenda below.",
  "signed-out": "Your sign-in has expired. Sign in again to paste an agenda.",
  network: "Could not reach the parser. Check your connection and try again.",
  unavailable:
    "The parser is not available right now. You can type the agenda below.",
};

export class ParseError extends Error {
  constructor(readonly kind: ParseErrorKind) {
    super(messages[kind]);
    this.name = "ParseError";
  }
}

function kindOf(status: number): ParseErrorKind {
  if (status === 413) return "too-long";
  if (status === 422) return "no-agenda";
  if (status === 429) return "busy";
  if (status === 401) return "signed-out";
  return "unavailable";
}

/** Today and the time zone come from the browser: the user's "Monday" is in
 *  the user's week, not in the function's UTC. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function parseAgenda(
  text: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<ParseResult> {
  if (text.length > MAX_TEXT) throw new ParseError("too-long");
  let response: Response;
  try {
    response = await fetch(parserUrl, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        text,
        today: localToday(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
  } catch (err) {
    // Cancel is not an error to show: let the caller see the AbortError.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ParseError("network");
  }
  if (!response.ok) throw new ParseError(kindOf(response.status));
  const parsed = parseResultSchema.safeParse(await response.json());
  if (!parsed.success) throw new ParseError("unavailable");
  return parsed.data;
}
