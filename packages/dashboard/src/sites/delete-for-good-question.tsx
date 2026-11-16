// The question before a site in the trash is deleted for good. It is drawn once on the Sites screen, outside the row or the panel that asks it, so a press in it is no press on that row.
// The button that asks is the question's trigger, joined to it by the dialog library's handle: the library opens the question with what the button asks, and gives the focus back to the button.

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { answerOf, api } from "@/lib/api";
import { thenHome } from "@/lib/focus";
import { sayDone, unsay } from "@/lib/notify";
import { LONGEST_NAME, type Site, shownName } from "@/lib/sites";
import { useOnePress } from "@/dialog/one-press";
import { trashLine } from "@/sites/site-actions";
import { SITES_KEY, siteKey } from "@/sites/site-queries";

/** What joins the one question drawn on the screen to every button that asks it. */
export const DELETE_FOR_GOOD = AlertDialogPrimitive.createHandle<Asked>();

/** What is asked: the site to delete for good, and what follows. */
interface Asked {
  /** The site, which is in the trash. */
  readonly site: Site;

  /** Called once the site is gone, before the list is read again. */
  readonly onGone: () => void;
}

/** A delete as it is sent: the site, and the asking it was answered in. What a button asks is made anew at every draw, so the asking is told by its number. */
interface Sent {
  readonly site: Site;
  readonly asking: number;
}

/** What an open question is drawn from. */
interface AnswerProps {
  /** What is asked. */
  readonly asked: Asked;

  /** The number of this asking. */
  readonly asking: number;

  /** The delete of the screen: what it was sent for, and what became of it. */
  readonly removal: UseMutationResult<unknown, Error, Sent>;

  /** Sends the delete of this asking, and answers once it is done or refused. */
  readonly onRemove: () => Promise<unknown>;
}

/** What an open question shows: the field for the site's name, and the button that stays off until the name is typed. It is drawn anew with each asking, so each starts with an empty field. */
function Answer({ asked, asking, removal, onRemove }: AnswerProps): ReactNode {
  const { site } = asked;
  const cancel = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  // What the last delete was refused with is said in the asking it was sent from alone.
  const refusal = removal.variables?.asking === asking ? removal.error?.message : undefined;
  const { press, busy } = useOnePress(onRemove);
  const remove = (event: FormEvent): void => {
    event.preventDefault();
    if (typed === site.name) press();
  };

  return (
    <AlertDialogContent initialFocus={cancel} finalFocus={thenHome()}>
      <form onSubmit={remove} className="flex flex-col gap-4">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {shownName(site)} for good?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone, and the site's files go too.</AlertDialogDescription>
        </AlertDialogHeader>
        <Field invalid={refusal !== undefined}>
          <FieldLabel>Site's name</FieldLabel>
          <Input
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              // A refusal is about the delete that was sent: it leaves when the name is typed again. A delete on its way is left to end.
              if (!removal.isPending) removal.reset();
            }}
            aria-required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={LONGEST_NAME}
          />
          <FieldDescription>
            Type <span className="font-mono text-xs text-foreground">{site.name}</span> to delete it.
          </FieldDescription>
          {refusal === undefined ? null : <FieldError>{refusal}</FieldError>}
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction type="submit" variant="destructive" disabled={typed !== site.name || busy}>
            Delete for good
          </AlertDialogAction>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  );
}

/**
 * Draw the question that is asked, and delete the site once it is answered: the button that does it stays off until the site's name is typed.
 *
 * A refusal is said at the field with the typed name kept. A done delete is said in one line with no Undo, and the lists are read again.
 */
export function DeleteForGoodQuestion(): ReactNode {
  const client = useQueryClient();
  // How often the question was asked, and the number of the asking that is open.
  const [asking, setAsking] = useState(0);
  const open = useRef<number | undefined>(undefined);
  // A done delete is said and the lists are read again, also where its screen was left meanwhile. The site that is gone is forgotten, not read again, which would only be refused.
  const removal = useMutation({
    mutationFn: (sent: Sent) => answerOf(api.sites[":site"]["delete-for-good"].$post({ param: { site: sent.site.label }, json: {} })),
    onSuccess: (_done, sent) => {
      client.removeQueries({ queryKey: siteKey(sent.site.label) });
      void client.invalidateQueries({ queryKey: SITES_KEY, predicate: (query) => query.queryKey[1] !== "one" });
      // The line that said the site went to the trash offers an Undo no site is left for: it leaves.
      unsay(trashLine(sent.site));
      sayDone(`${shownName(sent.site)} deleted for good.`);
    },
  });
  // What only this screen does about a done delete, which the query library leaves out once the screen was left: it closes the asking the delete was sent from, and no other one that is open by then, and tells the screen that the site is gone.
  const remove = (asked: Asked, sent: number): Promise<unknown> => {
    const onSuccess = (): void => {
      if (open.current === sent) DELETE_FOR_GOOD.close();

      asked.onGone();
    };

    // A refusal is said at the field, from what the delete holds.
    return removal.mutateAsync({ site: asked.site, asking: sent }, { onSuccess }).catch(() => undefined);
  };

  return (
    <AlertDialog
      handle={DELETE_FOR_GOOD}
      onOpenChange={(opens) => {
        open.current = opens ? asking + 1 : undefined;
        if (opens) setAsking(asking + 1);
      }}
    >
      {({ payload: asked }) => (asked === undefined ? null : <Answer key={asking} asked={asked} asking={asking} removal={removal} onRemove={() => remove(asked, asking)} />)}
    </AlertDialog>
  );
}
