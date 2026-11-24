// The dialog that changes when a token that works expires: later, sooner, or never. The choice is the one a login is approved with, and Save sends it.

import { type FormEvent, type ReactNode, type RefObject, useRef, useState } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { Token } from "@/access/access-queries";
import { computerName, SCOPE_WORDS } from "@/access/access-values";
import { ExpiresChoice } from "@/access/tokens/expires-choice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError } from "@/components/ui/field";
import type { Expiry } from "@/dialog/expiry/expiry-moments";
import { useOnePress } from "@/dialog/one-press";
import { thenHome } from "@/lib/focus";
import { PanelFact, PanelFacts } from "@/shared/side-panel";

/** What the dialog is drawn from. */
interface ChangeExpiryDialogProps {
  /** The token whose expiry is changed; `undefined` shows no dialog. */
  readonly token: Token | undefined;

  /** The changes of the screen. */
  readonly actions: AccessActions;

  /** Called when the dialog ends: saved, Cancel, Escape, or a press outside. */
  readonly onClose: () => void;
}

/** What the inside of the dialog is drawn from. */
interface ChangeExpiryFormProps extends Omit<ChangeExpiryDialogProps, "token"> {
  /** The token whose expiry is changed. */
  readonly token: Token;

  /** The token in the dialog at this moment: none while the dialog is closed or closing. */
  readonly under: RefObject<Token | undefined>;
}

/** The inside of the dialog for one token. It starts at when the token expires now, and Save is off until another moment is chosen. */
function ChangeExpiryForm({ token, actions, onClose, under }: ChangeExpiryFormProps): ReactNode {
  const [expires, setExpires] = useState<Expiry>(token.expires);
  const [refusal, setRefusal] = useState<string>();
  // The moment that is chosen now, for an answer that comes in later.
  const chosen = useRef(expires);
  chosen.current = expires;
  // The answer is acted on only while this token is the one in the dialog, so it never closes the dialog of another token.
  const { press: save, busy } = useOnePress(async (): Promise<void> => {
    const refused = await actions.changeExpiry(token, expires);
    if (under.current?.id !== token.id) return;

    if (refused === undefined) return onClose();

    // A refusal is about the moment that was sent: it is not said of a moment chosen since.
    if (chosen.current === expires) setRefusal(refused);
  });
  // A refusal is about the moment that was sent: it leaves with that moment.
  const choose = (next: Expiry): void => {
    setExpires(next);
    setRefusal(undefined);
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save();
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle className="pr-8">Change expiry</DialogTitle>
        <DialogDescription>Set when this token stops working.</DialogDescription>
      </DialogHeader>
      <PanelFacts>
        <PanelFact name="Name">
          <span className="wrap-anywhere">{computerName(token.note).shown}</span>
        </PanelFact>
        <PanelFact name="Can change">{SCOPE_WORDS[token.scope]}</PanelFact>
        <PanelFact name="Expires">
          <ExpiresChoice expires={expires} scope={token.scope} onChoose={choose} />
        </PanelFact>
      </PanelFacts>
      {refusal === undefined ? null : (
        <Field invalid>
          <FieldError>{refusal}</FieldError>
        </Field>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || expires === token.expires}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Draw the dialog that changes a token's expiry over the list. */
export function ChangeExpiryDialog({ token, actions, onClose }: ChangeExpiryDialogProps): ReactNode {
  // The token stays while the dialog closes, so it does not empty as it fades.
  const last = useRef(token);
  if (token !== undefined) last.current = token;

  const under = useRef(token);
  under.current = token;

  const shown = last.current;

  return (
    <Dialog open={token !== undefined} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="gap-4 sm:max-w-md" finalFocus={thenHome()}>
        {shown === undefined ? null : <ChangeExpiryForm key={shown.id} token={shown} actions={actions} onClose={onClose} under={under} />}
      </DialogContent>
    </Dialog>
  );
}
