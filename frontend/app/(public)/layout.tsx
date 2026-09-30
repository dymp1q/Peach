import { SiteHeader } from "@/components/site-header";

/** Pages anyone may open, signed in or not. */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:px-8">
        {children}
      </main>
    </>
  );
}
