// How a change is sent and its result said: one line at the edge of the screen, with Undo where one press takes the change back. A newer result takes the place of the one before it.

import { createElement, type ReactElement } from "react";
import { toast } from "sonner";

import { type Answering, answerOf, type Done, Refused } from "@/lib/api";
import { focusBack } from "@/lib/focus";
import { PHONE } from "@/lib/media";
import { LineButtons } from "@/shared/line-buttons";

/** What goes wrong that is no refusal: a fault of the client itself. */
const FAULT = "That did not work. Try again.";

/** How long a line with a button stays, in milliseconds: time to read it, to decide, and to reach the button with the keys. */
const BUTTON_STAYS_MS = 20_000;

/** The keys that move the focus to the lines, as the library that draws them hears them. */
const KEYS = "Alt+T";

/** The look of the words of a line with a button: on a wide screen they stay on one row, so the line stays lower than the header. A name they begin with is cut before the rest. A phone ends them as it ends every line's. */
const ONE_ROW = { words: "block md:truncate", named: "block md:flex md:min-w-0", name: "md:truncate", rest: "md:shrink-0 md:whitespace-pre" } as const;

/** What a line that takes the place of a line of work does not keep of it: its button, and that it stays. */
const NOT_KEPT = { action: undefined, duration: undefined };

/** The button of a line: a way to take a done change back with one press, or under a label of its own the step that comes next. */
interface Undo {
  /** The words of the button; "Undo" when left out. */
  readonly label?: string;

  /** What a press does. */
  readonly run: () => void;

  /** A name the line is found under, to take it away once its button no longer applies. */
  readonly id?: string;

  /** The name the line's words begin with, such as a site's title: where the words have no room, it is cut and the rest of them stays. */
  readonly name?: string;
}

/** The words of a line with a button, whole in the hint a pointer shows. A name they begin with stands apart from the rest, so it alone is cut. */
function wordsOf(text: string, name: string | undefined): ReactElement {
  if (name === undefined || !text.startsWith(name)) return createElement("span", { title: text, className: ONE_ROW.words }, text);

  const parts = [createElement("span", { key: "name", className: ONE_ROW.name }, name), createElement("span", { key: "rest", className: ONE_ROW.rest }, text.slice(name.length))];

  return createElement("span", { title: text, className: ONE_ROW.named }, parts);
}

/**
 * Make room for a line: one result shows at a time, the newest, on every screen. A wide screen says it inside the header's band and a phone over the screen's last controls, and neither has room for a second.
 * A line of work that goes on stays: its button is the one way to stop the work.
 *
 * @param id - the id of the line that is said next; one shown under it is said again in its place, and stays
 */
function makeRoom(id?: string): void {
  for (const shown of toast.getToasts()) if (shown.id !== id && !goesOn(shown)) toast.dismiss(shown.id);
}

/** Whether a line says work that goes on. */
function goesOn(line: ReturnType<typeof toast.getToasts>[number]): boolean {
  return "type" in line && line.type === "loading";
}

/**
 * Take a line away at a press on it. A line with a button stays: the press was for the button, or missed it.
 *
 * A line is found by the name it was said under, which it carries as its mark: its own words, or the name of the line of work it took the place of.
 */
export function leaveAtPress(event: MouseEvent): void {
  const line = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-sonner-toast]") : null;
  const name = line?.dataset.testid;
  if (line === null || name === undefined || line.querySelector("button") !== null) return;

  toast.dismiss(name);
}

/** Do what the button of a line that stays stands for. The focus goes back to where it was. */
function pressed(undo: Undo): void {
  undo.run();
  focusBack();
}

/**
 * Say a done change in a line with a button, then Close. Where keys are in reach the line names the ones that lead to its button.
 *
 * Words that are cut are shown whole to a pointer that rests on them.
 *
 * A pressed button leaves with its line, and the focus with it: it goes back to where it was.
 */
function sayWithButton(text: string, { label = "Undo", run, id, name }: Undo): void {
  const leave = (): void => {
    toast.dismiss(shown);
    focusBack();
  };
  const onPress = (): void => {
    run();
    leave();
  };
  const description = window.matchMedia(PHONE).matches ? undefined : `Press ${KEYS} to reach ${label}.`;
  const shown = toast.success(wordsOf(text, name), { action: createElement(LineButtons, { label, onPress, onClose: leave }), description, duration: BUTTON_STAYS_MS, id });
}

/**
 * Say that a change was done.
 *
 * @param undo - shown as a button on the line: Undo for a change one press can take back, or under its own label the step that comes next. Such a line stays longer and can be closed. Its `id` may name a line of work, whose place the line then takes
 * @param over - the name of a line of work whose place a line with no button takes
 */
export function sayDone(text: string, undo?: Undo, over?: string): void {
  // The same words said twice in a row are one line, not two; a line with Undo stays its own, since each takes back another change.
  const name = over ?? text;
  makeRoom(undo === undefined ? name : undo.id);
  if (undo === undefined) toast.success(text, { id: name, testId: name, ...(over === undefined ? {} : NOT_KEPT) });
  else sayWithButton(text, undo);
}

/**
 * Say that work goes on in the background. The line stays, with a button that stops the work, until the line that says how the work ended takes its place.
 *
 * @param stop - the button; its `id` names the line
 */
export function sayWorking(text: string, stop: Required<Omit<Undo, "name">>): void {
  // A press on the button leaves the line where it is: one that left would take the line of the work's end with it, which is said under the same name.
  const press = (event: { preventDefault(): void }): void => {
    event.preventDefault();
    pressed(stop);
  };
  makeRoom(stop.id);
  toast.loading(text, { action: { label: stop.label, onClick: press }, duration: Number.POSITIVE_INFINITY, id: stop.id });
}

/** Take away the line said under a name, if it is still shown: its button no longer applies. */
export function unsay(id: string): void {
  toast.dismiss(id);
}

/**
 * Say that a change was refused, in the sentence the server gave.
 *
 * @param over - the name of a line of work whose place the line takes
 */
export function sayRefused(sentence: string, over?: string): void {
  const name = over ?? sentence;
  makeRoom(name);
  toast.error(sentence, { id: name, testId: name, ...(over === undefined ? {} : NOT_KEPT) });
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
