// The questions the Sites screen asks before a change of a site: its title and name, a new link, and opening the site wider. They are asked from a row's menu and from the panel alike, and drawn once, beside both.

import { type ReactNode, useRef } from "react";

import { ACCESSES, type Access, LONGEST_NAME, type Site, shownName } from "@/lib/sites";
import { AskDialog } from "@/shared/ask-dialog";
import { Confirm, type Question } from "@/shared/confirm";
import { EditSiteDialog } from "@/sites/edit-site-dialog";
import type { SiteActions } from "@/sites/site-actions";

/** What is asked about a site before it is changed. */
export type Ask = { readonly kind: "naming" } | { readonly kind: "new-link" } | { readonly kind: "access"; readonly access: Access };

/** A question that is open: the site it is about, and what is asked. */
export interface Asked {
  readonly site: Site;
  readonly ask: Ask;
}

/** The words of the question before a site is opened wider or given a new link. */
function questionOf({ site, ask }: Asked): Question | undefined {
  if (ask.kind === "new-link") {
    const kept = site.access === "public" ? " Its public link keeps working." : "";

    return { title: "Make a new link?", says: `The site gets a new link. The link in use now stops working at once.${kept}`, yes: "Make a new link" };
  }

  // A site is made public by a question of its own, which asks for the public name.
  if (ask.kind !== "access" || ask.access === "public") return undefined;

  const word = ACCESSES.find((entry) => entry.access === ask.access)?.label.toLowerCase() ?? "";

  return { title: `Make ${shownName(site)} ${word}?`, says: "Anyone with the link can open it. No login.", yes: `Make it ${word}` };
}

/** The site a person is asked to make public, or `undefined` while that is not asked. */
function publicAsked(asked: Asked | undefined): Site | undefined {
  return asked?.ask.kind === "access" && asked.ask.access === "public" ? asked.site : undefined;
}

/**
 * Draw the open question, and do the change it is answered with.
 *
 * @param asked - the open question; `undefined` shows none
 * @param onClose - called when the question is answered or left
 */
export function SiteQuestions({
  asked,
  actions,
  onClose,
}: {
  readonly asked: Asked | undefined;
  readonly actions: SiteActions;
  readonly onClose: () => void;
}): ReactNode {
  const named = asked?.ask.kind === "naming" ? asked.site : undefined;
  // The site stays while its question closes, so the dialog does not empty as it fades.
  const opening = publicAsked(asked);
  const last = useRef(opening);
  if (opening !== undefined) last.current = opening;

  const shown = opening ?? last.current;

  const answer = (yes: boolean): void => {
    onClose();
    if (!yes || asked === undefined) return;

    if (asked.ask.kind === "new-link") void actions.newLink(asked.site);

    if (asked.ask.kind === "access") void actions.setAccess(asked.site, asked.ask.access);
  };
  return (
    <>
      <EditSiteDialog site={named} onClose={onClose} onSave={actions.name} />
      <Confirm question={asked === undefined ? undefined : questionOf(asked)} onAnswer={answer} />
      <AskDialog
        open={opening !== undefined}
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={shown === undefined ? "" : `Make ${shownName(shown)} public?`}
        says="Everyone can open it, at a public link. No login."
        label="Public name"
        hint="The public link uses this name."
        initial={shown?.name ?? ""}
        maxLength={LONGEST_NAME}
        takesInitial
        submit="Make it public"
        onSubmit={async (publicName) => (shown === undefined ? undefined : actions.makePublic(shown, publicName))}
      />
    </>
  );
}
