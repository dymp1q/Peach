/** The top bar: the Spry mark and the one page the site has. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-8 px-6 sm:px-8">
        <a href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-md bg-primary font-heading text-[13px] leading-none font-semibold text-primary-foreground"
          >
            S
          </span>
          <span className="font-heading text-[15px] font-semibold tracking-tight">
            Spry
          </span>
        </a>
        <nav className="flex items-center gap-1 text-sm">
          <a
            href="/"
            aria-current="page"
            className="rounded-md bg-accent px-2.5 py-1.5 font-medium text-foreground"
          >
            Meetings
          </a>
        </nav>
      </div>
    </header>
  );
}
