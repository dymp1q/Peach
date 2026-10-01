import { MeetingsView } from "@/components/meetings-view";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";

/** The whole app: one page that lists meetings and adds new ones. */
export function App() {
  return (
    <Providers>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:px-8">
        <MeetingsView />
      </main>
      <Toaster />
    </Providers>
  );
}
