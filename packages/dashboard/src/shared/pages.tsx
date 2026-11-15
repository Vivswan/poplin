// The ways to the first and the following page of a list, under its last row.

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** What the ways are drawn from. */
interface PagesProps {
  /** Goes to the first page; left out on the first page. */
  readonly onFirst?: () => void;

  /** Goes to the following page; left out on the last one. */
  readonly onNext?: () => void;

  /** Whether the page shown is being replaced: the way on waits. */
  readonly busy?: boolean;
}

/** Draw the ways. Nothing is drawn for a list that fits one page. */
export function Pages({ onFirst, onNext, busy = false }: PagesProps): ReactNode {
  if (onFirst === undefined && onNext === undefined) return null;

  return (
    <nav aria-label="Pages" className="flex shrink-0 items-center gap-2 px-6 py-3 max-md:px-4">
      {onFirst === undefined ? null : (
        <Button variant="outline" size="sm" onClick={onFirst}>
          First page
        </Button>
      )}
      {onNext === undefined ? null : (
        <Button variant="outline" size="sm" disabled={busy} onClick={onNext}>
          Next page
        </Button>
      )}
    </nav>
  );
}
