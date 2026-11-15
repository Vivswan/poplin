// A question with one field: a dialog that asks for a value, and says a refusal at the field with the typed value kept.

import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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

  /** The value the field opens with. */
  readonly initial: string;

  /** The most characters the field takes. */
  readonly maxLength?: number;

  /** The words of the button that sends the value. */
  readonly submit: string;

  /** Sends the value. It answers the sentence of a refusal, which is shown at the field, or nothing when the change is done: the dialog then closes. */
  readonly onSubmit: (value: string) => Promise<string | undefined>;
}

/** Ask for one value in a dialog. The button stays off while the value is empty or unchanged. */
export function AskDialog({ open, onOpenChange, title, says, label, hint, initial, maxLength, submit, onSubmit }: AskDialogProps): ReactNode {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [refusal, setRefusal] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;

    setValue(initial);
    setRefusal(undefined);
  }, [open, initial]);

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const refused = await onSubmit(value.trim());
    setBusy(false);
    if (refused === undefined) onOpenChange(false);
    else setRefusal(refused);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(event) => void send(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{says}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={refusal !== undefined}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Input
              id={id}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              aria-invalid={refusal !== undefined}
              autoComplete="off"
              spellCheck={false}
              maxLength={maxLength}
              autoFocus
            />
            {refusal === undefined ? <FieldDescription>{hint}</FieldDescription> : <FieldError>{refusal}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || value.trim() === "" || value.trim() === initial}>
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
