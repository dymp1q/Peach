import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "react-oidc-context";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  MAX_TEXT,
  ParseError,
  parseAgenda,
  type ParseResult,
} from "@/lib/parser";

/** Paste an agenda (lab 6): text in, a suggestion out. It never saves - the
 *  suggestion fills the agenda form, and the user saves that. */
export function PasteAgenda({
  onParsed,
}: {
  onParsed: (result: ParseResult) => void;
}) {
  const auth = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const elapsed = useElapsed(startedAt);

  // Leaving the page cancels a parse still running.
  useEffect(() => () => abort.current?.abort(), []);

  if (!auth.isAuthenticated || !auth.user) {
    return (
      <Panel title="Paste an agenda">
        <p className="text-sm text-muted-foreground">
          <a href="/login/" className="font-medium text-primary underline">
            Sign in
          </a>{" "}
          to paste an email or notes and get the agenda filled in for you.
        </p>
      </Panel>
    );
  }
  const token = auth.user.access_token;

  async function parse() {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setStartedAt(Date.now());
    try {
      onParsed(await parseAgenda(text, token, controller.signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(
        err instanceof ParseError ? err.message : "Something went wrong.",
      );
    } finally {
      setStartedAt(null);
      abort.current = null;
    }
  }

  const parsing = startedAt !== null;
  const tooLong = text.length > MAX_TEXT;

  return (
    <Panel
      title="Paste an agenda"
      subtitle="An email, a chat message or notes. You check the result before it is saved."
    >
      <div className="flex flex-col gap-3 rounded-lg border border-l-4 border-l-accent-purple bg-card p-4">
        <Label htmlFor="pasted" className="sr-only">
          Text with an agenda
        </Label>
        <textarea
          id="pasted"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={parsing}
          rows={6}
          placeholder="Пн 10:00, синк по прайсингу, 45 хв. 1) нові тарифи Pro — Олена, 15 хв 2) ..."
          aria-invalid={tooLong}
          className="w-full resize-y rounded-md border border-transparent bg-muted px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-60 aria-invalid:border-destructive"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className={
              tooLong
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {text.length.toLocaleString("en")} / {MAX_TEXT.toLocaleString("en")}
          </span>
          {parsing ? (
            <div className="flex items-center gap-3">
              <span role="status" className="text-sm text-muted-foreground">
                Reading the agenda… {elapsed}s
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => abort.current?.abort()}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={parse}
              disabled={!text.trim() || tooLong}
            >
              <Sparkles data-icon="inline-start" className="size-4" />
              Parse
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

/** Whole seconds since start, ticking while it is set. */
function useElapsed(start: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [start]);
  return start === null ? 0 : Math.max(0, Math.floor((now - start) / 1000));
}
