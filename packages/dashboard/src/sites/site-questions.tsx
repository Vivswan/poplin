// The questions the Sites screen asks before a change of a site: a new name, a new link, and opening the site wider. They are asked from a row's menu and from the panel alike, and drawn once, beside both.

import type { ReactNode } from "react";

import { ACCESSES, type Access, type Site } from "@/lib/sites";
import { AskDialog } from "@/shared/ask-dialog";
import { Confirm, type Question } from "@/shared/confirm";
import type { SiteActions } from "@/sites/site-actions";

/** What is asked about a site before it is changed. */
export type Ask = { readonly kind: "rename" } | { readonly kind: "new-link" } | { readonly kind: "access"; readonly access: Access };

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

  return { title: `Make ${site.name} ${word}?`, says, yes: `Make it ${word}` };
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
  const renamed = asked?.ask.kind === "rename" ? asked.site : undefined;

  const answer = (yes: boolean): void => {
    onClose();
    if (!yes || asked === undefined) return;

    if (asked.ask.kind === "new-link") void actions.newLink(asked.site);

    if (asked.ask.kind === "access") void actions.setAccess(asked.site, asked.ask.access);
  };
  const rename = async (name: string): Promise<string | undefined> => {
    if (renamed === undefined) return undefined;

    const done = await actions.rename(renamed, name);

    return typeof done === "string" ? done : undefined;
  };

  return (
    <>
      <AskDialog
        open={renamed !== undefined}
        onOpenChange={(open) => (open ? undefined : onClose())}
        title="Rename the site"
        says="The link takes the new name. The old link keeps working."
        label="Name"
        hint="3 to 40 lowercase letters, digits, and single dashes."
        initial={renamed?.name ?? ""}
        submit="Rename"
        onSubmit={rename}
      />
      <Confirm question={asked === undefined ? undefined : questionOf(asked)} onAnswer={answer} />
    </>
  );
}
