// One numbered step of a short list read top to bottom: its number, its few words, and what is done in it.

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

/** Draw one step as an item of a list. */
export function Step({ number, title, children }: { readonly number: number; readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <h2 className="flex items-center gap-2 font-medium">
        <Badge variant="secondary" className="size-5 rounded-full p-0 tabular-nums" aria-hidden="true">
          {number}
        </Badge>
        {title}
      </h2>
      {children}
    </li>
  );
}
