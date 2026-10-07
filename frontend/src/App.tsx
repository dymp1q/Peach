import { useEffect, useState } from "react";

import { CallbackPage, LoginPage } from "@/components/auth-pages";
import { MeetingsView } from "@/components/meetings-view";
import { PrivacyPage } from "@/components/privacy-page";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import { CALLBACK_PATH } from "@/lib/auth";

/** The whole app: the meetings page, plus sign-in and privacy. CloudFront
 *  serves index.html for every page path, so the path picks the page here. */
export function App() {
  const path = usePath();

  return (
    <Providers>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:px-8">
        <Page path={path} />
      </main>
      <Toaster />
    </Providers>
  );
}

function Page({ path }: { path: string }) {
  switch (withSlash(path)) {
    case "/login/":
      return <LoginPage />;
    case CALLBACK_PATH:
      return <CallbackPage />;
    case "/privacy/":
      return <PrivacyPage />;
    default:
      return <MeetingsView />;
  }
}

/** /login and /login/ are the same page. */
function withSlash(path: string) {
  return path.endsWith("/") ? path : `${path}/`;
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path;
}
