// The bar that floats over the foot of a screen while it holds changes that are not saved: how many there are, a button that drops them, and the one Save. It is drawn inside the screen's form, whose submit the Save is.

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** The room a scrolling box leaves under its last row while the bar floats over it, as a class. */
export const SAVE_BAR_ROOM = "pb-24";

/** What the bar is drawn from. */
interface SaveBarProps {
  /** How many changes wait; the bar is not drawn for none. */
  readonly count: number;

  /** Whether a save is on its way: both buttons wait for it. */
  readonly busy: boolean;

  /** Called by Discard. */
  readonly onDiscard: () => void;
}

/**
 * Draw the bar at the foot of the nearest positioned box, in its middle.
 *
 * The box it floats over leaves room under its last row for it: `SAVE_BAR_ROOM` is the class for that.
 */
export function SaveBar({ count, busy, onDiscard }: SaveBarProps): ReactNode {
  if (count === 0) return null;

  return (
    <section
      aria-label="Unsaved changes"
      className="absolute bottom-4 left-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border bg-popover py-2 pr-2 pl-4 text-popover-foreground shadow-lg"
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
