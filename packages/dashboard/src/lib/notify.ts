// How a change is sent and its result said: one line at the edge of the screen, with Undo where one press takes the change back.

import { toast } from "sonner";

import { type Answering, answerOf, type Done, Refused } from "@/lib/api";
import { focusBack } from "@/lib/focus";
import { PHONE } from "@/lib/media";

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
 * Make room for a line: a phone shows one line at a time, the newest, since each lies over the screen's last controls.
 *
 * @param id - the id of the line that is said next; one shown under it is said again in its place, and stays
 */
function makeRoom(id?: string): void {
  if (!window.matchMedia(PHONE).matches) return;

  for (const shown of toast.getToasts()) if (shown.id !== id) toast.dismiss(shown.id);
}

/** Leave of the lines that are shown the newest alone: for a screen that became as narrow as a phone while several were shown. */
export function leaveNewest(): void {
  for (const older of toast.getToasts().slice(0, -1)) toast.dismiss(older.id);
}

/**
 * Take a line away at a press on it. A line with a button stays: the press was for the button, or missed it.
 *
 * A line is found by its own words, which it carries as its mark.
 */
export function leaveAtPress(event: MouseEvent): void {
  const line = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-sonner-toast]") : null;
  const words = line?.dataset.testid;
  if (line === null || words === undefined || line.querySelector("button") !== null) return;

  toast.dismiss(words);
}

/** Do what a line's button stands for. The button leaves with its line, and the focus with it: it goes back to where it was. */
function pressed(undo: Undo): void {
  undo.run();
  focusBack();
}

/**
 * Say that a change was done.
 *
 * @param undo - shown as a button on the line: Undo for a change one press can take back, or under its own label the step that comes next. Such a line stays longer and can be closed
 */
export function sayDone(text: string, undo?: Undo): void {
  // The same words said twice in a row are one line, not two; a line with Undo stays its own, since each takes back another change.
  makeRoom(undo === undefined ? text : undefined);
  if (undo === undefined) toast.success(text, { id: text, testId: text });
  else toast.success(text, { action: { label: undo.label ?? "Undo", onClick: () => pressed(undo) }, duration: BUTTON_STAYS_MS, closeButton: true });
}

/** Say that a change was refused, in the sentence the server gave. */
export function sayRefused(sentence: string): void {
  makeRoom(sentence);
  toast.error(sentence, { id: sentence, testId: sentence });
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
