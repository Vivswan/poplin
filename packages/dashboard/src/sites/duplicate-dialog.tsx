// The question before a site is copied: the name of the copy.

import { type ReactNode, type RefObject, useRef } from "react";

import { type Site, shownName } from "@/lib/sites";
import { AskDialog } from "@/shared/ask-dialog";
import { useDuplicate } from "@/sites/use-duplicate";

/** What the dialog is drawn from. */
interface DuplicateDialogProps {
  /** The site to copy; `undefined` shows no dialog. */
  readonly site: Site | undefined;

  /** Called when the dialog is left, and when the copy is begun. */
  readonly onClose: () => void;

  /** The control that asked, which takes the focus back. */
  readonly returnTo: RefObject<HTMLElement | null>;
}

/** Ask for the copy's name, which opens as the site's own, and begin the copy. A refused name is said at the field. */
export function DuplicateDialog({ site, onClose, returnTo }: DuplicateDialogProps): ReactNode {
  const duplicate = useDuplicate();
  // The site stays while its question closes, so the dialog does not empty as it fades.
  const last = useRef(site);
  if (site !== undefined) last.current = site;

  const shown = site ?? last.current;
  // Every opening and every leaving of the question is counted, so an answer knows whether its own question is still the open one.
  const asked = useRef({ site, turn: 0 });
  if (site !== asked.current.site) asked.current = { site, turn: asked.current.turn + 1 };

  const late = useRef(false);
  const begin = async (name: string): Promise<string | undefined> => {
    if (shown === undefined) return undefined;

    const { turn } = asked.current;
    const refused = await duplicate(shown, name);
    // The question was left while the first request was on its way: its answer is of no question that is open, so neither a refusal nor the close that follows is the open one's.
    late.current = asked.current.turn !== turn;

    return late.current ? undefined : refused;
  };
  const close = (): void => {
    if (!late.current) onClose();

    late.current = false;
  };

  return (
    <AskDialog
      open={site !== undefined}
      onOpenChange={(open) => (open ? undefined : close())}
      title={shown === undefined ? "" : `Duplicate ${shownName(shown)}?`}
      says="The copy starts private."
      label="Name"
      hint="The copy's link uses this name."
      initial={shown?.name ?? ""}
      takesInitial
      returnTo={returnTo}
      submit="Duplicate"
      onSubmit={begin}
    />
  );
}
