// One setting of the Settings screen as a row. A wide column has the name at the left, with one short sentence and the default under it, and the control at the right.
// A narrow column keeps the sentence and the default behind a "?" beside the name. The narrowest one, a phone's, has a field under its name and a switch beside it.

import { cn } from "cn";
import { CircleHelpIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

/** What is shown only in a wide column: the column is the container the screen names. */
const WIDE_ONLY = "hidden @[600px]:block";

/** What is shown only in a narrow column. */
const NARROW_ONLY = "@[600px]:hidden";

/** What a row is drawn from. */
interface SettingFrameProps {
  /** The name of what is set. */
  readonly name: string;

  /** The id of the control: the name has this id with `-label` after it, for a control it names. */
  readonly controlId: string;

  /** The id of the row itself, where an address can name it. */
  readonly anchor?: string;

  /** `true` while the row is pointed out: it is shaded for a moment. */
  readonly marked?: boolean;

  /** What the setting does, in short sentences; an empty one is left out. */
  readonly says: readonly string[];

  /** The default as it is read, such as `7 days`; left out for what has none. */
  readonly fallback?: string;

  /** Puts the default back; given only while the value differs from it. */
  readonly onReset?: () => void;

  /** What the host warns of at this value. */
  readonly warnings?: readonly string[];

  /** The control, at its own width. */
  readonly children: ReactNode;

  /** The line under the control, drawn only while it has something to say: a refusal. The control is described by it, whatever kind of control it is. */
  readonly under?: ReactNode;

  /** `true` for a switch: on a phone it stays beside its name, where a field goes under it. */
  readonly beside?: boolean;
}

/** The way back to the default, named for its setting: every changed row has one. */
function Reset({ name, onReset }: { readonly name: string; readonly onReset: () => void }): ReactNode {
  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      className="h-auto min-h-0! border-0 p-0 align-baseline text-[13px] leading-[inherit] font-normal text-muted-foreground underline hover:text-foreground"
      aria-label={`Reset ${name}`}
      onClick={onReset}
    >
      Reset
    </Button>
  );
}

/** The "?" beside a name in a narrow column: it opens the sentences, the default, and the way back to it. */
function About({ name, says, fallback, onReset }: Pick<SettingFrameProps, "name" | "says" | "fallback" | "onReset">): ReactNode {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`About ${name}`} className={cn("text-muted-foreground", NARROW_ONLY)} />}
      >
        <CircleHelpIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-1.5">
        <PopoverTitle>{name}</PopoverTitle>
        <PopoverDescription render={<div />} className="flex flex-col gap-1.5 text-popover-foreground">
          {says.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
          {fallback === undefined ? null : (
            <p className="flex items-center gap-2 text-muted-foreground">
              Default: {fallback}
              {onReset === undefined ? null : <Reset name={name} onReset={onReset} />}
            </p>
          )}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

/** The mark after a control the host warns about: pointing at it or pressing it opens what the host says. */
function Warnings({ warnings }: { readonly warnings: readonly string[] }): ReactNode {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Warning" className="shrink-0 text-warn hover:text-warn" />}
      >
        <TriangleAlertIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="gap-1.5">
        <PopoverTitle>Warning</PopoverTitle>
        <PopoverDescription render={<div />} className="flex flex-col gap-1.5 text-popover-foreground">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

/** Draw one row. */
export function SettingFrame({
  name,
  controlId,
  anchor,
  marked = false,
  says,
  fallback,
  onReset,
  warnings = [],
  children,
  under,
  beside = false,
}: SettingFrameProps): ReactNode {
  const sentences = says.filter((sentence) => sentence !== "");
  const underId = `${controlId}-under`;
  // The control is drawn by the caller, in one of many kinds: the line under it is named at whatever holds the control's id once both are drawn.
  useLayoutEffect(() => {
    const control = document.getElementById(controlId);
    if (under === undefined) control?.removeAttribute("aria-describedby");
    else control?.setAttribute("aria-describedby", underId);
  });

  return (
    <div
      id={anchor}
      className={cn(
        "-mx-3 flex gap-x-6 gap-y-2 rounded-lg px-3 py-2.5 motion-safe:transition-colors",
        beside ? "items-center justify-between" : "flex-col",
        "@[480px]:grid @[480px]:grid-cols-[minmax(0,1fr)_16.5rem] @[480px]:items-center @[600px]:grid-cols-[minmax(0,1fr)_19rem] @[600px]:items-start",
        marked && "bg-muted/60",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <h3 id={`${controlId}-label`} className="leading-6 font-semibold">
            {name}
          </h3>
          {sentences.length === 0 && fallback === undefined ? null : <About name={name} says={sentences} fallback={fallback} onReset={onReset} />}
        </div>
        <p className={cn("text-muted-foreground", WIDE_ONLY)}>
          {sentences.join(" ")}
          {fallback === undefined ? null : ` (Default: ${fallback})`}
          {onReset === undefined ? null : (
            <>
              {" "}
              <Reset name={name} onReset={onReset} />
            </>
          )}
        </p>
      </div>
      <div className="flex max-w-full min-w-0 flex-col gap-1.5">
        <div className="flex min-h-8 max-w-full items-center gap-2">
          {children}
          {warnings.length === 0 ? null : <Warnings warnings={warnings} />}
        </div>
        {under === undefined ? null : (
          <div id={underId} className="text-[13px] leading-5 empty:hidden">
            {under}
          </div>
        )}
      </div>
    </div>
  );
}
