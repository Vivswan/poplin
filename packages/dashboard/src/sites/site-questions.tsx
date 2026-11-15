// The questions the Sites screen asks before a change of a site: its title and name, a new link, a copy, and who can open it. They are asked from the panel, and drawn once, outside it.

import { type ReactNode, type RefObject, useRef } from "react";
import { useDebounce } from "use-debounce";

import { ACCESSES, type Access, LONGEST_NAME, plainAddress, type Site, shownName } from "@/lib/sites";
import { AskDialog } from "@/shared/ask-dialog";
import { Confirm, type Question } from "@/shared/confirm";
import { DeleteForGoodQuestion } from "@/sites/delete-for-good-question";
import { DuplicateDialog } from "@/sites/duplicate-dialog";
import { EditSiteDialog } from "@/sites/edit-site-dialog";
import type { SiteActions } from "@/sites/site-actions";
import { usePublicAddress } from "@/sites/site-queries";

/** How long the typing of a public name rests before its address is asked, in milliseconds. */
const REST_MS = 250;

/** What a site's users are told of who can open it once it is no longer public, by the access it gets. */
const AFTER_PUBLIC: Readonly<Record<Exclude<Access, "public">, string>> = {
  private: "Its public link stops working.",
  unlisted: "Its public link stops working. Anyone with its other link can open it. No login.",
};

/** What a question says of a site that is not public now, by the access it gets. */
const OPENS_TO: Readonly<Record<Exclude<Access, "public">, string>> = {
  private: "Only users who can log in here can open it.",
  unlisted: "Anyone with the link can open it. No login.",
};

/** What is asked about a site before it is changed. */
export type Ask = { readonly kind: "naming" } | { readonly kind: "new-link" } | { readonly kind: "duplicate" } | { readonly kind: "access"; readonly access: Access };

/** A question that is open: the site it is about, and what is asked. */
export interface Asked {
  readonly site: Site;
  readonly ask: Ask;
}

/** The words of the question before a site is given a new link or another access. */
function questionOf({ site, ask }: Asked): Question | undefined {
  if (ask.kind === "new-link") {
    const kept = site.access === "public" ? " Its public link keeps working." : "";

    return { title: "Make a new link?", says: `The site gets a new link. The link in use now stops working at once.${kept}`, yes: "Make a new link" };
  }

  // A site is made public by a question of its own, which asks for the public name.
  if (ask.kind !== "access" || ask.access === "public") return undefined;

  const word = ACCESSES.find((entry) => entry.access === ask.access)?.label.toLowerCase() ?? "";
  const says = site.access === "public" ? AFTER_PUBLIC[ask.access] : OPENS_TO[ask.access];

  return { title: `Make ${shownName(site)} ${word}?`, says, yes: `Make it ${word}` };
}

/** The line under the public name: the address the site gets under the name typed, as the server writes it. A name that gets none leaves the plain hint. */
function PublicAddress({ name }: { readonly name: string }): ReactNode {
  const [asked] = useDebounce(name, REST_MS);
  const { data } = usePublicAddress(asked);
  // An address is of the name it was asked for: while another name is typed, none is shown.
  if (data === undefined || asked !== name) return "The public link uses this name.";

  return (
    <>
      Its link will be <span className="block break-all font-mono text-[13px] text-foreground">{plainAddress(data.address)}</span>
    </>
  );
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
 * @param returnTo - the control that asked, which takes the focus back from a question with a field
 */
export function SiteQuestions({
  asked,
  actions,
  onClose,
  returnTo,
}: {
  readonly asked: Asked | undefined;
  readonly actions: SiteActions;
  readonly onClose: () => void;
  readonly returnTo: RefObject<HTMLElement | null>;
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
      <EditSiteDialog site={named} onClose={onClose} onSave={actions.name} returnTo={returnTo} />
      <DuplicateDialog site={asked?.ask.kind === "duplicate" ? asked.site : undefined} onClose={onClose} returnTo={returnTo} />
      <Confirm question={asked === undefined ? undefined : questionOf(asked)} onAnswer={answer} />
      <DeleteForGoodQuestion />
      <AskDialog
        open={opening !== undefined}
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={shown === undefined ? "" : `Make ${shownName(shown)} public?`}
        says="Everyone can open it, at a public link. No login."
        label="Public name"
        under={(name) => <PublicAddress name={name} />}
        initial={shown?.name ?? ""}
        maxLength={LONGEST_NAME}
        takesInitial
        returnTo={returnTo}
        submit="Make it public"
        onSubmit={async (publicName) => (shown === undefined ? undefined : actions.makePublic(shown, publicName))}
      />
    </>
  );
}
