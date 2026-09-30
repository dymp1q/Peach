import { Suspense } from "react";

import { AuthCallback } from "@/components/auth-callback";

export const metadata = { title: "Signing in | Spry" };

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallback />
    </Suspense>
  );
}
