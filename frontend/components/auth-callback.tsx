"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { completeGoogleSignIn } from "@/lib/auth";

/** Where Google sign-in lands: trade the code for tokens, then go home. */
export function AuthCallback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // A code is single-use; React's dev double-effect must not spend it twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const failure = params.get("error_description") ?? params.get("error");
    if (failure || !code || !state) {
      queueMicrotask(() =>
        setError(failure ?? "No sign-in code was returned."),
      );
      return;
    }
    completeGoogleSignIn(code, state)
      .then(() => router.replace("/home"))
      .catch((err: Error) => setError(err.message));
  }, [params, router]);

  return (
    <AuthCard
      title={error ? "Sign-in failed" : "Signing you in..."}
      description={error ?? "One moment."}
      footer={
        error && (
          <Link href="/" className="font-medium text-primary hover:underline">
            Back to log in
          </Link>
        )
      }
    >
      {null}
    </AuthCard>
  );
}
