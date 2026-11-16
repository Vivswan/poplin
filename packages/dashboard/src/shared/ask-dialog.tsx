// A question with one field: a dialog that asks for a value, and says a refusal at the field with the typed value kept.

import { type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { thenHome } from "@/lib/focus";
import { useOnePress } from "@/dialog/one-press";

/** What the dialog is drawn from. */
interface AskDialogProps {
  /** Whether the dialog is shown. */
  readonly open: boolean;

  /** Called when the dialog asks to open or close: Cancel, Escape, a press outside, and a done change close it. */
  readonly onOpenChange: (open: boolean) => void;

  /** The dialog's heading. */
  readonly title: string;

  /** What the change does, under the title. */
  readonly says: string;

  /** The field's label, and the hint under it while nothing is refused. */
  readonly label: string;

  /** The hint under the field while nothing is refused. */
  readonly hint?: string;

  /** What stands under the field for the value it holds, in place of the hint. */
  readonly under?: (value: string) => ReactNode;

  /** The value the field opens with. */
  readonly initial: string;

  /** `true` where the value the field opens with is itself an answer: the button is then on for it. */
  readonly takesInitial?: boolean;

  /** What takes the focus when the dialog closes, for a dialog that is drawn anew at each opening and so knows no control that opened it. */
  readonly returnTo?: RefObject<HTMLElement | null>;

  /** The words of the button that sends the value. */
  readonly submit: string;

  /** Sends the value. It answers the sentence of a refusal, which is shown at the field, or nothing when the change is done: the dialog then closes. */
  readonly onSubmit: (value: string) => Promise<string | undefined>;
}

/** Ask for one value in a dialog. The button stays off while the value is empty, and while it is unchanged unless the value it opened with is an answer. */
export function AskDialog({ open, onOpenChange, title, says, label, hint, under, initial, takesInitial = false, returnTo, submit, onSubmit }: AskDialogProps): ReactNode {
  const [value, setValue] = useState(initial);
  const [refusal, setRefusal] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;

    setValue(initial);
    setRefusal(undefined);
  }, [open, initial]);

  const { press, busy } = useOnePress(async (): Promise<void> => {
    const refused = await onSubmit(value.trim());
    if (refused === undefined) return onOpenChange(false);

    setRefusal(refused);
    // The button that was pressed was off while the value was sent, which takes the focus from it: the field to correct takes it.
    field.current?.focus();
  });
  const send = (event: FormEvent): void => {
    event.preventDefault();
    press();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" finalFocus={thenHome(returnTo)}>
        <form onSubmit={send} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{says}</DialogDescription>
          </DialogHeader>
          <Field invalid={refusal !== undefined}>
            <FieldLabel>{label}</FieldLabel>
            <Input
              ref={field}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                // A refusal is about the value that was sent: it leaves with that value.
                setRefusal(undefined);
              }}
              onFocus={(event) => event.currentTarget.select()}
              autoComplete="off"
              spellCheck={false}
              aria-required
              autoFocus
            />
            {refusal === undefined ? (
              <FieldDescription>{under === undefined ? hint : under(value.trim())}</FieldDescription>
            ) : (
              <FieldError>{refusal}</FieldError>
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || value.trim() === "" || (!takesInitial && value.trim() === initial)}>
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
