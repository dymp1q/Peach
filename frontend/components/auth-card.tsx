import Link from "next/link";

/** The centred card every sign-in screen sits in. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-tint-green/40 px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md bg-primary font-heading text-sm leading-none font-semibold text-primary-foreground"
          >
            S
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">
            Spry
          </span>
        </Link>
        <div className="rounded-xl border border-l-4 border-border border-l-primary bg-card p-6 shadow-notion-sm">
          <h1 className="font-heading text-xl font-semibold">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
          <div className="mt-6">{children}</div>
        </div>
        {footer && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {footer}
          </p>
        )}
      </div>
    </main>
  );
}
