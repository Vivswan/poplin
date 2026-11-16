// A dialog that is closing takes no press. Its buttons and its form are still drawn while it fades, with the focus still in it:
// a second click, or a second Enter, would send again the change the first one has just done.

import type { SyntheticEvent } from "react";

/** The mark the dialog library puts on a popup from the moment it begins to close. */
const CLOSING = "data-closed";

/** Stop a press or a sent form on its way into a popup that is closing: nothing in the popup hears of it, and the browser does nothing of its own with it. */
function refuseWhileClosing(event: SyntheticEvent<HTMLElement>): void {
  if (!event.currentTarget.hasAttribute(CLOSING)) return;

  event.preventDefault();
  event.stopPropagation();
}

/** What a dialog's popup is drawn with, so that it takes no press, by pointer or by keys, while it closes. */
export const NO_PRESS_WHILE_CLOSING = { onClickCapture: refuseWhileClosing, onSubmitCapture: refuseWhileClosing } as const;
