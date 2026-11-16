// Typing that was not sent counts as unsaved for as long as the dialog or the form it was typed into is on the page: the browser asks before the tab closes or loads again, and a login that ended leaves the page as it is.

import { useEffect, useState } from "react";

/**
 * Hold the page from the first typing into a dialog or a form until that is drawn no more.
 *
 * @returns what the dialog or the form calls at every input into it
 */
export function useUnsavedTyping(): () => void {
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (!typed) return undefined;

    // A listener of its own for each dialog: one that closes over another leaves the other's in place.
    const ask = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", ask);

    return () => window.removeEventListener("beforeunload", ask);
  }, [typed]);

  return () => setTyped(true);
}
