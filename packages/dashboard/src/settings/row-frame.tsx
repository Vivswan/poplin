// The frame of one row of the Settings screen: what is set and what it means, the control, the default, and the state, in four cells whose edges line up down the whole screen.

import { cn } from "cn";
import type { ReactNode } from "react";

import { FieldDescription, FieldLabel } from "@/components/ui/field";

/** The four cells of a row, and of the headings above the rows. Under the width of a tablet they stand one under the other. */
export const ROW_GRID = "grid gap-x-6 gap-y-2 px-6 max-md:px-4 md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)_minmax(0,3fr)]";

/** What a row is drawn from. */
interface RowFrameProps {
  /** The plain name of what is set. */
  readonly label: string;

  /** The id of the control the name belongs to. */
  readonly controlId: string;

  /** What it means, in a line; empty for none. */
  readonly meaning: string;

  /** The setting's key as `poplin config` names it, shown small. */
  readonly rawKey?: string;

  /** The control, with its refusal under it. */
  readonly children: ReactNode;

  /** The default, as quiet words; left out for a row that names none. */
  readonly fallback?: ReactNode;

  /** The state at the row's end: that it was changed, or a warning. */
  readonly state?: ReactNode;
}

/** Draw one row. */
export function RowFrame({ label, controlId, meaning, rawKey, children, fallback, state }: RowFrameProps): ReactNode {
  return (
    <div className={cn(ROW_GRID, "items-start border-b py-3")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <FieldLabel id={`${controlId}-label`} htmlFor={controlId}>
            {label}
          </FieldLabel>
          {rawKey === undefined ? null : <code className="font-mono text-xs text-faint">{rawKey}</code>}
        </span>
        {meaning === "" ? null : <FieldDescription className="max-w-[60ch] text-[13px]">{meaning}</FieldDescription>}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
      <div className={cn("min-w-0 pt-1.5 text-[13px] leading-5 text-muted-foreground max-md:pt-0", fallback === undefined && "max-md:hidden")}>
        {fallback === undefined ? null : <span className="md:hidden">Default: </span>}
        {fallback}
      </div>
      <div className={cn("min-w-0 pt-1.5 text-[13px] leading-5 max-md:pt-0", state === undefined && "max-md:hidden")}>{state}</div>
    </div>
  );
}
