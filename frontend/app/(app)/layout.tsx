import { AuthGate } from "@/components/auth-gate";
import { SiteHeader } from "@/components/site-header";

export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthGate>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:px-8">
        {children}
      </main>
    </AuthGate>
  );
}
