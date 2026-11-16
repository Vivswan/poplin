// The question before a site in the trash is deleted for good. It is drawn once on the Sites screen, outside the row or the panel that asks it, so a press in it is no press on that row.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

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
import { sayDone } from "@/lib/notify";
import { LONGEST_NAME, type Site, shownName } from "@/lib/sites";
import { SITES_KEY, siteKey } from "@/sites/site-queries";

/** The question that is open, and who is told when it changes: the one question drawn on the screen. */
const QUESTION: { asked: Asked | undefined; readonly heard: Set<() => void> } = { asked: undefined, heard: new Set() };

/** What is asked: the site to delete for good, and what follows. */
interface Asked {
  /** The site, which is in the trash. */
  readonly site: Site;

  /** The control that asked, which takes the focus back when the question is left. */
  readonly opener: HTMLElement | null;

  /** Called once the site is gone, before the list is read again. */
  readonly onGone: () => void;
}

function hear(listener: () => void): () => void {
  QUESTION.heard.add(listener);

  return () => QUESTION.heard.delete(listener);
}

function put(asked: Asked | undefined): void {
  QUESTION.asked = asked;
  for (const listener of QUESTION.heard) listener();
}

/** Ask whether a site in the trash is deleted for good. The question is drawn where `DeleteForGoodQuestion` stands. */
export function askDeleteForGood(asked: Asked): void {
  put(asked);
}

/**
 * Draw the question that is asked, and delete the site once it is answered: the button that does it stays off until the site's name is typed.
 *
 * A refusal is said at the field with the typed name kept. A done delete is said in one line with no Undo, and the lists are read again.
 */
export function DeleteForGoodQuestion(): ReactNode {
  const client = useQueryClient();
  const id = useId();
  const asked = useSyncExternalStore(hear, () => QUESTION.asked);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [typed, setTyped] = useState("");
  // The words stay while the question closes, so it does not empty as it fades.
  const last = useRef(asked);
  if (asked !== undefined) [last.current, opener.current] = [asked, asked.opener];

  const site = (asked ?? last.current)?.site;
  // Whether this screen is still drawn: a delete that is done after it was left tells no screen that the site is gone.
  const drawn = useRef(true);
  // A done delete is said and the lists are read again, also where its question was left meanwhile. It closes the question it was asked in, and no other one that is open by then.
  // The site that is gone is forgotten, not read again, which would only be refused.
  const removal = useMutation({
    mutationFn: (of: Asked) => answerOf(api.sites[":site"]["delete-for-good"].$post({ param: { site: of.site.label }, json: {} })),
    onSuccess: (_done, of) => {
      if (QUESTION.asked === of) put(undefined);

      if (drawn.current) of.onGone();

      client.removeQueries({ queryKey: siteKey(of.site.label) });
      void client.invalidateQueries({ queryKey: SITES_KEY, predicate: (query) => query.queryKey[1] !== "one" });
      sayDone(`${shownName(of.site)} deleted for good.`);
    },
  });
  // What the last delete was refused with is said in the question it was asked in alone, and a delete on its way holds that question's button alone.
  const own = removal.variables === asked;
  const refusal = own ? removal.error?.message : undefined;
  const sending = own && removal.isPending;
  // Each question starts with an empty field.
  const [fresh, setFresh] = useState(asked);
  if (asked !== fresh) {
    setFresh(asked);
    setTyped("");
  }

  // A question left open on a screen that is left is not asked on the next one. A development build sets an effect up twice, so the setup says the screen is drawn again.
  useEffect(() => {
    drawn.current = true;

    return () => {
      drawn.current = false;
      put(undefined);
    };
  }, []);

  const remove = (event: FormEvent): void => {
    event.preventDefault();
    if (asked !== undefined && typed === asked.site.name && !removal.isPending) removal.mutate(asked);
  };

  return (
    <AlertDialog open={asked !== undefined} onOpenChange={(open) => (open ? undefined : put(undefined))}>
      <AlertDialogContent initialFocus={cancel} finalFocus={thenHome(opener)}>
        <form onSubmit={remove} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {site === undefined ? "" : shownName(site)} for good?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone, and the site's files go too.</AlertDialogDescription>
          </AlertDialogHeader>
          <Field data-invalid={refusal !== undefined}>
            <FieldLabel htmlFor={id}>Site's name</FieldLabel>
            <Input
              id={id}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                // A refusal is about the delete that was sent: it leaves when the name is typed again. A delete on its way is left to end.
                if (!removal.isPending) removal.reset();
              }}
              aria-invalid={refusal !== undefined}
              aria-describedby={refusal === undefined ? `${id}-says` : `${id}-says ${id}-refused`}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={LONGEST_NAME}
            />
            <FieldDescription id={`${id}-says`}>
              Type <span className="font-mono text-xs text-foreground">{site?.name}</span> to delete it.
            </FieldDescription>
            {refusal === undefined ? null : <FieldError id={`${id}-refused`}>{refusal}</FieldError>}
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" variant="destructive" disabled={typed !== site?.name || sending}>
              Delete for good
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
