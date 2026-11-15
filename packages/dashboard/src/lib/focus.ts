// Where the focus goes when a change takes away the control that held it: a row that was removed, a button that left with its bar, the opener of a dialog.
// The browser then leaves the focus on the page's body, where no key reaches anything.

import { type FocusEventHandler, type RefObject, useEffect, useRef } from "react";

/** The mark of an element that takes a lost focus: a panel's heading, a list's search, the open tab of a screen. */
export const FOCUS_HOME = { "data-focus-home": "" } as const;

/** The place every result is said in, as the library that draws it marks it. */
const LINES = "[data-sonner-toaster]";

/** What held the focus last outside the place of the results: where the focus goes back to from a result's button. */
const HELD: { last: HTMLElement | null } = { last: null };

/** The screen drawn last, by its title. */
const SHOWN: { screen: string | undefined } = { screen: undefined };

/** The two handlers a region is given, so the hook knows whether the focus is inside it. */
interface Held {
  readonly onFocusCapture: FocusEventHandler;
  readonly onBlurCapture: FocusEventHandler;
}

/** What takes a focus: what was found for it while that is still on the page, and the last marked home in the page's order otherwise. */
function homeOf(found: HTMLElement | null | undefined): HTMLElement | undefined {
  return found?.isConnected === true ? found : [...document.querySelectorAll<HTMLElement>("[data-focus-home]")].at(-1);
}

/**
 * Give a lost focus a home: nothing happens while any control holds the focus.
 *
 * @param find - finds what takes the focus. Left out, or where it finds nothing that is still on the page, the last marked home in the page's order takes it, which is the one of the innermost thing in view: a panel's heading comes after its list's search
 */
function focusHome(find?: () => HTMLElement | null | undefined): void {
  if (document.activeElement !== document.body) return;

  homeOf(find?.())?.focus();
}

/**
 * Note what takes the focus: the page hears every move of the focus with it.
 *
 * A result is no place to come back to, so a move into one is not noted.
 */
export function noteFocus(event: FocusEvent): void {
  if (event.target instanceof HTMLElement && event.target.closest(LINES) === null) HELD.last = event.target;
}

/** Give the focus back from a result's button, which leaves with its result: to what held it before, or home where that is gone. */
export function focusBack(): void {
  homeOf(HELD.last)?.focus();
}

/**
 * What a dialog is told of the focus it gives back when it closes: back as the dialog does it, and from there home if that left it on nothing. The control that opened a dialog may be gone by the time it closes.
 *
 * @param returnTo - what takes the focus in place of the dialog's own choice, while it is still on the page
 * @returns the answer to the dialog library's question where the focus goes
 */
export function thenHome(returnTo?: RefObject<HTMLElement | null>): () => HTMLElement | true {
  return () => {
    // The dialog moves the focus right after this answer: the look for a lost focus comes a frame later.
    window.requestAnimationFrame(() => focusHome());

    return returnTo?.current?.isConnected === true ? returnTo.current : true;
  };
}

/**
 * Give the focus to a screen's title when the screen follows another one, as after a press on a section's link, unless a control of the new screen holds it by then: the next key then starts at the screen, and a screen reader says where it is.
 *
 * A screen is drawn anew once its code is there: what held the focus is gone then, and the new title takes it.
 *
 * @param screen - the screen's title
 * @returns what to spread onto the title's element: its ref, and that it takes a focus given by a script
 */
export function useScreenFocus(screen: string): { readonly ref: RefObject<HTMLHeadingElement | null>; readonly tabIndex: -1 } {
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const follows = SHOWN.screen !== undefined && SHOWN.screen !== screen;
    SHOWN.screen = screen;
    // The link that led here is still on the page for a moment, in the frame of the screen before: a focus outside this screen's frame is on its way out with it.
    const frame = title.current?.closest("main")?.parentElement;
    const leaving = follows && frame?.contains(document.activeElement) !== true;
    // A frame drawn in place of another one takes with it what held the focus there, the title or a control reached meanwhile.
    const lost = HELD.last?.isConnected === false && document.activeElement === document.body;
    if (leaving || lost) title.current?.focus();
  }, [screen]);

  return { ref: title, tabIndex: -1 };
}

/**
 * Keep the focus in a region of a screen: when the region was drawn again and the control that held the focus is gone, the focus goes home.
 *
 * A focus a person moved out of the region is left where it went.
 *
 * @param find - as `focusHome` takes it
 * @returns the handlers to spread onto the region's element
 */
export function useFocusHome(find?: () => HTMLElement | null | undefined): Held {
  const inside = useRef(false);

  // A control that is taken away gets no blur, so the region still counts as holding the focus while the page's body has it.
  useEffect(() => {
    if (inside.current) focusHome(find);
  });

  return {
    onFocusCapture: () => {
      inside.current = true;
    },
    onBlurCapture: () => {
      inside.current = false;
    },
  };
}
