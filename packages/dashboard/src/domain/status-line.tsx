// The one line that says how the domain stands: a mark, the count, and small beside it when it was last looked at.

import type { ReactNode, Ref } from "react";

import { type Tone, ToneMark } from "@/domain/tone-mark";

/** What the line is drawn from. */
interface StatusLineProps {
  /** The count, such as `2 to repair`. */
  readonly line: string;

  /** How the count is read: nothing is left, work is left, or nothing is known. */
  readonly tone: Tone;

  /** What stands small beside the count, such as when the run was. */
  readonly beside?: ReactNode;

  /** The line itself, for a screen that moves the focus to it after a run. */
  readonly head?: Ref<HTMLDivElement>;
}

/** Draw the line. */
export function StatusLine({ line, tone, beside, head }: StatusLineProps): ReactNode {
  return (
    <div ref={head} tabIndex={-1} role="status" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 outline-none">
      <span className="flex items-center gap-2 font-medium">
        <ToneMark tone={tone} />
        {line}
      </span>
      {beside === undefined ? null : <span className="text-xs text-muted-foreground">{beside}</span>}
    </div>
  );
}
