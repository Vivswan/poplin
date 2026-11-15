// How a change is sent and its result said: one line at the top of the screen, with Undo where one press takes the change back.

import { toast } from "sonner";

import { type Answering, answerOf, type Done, Refused } from "@/lib/api";

/** What goes wrong that is no refusal: a fault of the client itself. */
const FAULT = "That did not work. Try again.";

/** A way to take a done change back with one press. */
interface Undo {
  readonly label?: string;
  readonly run: () => void;
}

/**
 * Say that a change was done.
 *
 * @param undo - shown as a button on the line, for a change one press can take back
 */
export function sayDone(text: string, undo?: Undo): void {
  // The same words said twice in a row are one line, not two; a line with Undo stays its own, since each takes back another change.
  if (undo === undefined) toast.success(text, { id: text });
  else toast.success(text, { action: { label: undo.label ?? "Undo", onClick: undo.run } });
}

/** Say that a change was refused, in the sentence the server gave. */
export function sayRefused(sentence: string): void {
  toast.error(sentence);
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
