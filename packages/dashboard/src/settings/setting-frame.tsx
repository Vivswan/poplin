// One setting of the Settings screen as a row. A wide column has the name at the left, with one short sentence and the default under it, and the control at the right, with what the host warns of at its value in plain words under it.
// A narrow column keeps the sentence and the default behind a "?" beside the name. The narrowest one, a phone's, has a field under its name and a switch beside it.

import { Field } from "@base-ui/react/field";
import { cn } from "cn";
import { CircleHelpIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

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

  /** The line under the control, drawn only while it has something to say: a refusal, or a plain line. */
  readonly under?: ReactNode;

  /** `true` while the value is refused: the control is marked so. */
  readonly refused?: boolean;

  /** `true` for a switch: on a phone it stays beside its name, where a field goes under it. */
  readonly beside?: boolean;

  /** `true` for a setting that does nothing on this install: its control takes no change. */
  readonly idle?: boolean;
}

/** The way back to the default, named for its setting: every changed row has one. */
function Reset({ name, onReset }: { readonly name: string; readonly onReset: () => void }): ReactNode {
  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      className="border-0 p-0 align-baseline text-[13px] leading-[inherit] font-normal text-muted-foreground underline hover:text-foreground md:h-auto md:min-h-0!"
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

/** What the host warns of at the value a control holds: plain lines under the control, after a mark, each sentence a line of its own. They are read with no pointer and no press, and a screen reader hears them with the control. */
function Warnings({ warnings }: { readonly warnings: readonly string[] }): ReactNode {
  return (
    <Field.Description render={<div />} data-slot="setting-warnings" className="flex gap-1.5 text-[13px] leading-5 text-warn">
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="flex min-w-0 flex-col gap-1">
        {warnings.map((warning) => (
          <span key={warning}>{warning}</span>
        ))}
      </span>
    </Field.Description>
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
  refused = false,
  beside = false,
  idle = false,
}: SettingFrameProps): ReactNode {
  const sentences = says.filter((sentence) => sentence !== "");
  const about = `${sentences.join(" ")}${fallback === undefined ? "" : ` (Default: ${fallback})`}`;

  return (
    <Field.Root
      id={anchor}
      invalid={refused}
      disabled={idle}
      className={cn(
        "-mx-3 flex gap-x-6 gap-y-2 rounded-lg px-3 py-2.5 motion-safe:transition-colors",
        beside ? "items-center justify-between" : "flex-col",
        "@[480px]:grid @[480px]:grid-cols-[minmax(0,1fr)_16.5rem] @[480px]:items-center @[600px]:grid-cols-[minmax(0,1fr)_19rem] @[600px]:items-start",
        marked && "bg-muted/60",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <Field.Label nativeLabel={false} render={(props) => <h3 {...props} />} id={`${controlId}-label`} className="leading-6 font-semibold">
            {name}
          </Field.Label>
          {sentences.length === 0 && fallback === undefined ? null : <About name={name} says={sentences} fallback={fallback} onReset={onReset} />}
        </div>
        <p className={cn("text-muted-foreground", WIDE_ONLY)}>
          {about === "" ? null : <Field.Description render={<span />}>{about}</Field.Description>}
          {onReset === undefined ? null : (
            <>
              {" "}
              <Reset name={name} onReset={onReset} />
            </>
          )}
        </p>
      </div>
      <div className="flex max-w-full min-w-0 flex-col gap-1.5">
        <div className="flex min-h-8 max-w-full items-center gap-2">{children}</div>
        {warnings.length === 0 ? null : <Warnings warnings={warnings} />}
        {under === undefined ? null : <div className="text-[13px] leading-5 empty:hidden">{under}</div>}
      </div>
    </Field.Root>
  );
}
