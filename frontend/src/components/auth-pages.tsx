import { useEffect, useRef } from "react";
import { useAuth } from "react-oidc-context";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { authEnabled } from "@/lib/auth";

/** /login/ - the URL that gets submitted. It starts the sign-in here, in the
 *  app, so the library can store its state and PKCE verifier before the
 *  browser leaves for Cognito's managed login (email + password, or Continue
 *  with Google). A hand-copied Cognito URL would come back with a state the
 *  app never issued, and the code would be rejected. */
export function LoginPage() {
  if (!authEnabled) {
    return <Message title="Sign-in is not configured in this build" />;
  }
  return <LoginRedirect />;
}

function LoginRedirect() {
  const auth = useAuth();
  // StrictMode runs effects twice in development; redirect once.
  const started = useRef(false);

  useEffect(() => {
    if (auth.isLoading || started.current) return;
    if (auth.isAuthenticated) {
      window.location.replace("/");
      return;
    }
    started.current = true;
    void auth.signinRedirect();
  }, [auth]);

  if (auth.error) {
    return <SignInError message={auth.error.message} />;
  }
  return <Message title="Redirecting to sign-in…" />;
}

/** /auth/callback/ - Cognito sends the browser back here with ?code=&state=.
 *  The provider exchanges the code on its own and then moves to /. */
export function CallbackPage() {
  if (!authEnabled) {
    return <Message title="Sign-in is not configured in this build" />;
  }
  return <CallbackStatus />;
}

function CallbackStatus() {
  const auth = useAuth();
  if (auth.error) {
    return <SignInError message={auth.error.message} />;
  }
  return <Message title="Signing you in…" />;
}

function SignInError({ message }: { message: string }) {
  return (
    <Message title="Sign-in failed">
      <p className="text-muted-foreground">{message}</p>
      <Button asChild>
        <a href="/login/">Try again</a>
      </Button>
    </Message>
  );
}

function Message({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid justify-items-start gap-4">
      <PageHeader title={title} />
      {children}
    </div>
  );
}
