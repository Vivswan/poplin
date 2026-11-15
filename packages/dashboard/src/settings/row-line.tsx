// One line of the Settings screen, across the whole working area like a row of a table: the name of what is set with its question mark, and the control close after it, in a column where every control starts.

import { cn } from "cn";
import { CircleQuestionMarkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Hint } from "@/shared/hint";

/** The look every line of the screen shares: it runs from edge to edge with no rule under it, and a pointer over it shades it as a table's row; the names have one column as wide as the longest of them, the controls start a gap after it, and the room that is left stays empty at the right. Under the width of a tablet the control drops under the name. */
export const ROW_LOOK = "grid items-start gap-x-8 gap-y-1.5 px-6 py-2 hover:bg-muted/50 max-md:px-4 md:grid-cols-[18rem_minmax(0,1fr)]";

/** What a line is drawn from. */
interface RowLineProps {
  /** The plain name of what is set. */
  readonly label: string;

  /** The id of the control the name belongs to. */
  readonly controlId: string;

  /** The id of the line itself, where an address can name it. */
  readonly anchor?: string;

  /** `true` while the line is pointed out: it is shaded as under a pointer. */
  readonly marked?: boolean;

  /** What the question mark opens; left out, the line has no question mark. It is handed a function that closes it. */
  readonly about?: (close: () => void) => ReactNode;

  /** One line under the name, only where a person needs it to choose. */
  readonly help?: ReactNode;

  /** `true` for a control as small as a switch: on a phone it stays beside the name. */
  readonly small?: boolean;

  /** The sentence the value was refused with, shown under the control. */
  readonly refusal?: string;

  /** The control, and what stands after it. */
  readonly children: ReactNode;
}

/** Draw one line. */
export function RowLine({ label, controlId, anchor, marked = false, about, help, small = false, refusal, children }: RowLineProps): ReactNode {
  return (
    <div id={anchor} className={cn(ROW_LOOK, "motion-safe:transition-colors", marked && "bg-muted/50", small && "max-md:grid-cols-[minmax(0,1fr)_auto]")}>
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
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-h-8 min-w-0 items-center gap-1.5">{children}</div>
        {refusal === undefined ? null : <FieldError className="text-[13px]">{refusal}</FieldError>}
      </div>
    </div>
  );
}
