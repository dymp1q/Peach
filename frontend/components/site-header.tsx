"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

// Home and Board (the template's tasks) need Cognito sign-in, which lab 2
// does not use; their pages stay in the code but are left out of the menu.
const links = [{ href: "/meetings", label: "Meetings" }];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-8 px-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-md bg-primary font-heading text-[13px] leading-none font-semibold text-primary-foreground"
          >
            S
          </span>
          <span className="font-heading text-[15px] font-semibold tracking-tight">
            Spry
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {links.map((link) => {
            // "/" shows the meetings page too.
            const active =
              pathname.startsWith(link.href) ||
              (pathname === "/" && link.href === "/meetings");
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 font-medium transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {session && (
          <div className="ml-auto flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-6 place-items-center rounded-full bg-tint-green text-xs font-semibold text-tint-green-foreground"
            >
              {session.name.charAt(0).toUpperCase()}
            </span>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.email}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                signOut();
                router.replace("/meetings");
              }}
            >
              <LogOut data-icon="inline-start" className="size-4" />
              Log out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
