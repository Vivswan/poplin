// The questions the Sites screen asks before a change of a site: its title and name, a new link, and opening the site wider. They are asked from a row's menu and from the panel alike, and drawn once, beside both.

import type { ReactNode } from "react";

import { ACCESSES, type Access, type Site, shownName } from "@/lib/sites";
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

  if (ask.kind !== "access") return undefined;

  const word = ACCESSES.find((entry) => entry.access === ask.access)?.label.toLowerCase() ?? "";
  const says = ask.access === "public" ? "Everyone can open it, at a public link. No login." : "Anyone with the link can open it. No login.";

  return { title: `Make ${shownName(site)} ${word}?`, says, yes: `Make it ${word}` };
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
    </>
  );
}
