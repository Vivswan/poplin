// What sets when something expires: the moment it is set to now, the menu of spans, a day, and never, and the calendar a day is picked in. A site's panel and a token's two dialogs draw it.

import { PencilIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { afterDays, type Expiry, expiryMoment, spanWords } from "@/dialog/expiry/expiry-moments";
import { momentIn } from "@/lib/timezone";
import { IconButton } from "@/shared/icon-button";

/** The dialog that asks for a day, read from the server when a day is first asked for: it holds the calendar. */
const ExpiryDayDialog = lazy(async () => ({ default: (await import("@/dialog/expiry/expiry-day-dialog")).ExpiryDayDialog }));

/** What the picker is drawn from. */
interface ExpiryPickerProps {
  /** When it expires as it is set now: never is then not offered again. */
  readonly expires: Expiry;

  /** The spans a person chooses between, in days from the moment the menu opened. */
  readonly spans: readonly number[];

  /** What the calendar says under its title: what happens when the picked day starts. */
  readonly daySays: string;

  /** Called with what a person chose: the moment a span ends, as the menu wrote it, or never. */
  readonly onChoose: (expires: Expiry) => void;

  /** Saves the moment a picked day starts, and answers the sentence of a refusal, which the calendar shows with the day kept. Left out, a day is a choice like the others, and the calendar's button says Pick. */
  readonly onDay?: (moment: number) => Promise<string | undefined>;

  /** Called with the moment the menu opens at. */
  readonly onOpen?: (now: number) => void;
}

/** Draw when something expires, with the pencil beside it that opens the menu of what it may be changed to. A choice saves nothing by itself: whoever draws the picker does. */
export function ExpiryPicker({ expires, spans, daySays, onChoose, onDay, onOpen }: ExpiryPickerProps): ReactNode {
  const opener = useRef<HTMLButtonElement>(null);
  // The moment the menu opened: each span is written as the moment it ends when counted from then, and a choice takes the moment that was written.
  const [opened, setOpened] = useState(() => Date.now());
  // The calendar is read from the server only once a day is asked for, and stays from then on.
  const [calendar, setCalendar] = useState<"unasked" | "open" | "closed">("unasked");
  const open = (): void => {
    const now = Date.now();
    setOpened(now);
    onOpen?.(now);
  };
  const takeDay = async (moment: number): Promise<string | undefined> => {
    if (onDay !== undefined) return onDay(moment);

    onChoose(moment);

    return undefined;
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{expiryMoment(expires)}</span>
        <DropdownMenu onOpenChange={(next) => (next ? open() : undefined)}>
          <IconButton label="Change when it expires" opens={<DropdownMenuTrigger ref={opener} type="button" />} className="-my-1 pointer-coarse:-my-2.5">
            <PencilIcon />
          </IconButton>
          <DropdownMenuContent align="start" className="w-64">
            {spans.map((days) => (
              <DropdownMenuItem key={days} onClick={() => onChoose(afterDays(days, opened))}>
                <span>{spanWords(days)}</span>
                <span className="ml-auto text-muted-foreground">{momentIn(afterDays(days, opened))}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => setCalendar("open")}>On a day...</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={expires === "never"} onClick={() => onChoose("never")}>
              Never
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {calendar === "unasked" ? null : (
        <Suspense fallback={null}>
          <ExpiryDayDialog open={calendar === "open"} says={daySays} yes={onDay === undefined ? "Pick" : "Save"} onClose={() => setCalendar("closed")} onSave={takeDay} returnTo={opener} />
        </Suspense>
      )}
    </>
  );
}
