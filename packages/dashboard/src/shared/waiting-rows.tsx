// The rows that stand in for a list or a screen that is on its way: grey lines of a table's height, under a rule.

import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

/** The rows drawn where no number is given. */
const ROWS = 5;

/** Draw the rows. */
export function WaitingRows({ rows = ROWS }: { readonly rows?: number }): ReactNode {
  return (
    <div data-slot="waiting-rows" className="flex flex-col border-t" aria-busy="true">
      {Array.from({ length: rows }, (_row, row) => row).map((row) => (
        <div key={row} className="flex h-11 items-center border-b px-6 max-md:px-4">
          <Skeleton className="h-4 w-full max-w-3xl" />
        </div>
      ))}
    </div>
  );
}
