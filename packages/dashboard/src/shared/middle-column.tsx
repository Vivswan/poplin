// The column a screen of words and short rows is read in: no wider than a set width, and in the middle of a wider screen, so a name and what belongs to it are never a whole screen apart.

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

/** Draw the column. What stands in it can ask how wide it is. */
export function MiddleColumn({ gutters = false, className, children }: MiddleColumnProps): ReactNode {
  return (
    <div data-slot="middle-column" className={cn("@container mx-auto w-full", gutters ? "max-w-[1148px]" : "max-w-[1100px]", className)}>
      {children}
    </div>
  );
}
