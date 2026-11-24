// The dialog that asks for the day something expires on. It holds the calendar, so a screen loads it only when a day is asked for.

import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError } from "@/components/ui/field";
import { thenHome } from "@/lib/focus";
import { momentIn, type TimeZoneChoice, useTimeZoneChoice } from "@/lib/timezone";
import { useOnePress } from "@/dialog/one-press";
import { dayOf, dayStart, firstDay } from "@/dialog/expiry/expiry-moments";

/** What the dialog is drawn from. */
interface ExpiryDayDialogProps {
  /** Whether the dialog is shown. */
  readonly open: boolean;

  /** What the dialog says under its title: what happens when the picked day starts. */
  readonly says: string;

  /** The word of the button that takes the picked day. */
  readonly yes: string;

  /** Called when the dialog closes: Cancel, Escape, a press outside, and a saved day close it. */
  readonly onClose: () => void;

  /** Takes the moment the picked day starts. It answers the sentence of a refusal, which is shown under the calendar with the day kept, or nothing when it is saved. */
  readonly onSave: (moment: number) => Promise<string | undefined>;

  /** What takes the focus when the dialog closes. */
  readonly returnTo: RefObject<HTMLElement | null>;
}

/** What the calendar starts from at a moment, in the time zone chosen: the day it marks as today, and the first day to pick. */
function daysAt(now: number, choice: TimeZoneChoice): { readonly today: Date; readonly first: Date } {
  return { today: dayOf(now, choice), first: firstDay(now, choice) };
}

/** Ask for the day something expires on: at that day's start in the time zone a person chose, which is written before it is taken. */
export function ExpiryDayDialog({ open, says, yes, onClose, onSave, returnTo }: ExpiryDayDialogProps): ReactNode {
  const [picked, setPicked] = useState<Date>();
  const [refusal, setRefusal] = useState<string>();
  const [choice] = useTimeZoneChoice();
  // Today and the first day to pick, as the dialog opened or the time zone last changed: a day picked before that is let go.
  const [days, setDays] = useState(() => daysAt(Date.now(), choice));
  // Which opening this is: an answer closes the opening it was asked in, and no later one.
  const opening = useRef(0);
  // The day that is picked now, for an answer that comes in later.
  const shown = useRef(picked);
  shown.current = picked;
  useEffect(() => {
    if (!open) return;

    opening.current += 1;
    setPicked(undefined);
    setRefusal(undefined);
    setDays(daysAt(Date.now(), choice));
  }, [open, choice]);

  const { press: save, busy } = useOnePress(async (): Promise<void> => {
    if (picked === undefined) return;

    const asked = opening.current;
    const refused = await onSave(dayStart(picked, choice));
    if (asked !== opening.current) return;

    if (refused === undefined) return onClose();

    // A refusal is about the day that was sent: it is not said of a day picked since.
    if (shown.current === picked) setRefusal(refused);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-xs" finalFocus={thenHome(returnTo)} nested>
        <DialogHeader>
          <DialogTitle>Pick a day</DialogTitle>
          <DialogDescription>{says}</DialogDescription>
        </DialogHeader>
        <Calendar
          mode="single"
          selected={picked}
          onSelect={(day) => {
            setPicked(day);
            // A refusal is about the day that was sent: it leaves with that day.
            setRefusal(undefined);
          }}
          today={days.today}
          disabled={{ before: days.first }}
          startMonth={days.first}
          defaultMonth={days.first}
          // The picked day keeps its fill while it is pointed at, in the dark look too.
          className="mx-auto bg-transparent p-0 dark:**:data-[selected-single=true]:hover:bg-primary dark:**:data-[selected-single=true]:hover:text-primary-foreground pointer-coarse:[--cell-size:--spacing(10)]"
        />
        {refusal === undefined ? (
          <p className="text-muted-foreground" aria-live="polite">
            {picked === undefined ? "No day picked." : `Expires ${momentIn(dayStart(picked, choice), choice)}`}
          </p>
        ) : (
          <Field invalid>
            <FieldError>{refusal}</FieldError>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked === undefined || busy} onClick={save}>
            {yes}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
