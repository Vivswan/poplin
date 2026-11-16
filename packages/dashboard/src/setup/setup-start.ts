// What the setup page hands the client to start from, and how the setup screen sends its run.

import type { SetupRoutes, SetupStart } from "@poplin/app/src/console/setup-console";
import { hc, type InferResponseType } from "hono/client";

import { BOOT } from "@/lib/boot";

/** What the setup screen starts from: which boxes its form has, and what a token must hold. Nothing in it is of the install. */
export type Start = SetupStart;

/** A kind of install a person chooses on an install with nothing set: under a domain of their own, or with none. */
export type Kind = keyof Extract<Start, { readonly boxes: "first" }>["forms"];

/** Which form the screen shows: the one of the chosen kind on an install with nothing set, the one of an install nobody has logged in to, or the one that only repairs an install somebody has. */
export type Boxes = Kind | "login" | "repair";

/** The start values of the setup screen, out of the ones the page carries; `null` on every page but the setup page. */
export const SETUP: Start | null = (BOOT as typeof BOOT & { readonly setup?: Start }).setup ?? null;

/** The setup screen's runs, called as `setupApi.repair.$post({ json })`. */
export const setupApi = hc<SetupRoutes>(`${BOOT.base}/data`);

/** A run of the setup screen that read its pieces, as the server answers it. */
export type SetupRan = InferResponseType<typeof setupApi.repair.$post, 200>;

/**
 * Say which form the screen shows, and what a token must hold for it.
 *
 * @param kind - the kind of install chosen, which only an install with nothing set asks
 */
export function shownOf(start: Start, kind: Kind): { readonly boxes: Boxes; readonly form: Exclude<Start, { readonly boxes: "first" }>["form"] } {
  return start.boxes === "first" ? { boxes: kind, form: start.forms[kind] } : { boxes: start.boxes, form: start.form };
}
