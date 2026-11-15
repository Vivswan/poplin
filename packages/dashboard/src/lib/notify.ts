// How a change is sent and its result said: one line at the edge of the screen, with Undo where one press takes the change back.

import { toast } from "sonner";

import { type Answering, answerOf, type Done, Refused } from "@/lib/api";

/** What goes wrong that is no refusal: a fault of the client itself. */
const FAULT = "That did not work. Try again.";

/** How long a line with a button stays, in milliseconds: twice a plain line's time, to read it and to decide. */
const BUTTON_STAYS_MS = 8000;

/** The button of a line: a way to take a done change back with one press, or under a label of its own the step that comes next. */
interface Undo {
  readonly label?: string;
  readonly run: () => void;
}

/**
 * Say that a change was done.
 *
 * @param undo - shown as a button on the line: Undo for a change one press can take back, or under its own label the step that comes next. Such a line stays longer and can be closed
 */
export function sayDone(text: string, undo?: Undo): void {
  // The same words said twice in a row are one line, not two; a line with Undo stays its own, since each takes back another change.
  if (undo === undefined) toast.success(text, { id: text });
  else toast.success(text, { action: { label: undo.label ?? "Undo", onClick: undo.run }, duration: BUTTON_STAYS_MS, closeButton: true });
}

/** Say that a change was refused, in the sentence the server gave. */
export function sayRefused(sentence: string): void {
  toast.error(sentence);
}

/**
 * Copy a text, and say in one line that it was copied, or that it was not.
 *
 * @param says - the line of a text that was copied, and the line of a browser that copies nothing, which says what to do by hand
 */
export async function copy(text: string, says: { readonly done: string; readonly failed: string }): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    sayDone(says.done);
  } catch {
    sayRefused(says.failed);
  }
}

/**
 * Send a change and say its refusal.
 *
 * @param asked - a call of `api`
 * @returns what the route answered when it is done; `undefined` after a refusal, which was shown as a line
 */
export async function send<Call extends Answering>(asked: Promise<Call>): Promise<Done<Call> | undefined> {
  try {
    return await answerOf(asked);
  } catch (error) {
    sayRefused(error instanceof Refused ? error.message : FAULT);

    return undefined;
  }
}
