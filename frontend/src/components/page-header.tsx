import * as React from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** Notion pages wear an emoji above the title; ours do too. */
  icon?: string;
  title: string;
  description?: React.ReactNode;
  /** Rendered at the trailing edge of the title row. */
  action?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  icon,
  title,
  description,
  action,
  className,
}: Props) {
  return (
    <div className={cn("grid gap-2", className)}>
      {icon && (
        <span aria-hidden className="text-[40px] leading-none">
          {icon}
        </span>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-heading text-[2.5rem] leading-[1.1] font-bold">
          {title}
        </h1>
        {action}
      </div>
      {description && (
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
