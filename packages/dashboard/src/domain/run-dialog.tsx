// The dialog a check or a repair is run from, read top to bottom: make a token, paste it, press. It stays open on a refusal, which is said at the token's box, and closes when the run has read its pieces.

import type { Dialog as DialogParts } from "@base-ui/react/dialog";
import type { FormEvent, ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { Domain, Ran } from "@/domain/domain-queries";
import { Step } from "@/domain/step";
import { TokenBox } from "@/domain/token-box";
import { type Sent, useTokenRun } from "@/domain/token-run";
import { TokenWay } from "@/domain/token-way";
import type { Refused } from "@/lib/api";

/** The words of each run: the dialog's title, what the run does, its button, and the button while the run is on its way. */
const WORDS = {
  check: { title: "Check the domain", does: "Check changes nothing.", press: "Check", pressed: "Checking" },
  repair: { title: "Repair the domain", does: "Repair makes every piece match.", press: "Repair", pressed: "Repairing" },
} as const;

/** The dialog has the token's box alone. */
const NO_BOXES = [] as const;

/** What the dialog is drawn from. */
interface RunDialogProps {
  /** The dialog's hold: a button opens it with the run it sends, and the caller closes it by it. */
  readonly handle: DialogParts.Handle<Ran["run"]>;

  /** What a token must hold and where one is made, in the provider's words. */
  readonly form: Domain["form"];

  /** Sends the run. It answers the refusal, or nothing when the run read its pieces: the caller then closes the dialog. */
  readonly onRun: (run: Ran["run"], sent: Sent) => Promise<Refused | undefined>;
}

/** Draw the dialog of the run its opening button names. Cancel, Escape, and a press outside close it, but not while a run is on its way. */
export function RunDialog({ handle, form, onRun }: RunDialogProps): ReactNode {
  const { sheet, busy, saidAt, saidElsewhere, send, forget } = useTokenRun(NO_BOXES, onRun);

  return (
    <Dialog
      handle={handle}
      // A person cannot close it while a run is on its way; the caller closes it when the run is done.
      onOpenChange={(open, details) => (!open && busy !== undefined && details.reason !== "imperative-action" ? details.cancel() : undefined)}
      onOpenChangeComplete={(open) => (open ? undefined : forget())}
    >
      {({ payload }) => {
        const run = payload === "repair" ? "repair" : "check";
        const words = WORDS[run];
        const onSubmit = (event: FormEvent): void => {
          event.preventDefault();
          void send(run);
        };

        return (
          <DialogContent className="sm:max-w-md" showCloseButton={false}>
            <form ref={sheet} onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
              <DialogHeader>
                <DialogTitle>{words.title}</DialogTitle>
                <DialogDescription>{words.does}</DialogDescription>
              </DialogHeader>
              <ol className="flex flex-col gap-5">
                <Step number={1} title="Make a token">
                  <TokenWay form={form} />
                </Step>
                <Step number={2} title="Paste it">
                  <TokenBox refusal={saidAt("token")} />
                </Step>
              </ol>
              {saidElsewhere === undefined ? null : (
                <Alert variant="destructive">
                  <AlertDescription>{saidElsewhere}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" disabled={busy !== undefined} />}>Cancel</DialogClose>
                <Button type="submit" disabled={busy !== undefined}>
                  {busy === undefined ? null : <Spinner data-icon="inline-start" aria-hidden="true" />}
                  {busy === undefined ? words.press : words.pressed}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        );
      }}
    </Dialog>
  );
}
