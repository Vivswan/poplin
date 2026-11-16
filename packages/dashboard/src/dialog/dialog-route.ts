// A dialog belongs to the place it was opened at: when the address leads elsewhere, by the browser's Back or by a move of the console, the dialog closes, so no question stays over a screen it is not about.

import { useRouter } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef } from "react";

/** What the library's dialog is closed by from outside. */
interface Actions {
  readonly close: () => void;
  readonly unmount: () => void;
}

/** What the library says of a change it asks for: whether the one it asked refused it. */
interface Change {
  readonly isCanceled: boolean;
}

/** What a dialog's root is drawn from, as far as its opening and closing go. */
interface Rooted<Details extends Change> {
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean, details: Details) => void) | undefined;
  readonly actionsRef?: RefObject<Actions | null> | undefined;
}

/**
 * Close a dialog when the address moves to another path while it is open: by the browser's Back or Forward, or by a move of the console. It closes the library's way, so the one who opened it hears of it as of a Cancel.
 * A move that replaces the address, as the one that follows a renamed site to its new label, leaves the dialog open.
 *
 * A dialog that an address itself opens is closed by its screen as the address leaves, and is left alone. Where no router is drawn around it, nothing is listened for.
 *
 * @param root - what the dialog's root was given
 * @returns what the root is drawn with in place of the two it was given
 */
export function useClosesWithRoute<Details extends Change>(root: Rooted<Details>): Required<Pick<Rooted<Details>, "actionsRef" | "onOpenChange">> {
  // No router is drawn around a piece that is drawn alone, and the hook then answers nothing.
  const router = (useRouter({ warn: false }) as ReturnType<typeof useRouter> | null) ?? undefined;
  const own = useRef<Actions | null>(null);
  const actions = root.actionsRef ?? own;
  // The path the dialog was opened at, and none while it is closed. A dialog that is told whether it is open is asked at each draw; one that opens itself says so as it does.
  const at = useRef<string | undefined>(undefined);
  const note = (open: boolean): void => {
    at.current = open ? (at.current ?? router?.state.location.pathname) : undefined;
  };
  if (root.open !== undefined) note(root.open);

  const { onOpenChange } = root;
  useEffect(() => {
    if (router === undefined) return undefined;

    // How the address last changed: a move that puts another address in the place of this one, as the one after a site's rename, is the same place still.
    let replaced = false;
    const unheard = router.history.subscribe(({ action }: { readonly action: { readonly type: string } }) => {
      replaced = action.type === "REPLACE";
    });
    const undrawn = router.subscribe("onRendered", () => {
      const { pathname } = router.state.location;
      if (at.current === undefined || at.current === pathname) return;

      if (replaced) at.current = pathname;
      else actions.current?.close();
    });

    return () => {
      unheard();
      undrawn();
    };
  }, [router, actions]);

  return {
    actionsRef: actions,
    onOpenChange: (next: boolean, details: Details): void => {
      onOpenChange?.(next, details);
      if (root.open === undefined && !details.isCanceled) note(next);
    },
  };
}
