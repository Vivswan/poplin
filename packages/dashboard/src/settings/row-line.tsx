// One line of the Settings screen, across the whole working area like a row of a table: the name of what is set with its question mark at the left, and the control at the right edge, where every control ends.

import { cn } from "cn";
import { CircleQuestionMarkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Hint } from "@/shared/hint";

/** The look every line of the screen shares: its rule runs from edge to edge, a pointer over it shades it as a table's row, and under the width of a tablet the control drops under the name. */
export const ROW_LOOK = "grid items-start gap-x-6 gap-y-1.5 border-b px-6 py-2.5 hover:bg-muted/50 max-md:px-4 md:grid-cols-[minmax(0,1fr)_auto]";

/** What a line is drawn from. */
interface RowLineProps {
  /** The plain name of what is set. */
  readonly label: string;

  /** The id of the control the name belongs to. */
  readonly controlId: string;

  /** What the question mark opens; left out, the line has no question mark. It is handed a function that closes it. */
  readonly about?: (close: () => void) => ReactNode;

  /** One line under the name, only where a person needs it to choose. */
  readonly help?: ReactNode;

  /** `true` for a control as small as a switch: on a phone it stays beside the name. */
  readonly small?: boolean;

  /** The sentence the value was refused with, shown under the control. */
  readonly refusal?: string;

  /** What stands beside the control, then the control, which ends the line. */
  readonly children: ReactNode;
}

/** Draw one line. */
export function RowLine({ label, controlId, about, help, small = false, refusal, children }: RowLineProps): ReactNode {
  return (
    <div className={cn(ROW_LOOK, small && "max-md:grid-cols-[minmax(0,1fr)_auto]")}>
      <div className="flex min-w-0 flex-col">
        <span className="flex min-h-8 min-w-0 items-center gap-1">
          <FieldLabel id={`${controlId}-label`} htmlFor={controlId} className="font-normal">
            {label}
          </FieldLabel>
          {about === undefined ? null : (
            <Hint label={`About: ${label}`} icon={<CircleQuestionMarkIcon />}>
              {about}
            </Hint>
          )}
        </span>
        {help === undefined ? null : <FieldDescription className="-mt-1 pb-1 text-[13px]">{help}</FieldDescription>}
      </div>
      <div className="flex min-w-0 flex-col gap-1 md:items-end">
        <div className="flex min-h-8 min-w-0 items-center gap-1.5 max-md:w-full">{children}</div>
        {refusal === undefined ? null : <FieldError className="text-[13px] md:text-right">{refusal}</FieldError>}
      </div>
    </div>
  );
}
