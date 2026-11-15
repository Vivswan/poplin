// The panel of one thing, opened from a list. On a wide screen it lies over the end of the list, which keeps its width; on a narrower one it takes the list's place until it is closed.
// Escape closes it either way, a press beside it closes it where the list is in sight, and the focus goes into it when it opens and back to where it came from when it closes.

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { XIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { FOCUS_HOME, useFocusHome } from "@/lib/focus";
import { useMedia } from "@/lib/media";
import { IconButton } from "@/shared/icon-button";

/** The width from which a panel lies over the end of its list: beside the panel the list then still shows its fixed column and one more. */
const OVER = "(min-width: 1040px)";

/** A row of the list that opens a panel, and everything in it. */
const ROWS = "[data-opens]";

/** The places beside a panel that close nothing when they are pressed or take the focus: a row of the list opens, changes, or closes the panel itself, a result's button acts on the panel's thing, and a question the panel asked lies over the page. */
const OWN_PLACES = `${ROWS}, [data-sonner-toaster], [role='dialog'], [role='alertdialog']`;

/** What a panel is drawn from. */
interface SidePanelProps {
  /** The name of the thing, as the panel's heading; `undefined` while it is being read. */
  readonly title: string | undefined;

  /** The link Close is drawn as: it leads back to the list. */
  readonly closeLink: ReactElement;

  /** What Escape does: the move back to the list. */
  readonly onClose: () => void;

  /** Finds what opens this panel in the list, such as the row of its thing: it takes the focus when the panel closes. Where it finds nothing the screen gives the focus a place. */
  readonly opener: () => HTMLElement | undefined;

  /** The words of the way back to the list, such as "Back to sites": what a screen reader is told Close does. */
  readonly back: string;

  /** What sits beside the heading, such as a Rename button. */
  readonly beside?: ReactNode;

  /** The panel's blocks. */
  readonly children: ReactNode;
}

/**
 * Whether the screen is wide enough for a panel to lie over the end of its list, with the list in sight beside it.
 *
 * Under that width the panel takes the whole row and the list is out of sight.
 */
export function useLiesOver(): boolean {
  return useMedia(OVER);
}

/**
 * One block of a panel, under a hairline.
 *
 * @param label - the small heading of the block; left out, the block has none
 */
export function PanelBlock({ label, children }: { readonly label?: string; readonly children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-2 border-t px-6 py-4 max-md:px-4">
      {label === undefined ? null : <h3 className="text-xs text-muted-foreground">{label}</h3>}
      {children}
    </section>
  );
}

/** One fact of a panel's list of facts: use inside `PanelFacts`. */
export function PanelFact({ name, children }: { readonly name: string; readonly children: ReactNode }): ReactNode {
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** A panel's list of facts: names at the left, values beside them. */
export function PanelFacts({ children }: { readonly children: ReactNode }): ReactNode {
  return <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-1.5">{children}</dl>;
}

/**
 * A setting that is on or off, as a switch with its words. It moves at once, takes no second press while it is being saved, and moves back when the change is refused.
 *
 * @param id - an id of its own on the page, which ties the words to the switch
 * @param onChange - saves the setting and answers a promise of what was saved, or of `undefined` when the save was refused
 */
export function PanelSwitch({
  id,
  label,
  on,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly on: boolean;
  readonly onChange: (on: boolean) => unknown;
}): ReactNode {
  const [asked, setAsked] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  // What the last done save stored, until the setting it shows has caught up: a refused change goes back to it, never to an older reading.
  const [stored, setStored] = useState<boolean>();
  // The switch stays where it was put until the setting it shows has caught up, so a done save does not flick it back for a moment.
  if (asked !== undefined && asked === on) setAsked(undefined);

  if (stored !== undefined && stored === on) setStored(undefined);

  const change = async (next: boolean): Promise<void> => {
    setAsked(next);
    setSaving(true);
    const saved = await Promise.resolve(onChange(next)).catch(() => undefined);
    setSaving(false);
    // A save that answers nothing was refused: the switch goes back to what is stored. A done one keeps its place, also where the setting is not read again.
    if (saved === undefined) setAsked(stored);
    else setStored(next);
  };

  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <label htmlFor={id}>{label}</label>
      <Switch id={id} checked={asked ?? on} disabled={saving} onCheckedChange={(next) => void change(next)} />
    </div>
  );
}

/** What a panel shows while its thing is being read. */
export function PanelLoading(): ReactNode {
  return (
    <div className="flex flex-col gap-3 px-6 max-md:px-4">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** Whether something lies over the page that takes every key for itself, such as a question: the library hides the rest of the page from assistive technology for as long. */
function liesUnder(place: HTMLElement): boolean {
  return place.closest('[aria-hidden="true"]') !== null;
}

/** Whether a panel that closes leaves the focus on nothing: it was in the panel, or on the page itself. A focus a person moved elsewhere stays there. */
function leftBy(place: HTMLElement): boolean {
  return document.activeElement === document.body || place.contains(document.activeElement);
}

/**
 * Whether the panel hides a control, in part or in whole: the two overlap, and in the middle of what they share a press reaches the panel, not a layer that lies over both.
 *
 * The list itself, which takes the focus at a press on a row, holds its rows beside the panel and is never hidden.
 */
function covers(place: HTMLElement, control: Element): boolean {
  if (place.contains(control) || control.querySelector(ROWS) !== null) return false;

  const [over, under] = [place.getBoundingClientRect(), control.getBoundingClientRect()];
  const [left, right, top, bottom] = [Math.max(over.left, under.left), Math.min(over.right, under.right), Math.max(over.top, under.top), Math.min(over.bottom, under.bottom)];

  if (right <= left || bottom <= top) return false;

  return place.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
}

/**
 * Whether what the library says closed the panel closes it: Escape does, and so does a press beside it or a focus that left it, unless it went to a place of its own.
 *
 * A focus that left for nothing was taken away with its control, and stays the panel's.
 */
function closes({ reason, event }: Dialog.Root.ChangeEventDetails): boolean {
  if (reason !== "outside-press" && reason !== "focus-out") return true;

  const went = reason === "focus-out" ? (event as FocusEvent).relatedTarget : event.target;

  return went instanceof Element && went.closest(OWN_PLACES) === null;
}

/**
 * Close a panel when the focus reaches a control that lies under it, so the focus is never out of sight: the list keeps its width under the panel, which covers the end of its rows, of its headings, and of its tools.
 *
 * The library tells of a focus that leaves the panel only, and a covered control is reached from a row as well.
 */
function useNoFocusUnder(place: HTMLElement | null, onClose: () => void): void {
  useEffect(() => {
    if (place === null) return;

    const onFocus = ({ target }: FocusEvent): void => {
      if (target instanceof Element && covers(place, target)) onClose();
    };
    document.addEventListener("focusin", onFocus);

    return () => document.removeEventListener("focusin", onFocus);
  }, [place, onClose]);
}

/**
 * Draw a panel: the library's dialog without its modal layer, drawn into its own place in the page, so nothing is dimmed and the rest of the page stays in use.
 *
 * It moves the focus to the heading, closes on Escape, and gives the focus back to its opener, though not after a close it was refused: the screen then finds the focus its place.
 * Over the end of its list it is set off by a hairline and a soft shadow, and a press beside it closes it; where it has the row to itself it lies in the list's place.
 */
export function SidePanel({ title, closeLink, onClose, opener, back, beside, children }: SidePanelProps): ReactNode {
  const [place, setPlace] = useState<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const liesOver = useLiesOver();
  // A change of the thing can take away the control that was pressed for it: the heading takes the focus then.
  const kept = useFocusHome();
  useNoFocusUnder(place, onClose);

  return (
    <aside
      ref={setPlace}
      aria-label={title ?? "Details"}
      className={cn("flex min-h-0 min-w-0 flex-col bg-background", liesOver ? "absolute inset-y-0 right-0 z-40 w-[440px] border-l shadow-[-12px_0_24px_-16px_rgb(0_0_0/0.25)]" : "col-start-1 row-start-1")}
    >
      {place === null ? null : (
        // An Escape pressed while a question lies over the page is the question's alone, also where the focus is on neither.
        <Dialog.Root open modal={false} disablePointerDismissal={!liesOver} onOpenChange={(open, details) => (open || liesUnder(place) || !closes(details) ? undefined : onClose())}>
          <Dialog.Portal container={place} className="flex min-h-0 flex-1 flex-col">
            <Dialog.Popup
              initialFocus={heading}
              finalFocus={() => (leftBy(place) && opener()) || false}
              {...kept}
              className="line-room flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
            >
              {/* Over its list the heading stands on the line of the list's tools, and the first hairline under it where the list's tools end. */}
              <header className={cn("flex shrink-0 items-center gap-1 px-6 max-md:px-4", liesOver ? "h-11 pb-3" : "h-14")}>
                <Dialog.Title ref={heading} tabIndex={-1} {...FOCUS_HOME} className="min-w-0 truncate text-base font-bold outline-none" title={title}>
                  {title ?? <Skeleton className="h-5 w-40" />}
                </Dialog.Title>
                {beside}
                <IconButton label={`Close: ${back.toLowerCase()}`} link={closeLink} className="ml-auto">
                  <XIcon />
                </IconButton>
              </header>
              {children}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </aside>
  );
}

/** The button that opens the panel of the site with a label: the one of the table's row or of the phone's, whichever is in sight. */
export function openerOf(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(`[data-opens="${CSS.escape(label)}"]`)].find((opener) => opener.getClientRects().length > 0);
}

/**
 * Keep the focus on the screen. A panel that closed with the focus in it leaves the focus on nothing: the row of its site takes it. A site that left the list, or a panel that closed over a row that is gone, leaves it to the search.
 *
 * @param opened - the label of the site whose panel is open
 * @returns the handlers of the screen's region
 */
export function useKeptFocus(opened: string | undefined): ReturnType<typeof useFocusHome> {
  const before = useRef(opened);
  const kept = useFocusHome(() => (opened === undefined && before.current !== undefined ? openerOf(before.current) : undefined));
  // The look for a lost focus comes first, in the hook above: it still reads the label of the panel that has just closed.
  useEffect(() => {
    before.current = opened;
  }, [opened]);

  return kept;
}
