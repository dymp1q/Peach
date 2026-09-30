"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated, useSession } from "@/lib/auth";

/**
 * Sends signed-out visitors to the login page. A convenience only: a static
 * export has no server to refuse a page, so the real boundary is the API,
 * which answers nothing without a valid token.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const session = useSession();

  useEffect(() => {
    if (hydrated && !session) router.replace("/");
  }, [hydrated, session, router]);

  if (!session) {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-4 px-6 py-12 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return children;
}
