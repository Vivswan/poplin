// Leaving a screen that holds unsaved typing: which moves wait for the question, what each answer does, and what is asked of the browser itself.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { type AnyRouter, useLocation } from "@tanstack/react-router";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";

import { BOOT } from "@/lib/boot";
import { LeaveGuard } from "@/shared/leave-guard";

import { drawAt } from "../lib/support/router";

/** The path of the screen the guard is on. */
const HOME = "/settings";

/** The path of another screen. */
const AWAY = "/domain";

/** A move a test makes, through the router or the browser. */
type Move = (router: AnyRouter) => void;

function toAway(router: AnyRouter): void {
  void router.navigate({ to: AWAY });
}

function toOwnQuery(router: AnyRouter): void {
  void router.navigate({ to: HOME, search: { kind: "sites" } });
}

/** Go back in the browser's history, as its Back button does: the address has changed by the time the router hears of it. */
function back(): void {
  window.history.back();
}

function none(): void {}

/** A page that says which place is drawn, with the guard on the one screen that holds typing, and a Save that leaves nothing unsaved. */
function Guarded({ unsaved }: { readonly unsaved: boolean }): ReactNode {
  const path = useLocation({ select: (location) => location.pathname });
  const [saved, setSaved] = useState(false);

  return (
    <>
      <output>{path}</output>
      <button type="button" onClick={() => setSaved(true)}>
        Save
      </button>
      <LeaveGuard unsaved={unsaved && !saved && path === HOME} />
    </>
  );
}

/** Ask the browser's question, as closing or reloading the tab does, and say whether the page had it asked. */
function unloadAsked(): boolean {
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);

  return unload.defaultPrevented;
}

/** Let the router finish what a move or an answer started. */
async function settled(start: () => void): Promise<void> {
  await act(async () => {
    start();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Come to the guarded screen from another one, make one move, and hand back the page's queries. */
async function moved(unsaved: boolean, move: Move): Promise<Within> {
  const router = await drawAt(AWAY, <Guarded unsaved={unsaved} />);
  await settled(() => void router.navigate({ to: HOME }));
  await settled(() => move(router));

  return within(document.body);
}

/** What the page shows: the place drawn, the browser's address, and whether the question is open. */
function shown(page: Within): readonly [string | null, string, boolean] {
  // The open question hides the rest of the page from a query by role, so the place is read from its element.
  return [
    document.querySelector("output")?.textContent ?? null,
    `${window.location.pathname}${window.location.search}`,
    page.queryByRole("alertdialog") !== null,
  ];
}

afterEach(cleanup);
afterAll(async () => {
  // What the last test drew is taken down a moment after it ends: the page stays until then.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearPage();
});

describe("leaving a screen", () => {
  // Drift: a screen with nothing typed would ask before every move, one with typing would let a move drop it without a word, or a search on the same screen would be held as if it left.
  test.each([
    ["with nothing unsaved goes at once", false, toAway, [AWAY, `${BOOT.base}${AWAY}`, false]],
    ["with typing unsaved waits behind the question", true, toAway, [HOME, `${BOOT.base}${HOME}`, true]],
    ["to another query of the same screen is not held", true, toOwnQuery, [HOME, `${BOOT.base}${HOME}?kind=sites`, false]],
    ["by the browser's Back keeps the screen drawn behind the question", true, back, [HOME, `${BOOT.base}${AWAY}`, true]],
  ] as const)("%s", async (_name, unsaved, move, after) => {
    expect(shown(await moved(unsaved, move))).toEqual([...after]);
  });

  // Drift: Leave would not make the held move, or Stay would leave the address at the place Back had gone to already.
  test.each([
    ["Leave makes a held move", toAway, "Leave", [AWAY, `${BOOT.base}${AWAY}`, false]],
    ["Stay drops a held move", toAway, "Stay", [HOME, `${BOOT.base}${HOME}`, false]],
    ["Leave after Back draws the place the browser is at", back, "Leave", [AWAY, `${BOOT.base}${AWAY}`, false]],
    ["Stay after Back puts the screen's own address back", back, "Stay", [HOME, `${BOOT.base}${HOME}`, false]],
  ] as const)("%s", async (_name, move, pressed, after) => {
    const page = await moved(true, move);
    await settled(() => fireEvent.click(page.getByRole("button", { name: pressed })));

    expect(shown(page)).toEqual([...after]);
  });

  // Drift: closing or reloading the tab would drop the typing with no question from the browser, or a screen with nothing typed would be asked about.
  test.each([
    [true, true],
    [false, false],
  ])("asks the browser before the tab unloads only while typing is unsaved: %p", async (unsaved, asked) => {
    await moved(unsaved, none);

    expect(unloadAsked()).toBe(asked);
  });

  // Drift: the browser's question would stay armed on every screen after the typing was saved or left behind, and ask about nothing.
  test.each([
    ["Save", none, "Save"],
    ["Leave", toAway, "Leave"],
    ["Leave after Back", back, "Leave"],
  ] as const)("stops asking the browser once the typing is gone by %s", async (_name, move, pressed) => {
    const page = await moved(true, move);
    const before = unloadAsked();
    await settled(() => fireEvent.click(page.getByRole("button", { name: pressed })));

    expect([before, unloadAsked()]).toEqual([true, false]);
  });
});
