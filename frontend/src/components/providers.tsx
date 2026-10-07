import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "react-oidc-context";

import { authEnabled, oidcConfig } from "@/lib/auth";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
        },
      }),
  );

  // Built once: a new config object would make the provider start over.
  const [auth] = useState(() => (authEnabled ? oidcConfig() : null));

  const app = (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  // A build without the auth stack's outputs has no sign-in at all.
  return auth ? <AuthProvider {...auth}>{app}</AuthProvider> : app;
}
