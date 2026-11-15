// The small mark that says how a state of the domain is read: it stands, it needs work, or nothing is known. Its shape says it, so the colour is not needed.

import { cn } from "cn";
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The mark of each way a state is read, and the mark's colour. */
const MARKS = {
  good: { icon: CircleCheckIcon, look: "text-good" },
  bad: { icon: CircleAlertIcon, look: "text-destructive" },
  idle: { icon: CircleDashedIcon, look: "text-faint" },
} as const;

/** How a state is read. */
export type Tone = keyof typeof MARKS;

/** Draw the mark of one tone. */
export function ToneMark({ tone, className }: { readonly tone: Tone; readonly className?: string }): ReactNode {
  const { icon: Mark, look } = MARKS[tone];

  return <Mark className={cn("size-4 shrink-0", look, className)} aria-hidden="true" />;
}
