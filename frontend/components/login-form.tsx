"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard } from "@/components/auth-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  AuthError,
  authConfigured,
  googleEnabled,
  signIn,
  startGoogleSignIn,
  useSession,
} from "@/lib/auth";

export function LoginForm() {
  const router = useRouter();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in: straight to the app.
  useEffect(() => {
    if (session) router.replace("/home");
  }, [session, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/home");
    } catch (err) {
      if (
        err instanceof AuthError &&
        err.code === "UserNotConfirmedException"
      ) {
        router.push(`/signup?confirm=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  async function google() {
    setError(null);
    try {
      await startGoogleSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    }
  }

  return (
    <AuthCard
      title="Log in"
      description="Welcome back to Spry."
      footer={
        <>
          No account yet?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary hover:underline"
          >
            Create one
          </Link>
          {" · "}
          <Link
            href="/meetings"
            className="font-medium text-primary hover:underline"
          >
            Meetings
          </Link>
        </>
      }
    >
      {!authConfigured && (
        <Alert className="mb-4">
          <AlertDescription>
            Sign-in is not configured yet: run <code>make deploy-cognito</code>{" "}
            and restart the frontend. Meetings work without it.
          </AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit} className="grid gap-4">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending || !authConfigured}>
          {pending ? "Logging in..." : "Log in"}
        </Button>
      </form>
      {googleEnabled && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="w-full"
            onClick={google}
          >
            Continue with Google
          </Button>
        </>
      )}
    </AuthCard>
  );
}
