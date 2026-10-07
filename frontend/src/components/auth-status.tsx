import { useAuth } from "react-oidc-context";

import { Button } from "@/components/ui/button";
import { cognitoLogoutUrl } from "@/lib/auth";

/** The header's trailing edge: Sign in, or who is signed in and Sign out. */
export function AuthStatus() {
  const auth = useAuth();

  if (auth.isLoading) {
    return <span className="text-sm text-muted-foreground">…</span>;
  }

  if (auth.isAuthenticated && auth.user) {
    const email = auth.user.profile.email ?? auth.user.profile.sub;
    const signOut = async () => {
      await auth.removeUser();
      window.location.assign(cognitoLogoutUrl());
    };
    return (
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <span
          className="truncate text-muted-foreground"
          title={email}
          data-testid="signed-in-email"
        >
          {email}
        </span>
        <Button variant="outline" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" asChild>
      <a href="/login/">Sign in</a>
    </Button>
  );
}
