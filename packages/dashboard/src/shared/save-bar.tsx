// The bar under a screen while it holds changes that are not saved: how many there are, a button that drops them, and the one Save. It is drawn inside the screen's form, whose submit the Save is.

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** What the bar is drawn from. */
interface SaveBarProps {
  /** How many changes wait; the bar is not drawn for none. */
  readonly count: number;

  /** Whether a save is on its way: both buttons wait for it. */
  readonly busy: boolean;

  /** Called by Discard. */
  readonly onDiscard: () => void;
}

/** Draw the bar as a row of its own: the last child of a column whose scrolling box stands over it, so it covers nothing. */
export function SaveBar({ count, busy, onDiscard }: SaveBarProps): ReactNode {
  if (count === 0) return null;

  return (
    <section
      aria-label="Unsaved changes"
      data-slot="save-bar"
      className="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-6 py-2 max-md:px-4"
    >
      <p aria-live="polite" className="mr-2 min-w-0 truncate font-medium">
        {count === 1 ? "1 unsaved change" : `${count} unsaved changes`}
      </p>
      <Button type="button" variant="ghost" disabled={busy} onClick={onDiscard}>
        Discard
      </Button>
      <Button type="submit" disabled={busy}>
        Save
      </Button>
    </section>
  );
}
