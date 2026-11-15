// One setting of the Settings screen as a block that reads from top to bottom: its name, one short sentence, the control, and under the control the lines that are there only when needed.

import { cn } from "cn";
import type { ReactNode } from "react";

/** What a block is drawn from. */
interface SettingFrameProps {
  /** The name of what is set. */
  readonly name: string;

  /** The id of the control: the name has this id with `-label` after it, for a control it names. */
  readonly controlId: string;

  /** The id of the block itself, where an address can name it. */
  readonly anchor?: string;

  /** `true` while the block is pointed out: it is shaded for a moment. */
  readonly marked?: boolean;

  /** One short sentence that says what the setting does; empty for none. */
  readonly says: string;

  /** The control, at its own width. */
  readonly children: ReactNode;

  /** The lines under the control, each drawn only while it has something to say. */
  readonly under?: ReactNode;
}

/** Draw one block. */
export function SettingFrame({ name, controlId, anchor, marked = false, says, children, under }: SettingFrameProps): ReactNode {
  return (
    <div id={anchor} className={cn("-mx-3 mt-6 flex flex-col items-start rounded-lg px-3 py-2 motion-safe:transition-colors", marked && "bg-muted/60")}>
      <h3 id={`${controlId}-label`} className="text-base leading-6 font-semibold">
        {name}
      </h3>
      {says === "" ? null : <p className="text-muted-foreground">{says}</p>}
      <div className="mt-2.5 flex min-h-8 max-w-full items-center gap-2.5">{children}</div>
      {under === undefined ? null : <div className="mt-1.5 flex flex-col gap-1 text-[13px] leading-5 text-muted-foreground empty:hidden">{under}</div>}
    </div>
  );
}
