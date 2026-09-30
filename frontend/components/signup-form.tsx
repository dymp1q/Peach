"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  authConfigured,
  confirmSignUp,
  resendCode,
  signIn,
  signUp,
} from "@/lib/auth";

/** Two steps: create the account, then enter the code Cognito emails. */
export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Arriving from the login page with an unconfirmed account skips step one.
  const confirmEmail = params.get("confirm");

  const [step, setStep] = useState<"details" | "code">(
    confirmEmail ? "code" : "details",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState(confirmEmail ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function submitDetails(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      await signUp(name.trim(), email.trim(), password);
      setStep("code");
    });
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      await confirmSignUp(email.trim(), code.trim());
      if (password) {
        await signIn(email.trim(), password);
        router.replace("/home");
      } else {
        // Came from the login page: the password is not ours to keep.
        router.replace("/");
      }
    });
  }

  if (step === "code") {
    return (
      <AuthCard
        title="Check your email"
        description={
          <>
            We sent a code to <strong>{email}</strong>.
          </>
        }
      >
        <form onSubmit={submitCode} className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="code">Verification code</FieldLabel>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Checking..." : "Confirm"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(async () => {
                await resendCode(email.trim());
                setNotice("A new code is on its way.");
              })
            }
          >
            Send a new code
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create an account"
      description="Plan meetings with your team."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submitDetails} className="grid gap-4">
        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <FieldDescription>
            At least 8 characters, with a number and a letter.
          </FieldDescription>
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending || !authConfigured}>
          {pending ? "Creating..." : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
