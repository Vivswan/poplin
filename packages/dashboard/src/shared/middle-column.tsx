// The column a screen of words and short rows is read in: no wider than a set width, and in the middle of a wider screen, so a name and what belongs to it are never a whole screen apart.
// And the page such a screen is: everything under the screen's heading scrolls as one, with one bar at the window's edge. A table in it is as tall as its rows and has no bar of its own to go up and down.

import { cn } from "cn";
import type { ReactNode } from "react";

/** What the column is drawn from. */
interface MiddleColumnProps {
  /** `true` where what stands in the column brings the room at its two sides itself, as a table and its tools do: the column is wider by that room, so its words start where a column without it starts. */
  readonly gutters?: boolean;

  /** More of its look, such as how it lays out what stands in it. */
  readonly className?: string;

  /** What stands in it. */
  readonly children: ReactNode;
}

/**
 * Draw the page of a screen whose tables are short: the one part of the screen that scrolls up and down.
 *
 * The room of its bar is kept also while nothing scrolls, so the column does not move sideways when a list grows past the window.
 */
export function ScreenPage({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div data-slot="screen-page" className="line-room min-h-0 min-w-0 flex-1 overflow-y-auto pb-6 [scrollbar-gutter:stable]">
      {children}
    </div>
  );
}

/** Draw the column. What stands in it can ask how wide it is. */
export function MiddleColumn({ gutters = false, className, children }: MiddleColumnProps): ReactNode {
  return (
    <div data-slot="middle-column" className={cn("@container mx-auto w-full", gutters ? "max-w-[1148px]" : "max-w-[1100px]", className)}>
      {children}
    </div>
  );
}
