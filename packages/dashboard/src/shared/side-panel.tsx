// The panel of one thing, opened from a list. On a wide screen it stands beside the list; on a narrower one it slides over the list, which stays underneath.
// Escape closes it either way, and the focus goes into it when it opens and back to where it came from when it closes.

import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { type KeyboardEvent, type ReactElement, type ReactNode, useRef, useState, useSyncExternalStore } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/shared/icon-button";

/** The width from which a panel stands beside its list. */
const BESIDE = "(min-width: 1280px)";

/** What a panel is drawn from. */
interface SidePanelProps {
  /** The name of the thing, as the panel's heading; `undefined` while it is being read. */
  readonly title: string | undefined;

  /** The link Close is drawn as: it leads back to the list. */
  readonly closeLink: ReactElement;

  /** What Escape and a press outside do: the move back to the list. */
  readonly onClose: () => void;

  /** The words of the way back to the list, such as "Back to sites": what a screen reader is told Close does. */
  readonly back: string;

  /** What sits beside the heading, such as a Rename button. */
  readonly beside?: ReactNode;

  /** The panel's blocks. */
  readonly children: ReactNode;
}

function subscribeToWidth(onChange: () => void): () => void {
  const query = window.matchMedia(BESIDE);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the screen is wide enough for a panel to stand beside its list.
 *
 * A screen lays its list out for the panel beside it only when this says so; under it the panel lies over the list and takes no room.
 */
export function useStandsBeside(): boolean {
  return useSyncExternalStore(subscribeToWidth, () => window.matchMedia(BESIDE).matches);
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
      <dd className="min-w-0 truncate">{children}</dd>
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

/**
 * Close a panel at the first Escape pressed on anything inside it: a hint that is open on the control in focus would take the press for itself otherwise.
 *
 * A press inside something the panel opened over the page, such as a menu, is that thing's own.
 */
function closesAtEscape(onClose: () => void): (event: KeyboardEvent<HTMLElement> & { preventBaseUIHandler?: () => void }) => void {
  return (event) => {
    if (event.key !== "Escape" || !event.currentTarget.contains(event.target as Node)) return;

    event.preventBaseUIHandler?.();
    event.stopPropagation();
    onClose();
  };
}

/** The panel beside its list: the library's dialog without its modal layer, so the list stays in use. It moves the focus to the heading, closes on Escape, and gives the focus back. */
function BesidePanel({ title, closeLink, onClose, back, beside, children }: SidePanelProps): ReactNode {
  // The dialog is drawn into its own place in the page, beside the list, and not over the page.
  const [place, setPlace] = useState<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <aside ref={setPlace} aria-label={title ?? "Details"} className="flex min-h-0 flex-col border-l">
      {place === null ? null : (
        <Dialog.Root open modal={false} disablePointerDismissal onOpenChange={(open) => (open ? undefined : onClose())}>
          <Dialog.Portal container={place} className="flex min-h-0 flex-1 flex-col">
            <Dialog.Popup
              initialFocus={heading}
              onKeyDownCapture={closesAtEscape(onClose)}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
            >
              <header className="flex h-[81px] shrink-0 items-center gap-1 px-6">
                <Dialog.Title ref={heading} tabIndex={-1} className="min-w-0 truncate text-base font-bold outline-none" title={title}>
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

/** The panel over its list: the library's sheet, which holds the focus, closes on Escape and on a press outside, and gives the focus back. */
function OverPanel({ title, onClose, back, beside, children }: SidePanelProps): ReactNode {
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        onKeyDownCapture={closesAtEscape(onClose)}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[440px]"
      >
        <header className="flex h-14 shrink-0 items-center gap-1 pr-12 pl-6 max-md:pl-4">
          <SheetTitle className="min-w-0 truncate text-base font-bold" title={title}>
            {title ?? "Details"}
          </SheetTitle>
          {beside}
        </header>
        <SheetDescription className="sr-only">Escape closes this: {back.toLowerCase()}.</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** Draw a panel: beside its list where the screen is wide enough, over it where it is not. */
export function SidePanel(props: SidePanelProps): ReactNode {
  return useStandsBeside() ? <BesidePanel {...props} /> : <OverPanel {...props} />;
}
