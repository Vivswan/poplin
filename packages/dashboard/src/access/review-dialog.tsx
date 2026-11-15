// The review of one waiting login: who asks, the code to hold against the terminal's, the box that says they match, and Allow or Deny. It is the only place a login's code is shown.

import { useMutation } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { Review } from "@/access/access-queries";
import { computerName, SCOPE_WORDS } from "@/access/access-values";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { shortMoment, wholeMoment } from "@/lib/sites";
import { PanelFact, PanelFacts } from "@/shared/side-panel";

/** The scopes a computer that asked for everything can be let in with, the one it asked for first. */
const CHOICES = ["admin", "publisher"] as const;

/** What the choice of less means, for a computer that asked for everything. */
const ASKED_EVERYTHING = "Everything means every site, the settings, and who has access.";

/** What a review is drawn from. */
interface ReviewDialogProps {
  /** The login under review; `undefined` shows no dialog. */
  readonly login: Review | undefined;

  /** The changes of the screen. */
  readonly actions: AccessActions;

  /** Called when the review ends: decided, gone, Escape, or a press outside. */
  readonly onClose: () => void;

  /** What takes the focus when the review closes: the control that opened it. */
  readonly returnTo?: RefObject<HTMLElement | null>;
}

/** What an allowed computer may change: the choice of two for one that asked for everything, plain words for one that did not. */
function ScopeChoice({
  asked,
  scope,
  onChoose,
}: {
  readonly asked: Review["scope"];
  readonly scope: Review["scope"];
  readonly onChoose: (scope: Review["scope"]) => void;
}): ReactNode {
  if (asked !== "admin") return SCOPE_WORDS[asked];

  return (
    <ToggleGroup
      aria-label="Can change"
      value={[scope]}
      onValueChange={(value) => (value[0] === undefined ? undefined : onChoose(value[0] as Review["scope"]))}
      variant="outline"
      size="sm"
      spacing={0}
      className="max-md:w-full"
    >
      {CHOICES.map((choice) => (
        <ToggleGroupItem key={choice} value={choice} className="w-31 aria-pressed:bg-chosen aria-pressed:font-bold max-md:min-h-10 max-md:w-auto max-md:flex-1">
          {SCOPE_WORDS[choice]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The inside of the review of one login. A login that follows another starts with an empty box. */
function ReviewForm({
  login,
  actions,
  onClose,
  under,
}: {
  readonly login: Review;
  readonly actions: AccessActions;
  readonly onClose: () => void;
  readonly under: RefObject<Review | undefined>;
}): ReactNode {
  const id = useId();
  const box = useRef<HTMLButtonElement>(null);
  const [ticked, setTicked] = useState(false);
  const [scope, setScope] = useState(login.scope);
  const [refusal, setRefusal] = useState<string>();
  const sending = useMutation({ mutationFn: (allow: boolean) => actions.decide(login, { allow, confirm: ticked, scope }) });
  const busy = sending.isPending;
  const name = computerName(login.computer);

  // The answer is acted on only while this login is still the one under review: a review that was left, even one still fading out, does not close the one that followed it.
  const decide = (allow: boolean): void =>
    sending.mutate(allow, {
      onSuccess: (decided) => {
        if (under.current?.id !== login.id) return undefined;

        if (decided.kind === "done" || decided.kind === "gone") return onClose();

        if (decided.kind !== "box") return undefined;

        setRefusal(decided.sentence);
        box.current?.focus();

        return undefined;
      },
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8" title={name.whole}>
          {name.given ? `Allow ${name.shown}?` : "Allow this computer?"}
        </DialogTitle>
        <DialogDescription>Allow it only if you started this login yourself.</DialogDescription>
      </DialogHeader>
      <PanelFacts>
        <PanelFact name="Asked">
          <time dateTime={new Date(login.asked).toISOString()} title={wholeMoment(login.asked)}>
            {shortMoment(login.asked)}
          </time>
        </PanelFact>
        <PanelFact name="Waits until">{wholeMoment(login.expires)}</PanelFact>
        <dt className="flex min-h-7 items-center text-muted-foreground max-md:col-span-2 max-md:min-h-0">Can change</dt>
        <dd className="flex min-h-7 items-center max-md:col-span-2">
          <ScopeChoice asked={login.scope} scope={scope} onChoose={setScope} />
        </dd>
      </PanelFacts>
      {login.scope === "admin" ? <p className="text-[13px] text-muted-foreground">{ASKED_EVERYTHING}</p> : null}
      <div className="flex flex-col gap-1 border-t pt-4">
        <p className="text-xs text-muted-foreground">Check it matches the code in your terminal</p>
        <p className="font-mono text-xs">{login.code}</p>
      </div>
      <Field orientation="horizontal" data-invalid={refusal !== undefined}>
        <Checkbox
          id={id}
          ref={box}
          checked={ticked}
          aria-invalid={refusal !== undefined}
          onCheckedChange={(checked) => {
            setTicked(checked);
            setRefusal(undefined);
          }}
        />
        <FieldContent>
          <FieldLabel htmlFor={id} className="font-normal">
            The codes match
          </FieldLabel>
          <div className="min-h-5 max-md:min-h-10">
            {refusal === undefined ? (
              <FieldDescription className="text-[13px]">Tick this to allow.</FieldDescription>
            ) : (
              <FieldError className="text-[13px]">{refusal}</FieldError>
            )}
          </div>
        </FieldContent>
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={() => decide(false)}>
          Deny
        </Button>
        <Button type="button" disabled={busy} onClick={() => decide(true)}>
          Allow
        </Button>
      </DialogFooter>
    </>
  );
}

/** Draw the review of a waiting login in a dialog over the lists. */
export function ReviewDialog({ login, actions, onClose, returnTo }: ReviewDialogProps): ReactNode {
  // The login stays while the dialog closes, so it does not empty as it fades.
  const last = useRef(login);
  if (login !== undefined) last.current = login;

  // The login under review at this moment: none while the dialog is closed or closing.
  const under = useRef(login);
  under.current = login;

  const shown = login ?? last.current;

  return (
    <Dialog open={login !== undefined} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="gap-4 sm:max-w-md" finalFocus={returnTo}>
        {shown === undefined ? null : <ReviewForm key={shown.id} login={shown} actions={actions} onClose={onClose} under={under} />}
      </DialogContent>
    </Dialog>
  );
}
