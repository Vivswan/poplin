// When a site deletes itself, in its panel: what the menu shows before a save, what each choice sends, and where a refusal is said.

import { clearPage } from "../../lib/support/page";

import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { readExpires } from "@poplin/core/src/actions/sites/changes";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BOOT } from "@/lib/boot";
import type { Site } from "@/lib/sites";
import { dayIn, momentIn } from "@/lib/timezone";
import { PanelFacts } from "@/shared/side-panel";
import { ExpiryRow } from "@/sites/expiry/expiry-row";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** How a moment is written: the day with two figures, and the time to the minute. */
const MOMENT = String.raw`\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}`;

/** A moment as it is sent: in UTC, to the millisecond. */
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** A minute in milliseconds. */
const MINUTE_MS = 60_000;

/** The moment a menu opens at, in the test that moves the clock. */
const OPENED = Date.UTC(2031, 4, 6, 12, 0, 0);

/** What the server refuses a change with. */
const REFUSAL = "Pick a day that is still ahead.";

/** A site as the server answers it, as far as the row reads it. */
const SITE = { label: "trip-notes--abc123def456", name: "trip-notes", title: "Trip notes", expires: "never", state: "live" } as unknown as Site;

/** Every change the row sent: where to, and what. */
interface Sent {
  readonly path: string;
  readonly body: unknown;
}

/**
 * Draw the row of a site, with the server taking every change or refusing every one.
 *
 * @param stores - when the site deletes itself in the answer to every change
 * @returns the changes the row sends, as they come in
 */
function drawn(expires: Site["expires"], refuses = false, stores: Site["expires"] = "never"): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(input, window.location.href), init);
    sent.push({ path: new URL(request.url).pathname.slice(BOOT.base.length), body: await request.json() });
    if (refuses) return Response.json({ ok: false, code: "bad_argument", about: "expires", sentence: REFUSAL }, { status: 400 });

    return Response.json({ ok: true, site: { ...SITE, expires: stores } });
  }) as typeof fetch;
  render(
    <ThemeProvider storageKey="test.theme">
      <QueryClientProvider client={new QueryClient()}>
        <PanelFacts>
          <ExpiryRow site={{ ...SITE, expires }} />
        </PanelFacts>
      </QueryClientProvider>
      <Toaster />
    </ThemeProvider>,
  );

  return sent;
}

/** Open the menu and wait for its entries. */
async function openMenu(): Promise<void> {
  await act(async () => fireEvent.click(within(document.body).getByRole("button", { name: "Change when it expires" })));
  await waitFor(() => expect(within(document.body).queryAllByRole("menuitem", { name: "Never" }).length).toBe(1));
}

/** Press an entry of the open menu, or a button, and let the row take in what the server answers. */
async function press(role: "menuitem" | "button", name: string | RegExp): Promise<void> {
  const control = within(document.body).getByRole(role, { name });
  await act(async () => {
    fireEvent.click(control);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Wait for a line at the top that says the words. */
async function said(words: string): Promise<void> {
  await waitFor(() => expect(within(document.body).queryAllByText(words).length).toBeGreaterThan(0));
}

/** What the fact says, without its button. */
function fact(): string {
  return (document.querySelector("dd")?.textContent ?? "").replace("Change", " | ");
}

afterEach(() => {
  toast.dismiss();
  cleanup();
  globalThis.fetch = OWN_FETCH;
  setSystemTime();
});
afterAll(clearPage);

describe("when a site deletes itself, in its panel", () => {
  // Drift: the fact would write a bare day or a span, say nothing of what happens then, or offer Never to a site that never ends.
  test.each([
    ["a site that never does", "never", /^Never \| $/, "true"],
    ["a site that does later", Date.now() + DAY_MS, new RegExp(`^${MOMENT} \\| Then its link stops working, and it moves to the trash\\.$`), null],
    ["a site whose moment has passed", Date.now() - DAY_MS, new RegExp(`^${MOMENT} \\| Its link has stopped working\\. It moves to the trash soon\\.$`), null],
  ] as const)("says the moment and what happens then, for %s", async (_what, expires, says, neverOff) => {
    drawn(expires);
    const read = fact();
    await openMenu();

    expect([says.test(read), within(document.body).getByRole("menuitem", { name: "Never" }).getAttribute("aria-disabled")]).toEqual([true, neverOff]);
  });

  // Drift: a span would be shown as a span alone, so the day it ends on is known only after the save; or Undo would not send what the site had before.
  test("each span is written with the moment it ends; a choice is said with Undo, which sends what the site had", async () => {
    const sent = drawn("never");
    await openMenu();
    const entries = within(document.body)
      .getAllByRole("menuitem")
      .map((entry) => entry.textContent ?? "");
    await press("menuitem", /^7 days/);
    await said("Saved.");
    await press("button", "Undo");
    await said("Put back.");

    expect(entries.map((entry) => entry.replace(new RegExp(MOMENT), " <moment>"))).toEqual(["1 day <moment>", "7 days <moment>", "30 days <moment>", "On a day...", "Never"]);
    expect(sent.map((change) => [change.path, String((change.body as { readonly expires?: string }).expires).replace(ISO_MOMENT, "<moment>")])).toEqual([
      [`/data/sites/${SITE.label}/expiry`, "<moment>"],
      [`/data/sites/${SITE.label}/expiry`, "never"],
    ]);
  });

  // Drift: a choice would save a span counted from the press, so a menu that stood open for ten minutes would store a moment ten minutes after the one it wrote.
  test("a choice pressed ten minutes after the menu opened saves the moment the menu wrote", async () => {
    setSystemTime(new Date(OPENED));
    const sent = drawn("never");
    await openMenu();
    const written = within(document.body).getByRole("menuitem", { name: /^7 days/ }).textContent;
    setSystemTime(new Date(OPENED + 10 * MINUTE_MS));
    await press("menuitem", /^7 days/);
    await said("Saved.");

    expect([written, sent.map((change) => change.body)]).toEqual([`7 days${momentIn(OPENED + 7 * DAY_MS)}`, [{ expires: new Date(OPENED + 7 * DAY_MS).toISOString() }]]);
  });

  // Drift: Undo after a second change would put back what the panel last read, not what the change before it stored: a site set to 7 days and then to 30 would end with no expiry.
  test("Undo puts back what the change before stored, also while the panel has not read it yet", async () => {
    const stored = Date.now() + 7 * DAY_MS;
    const sent = drawn("never", false, stored);
    await openMenu();
    await press("menuitem", /^7 days/);
    await said("Saved.");
    await act(async () => void toast.dismiss());
    await waitFor(() => expect(within(document.body).queryAllByRole("button", { name: "Undo" }).length).toBe(0));
    await openMenu();
    await press("menuitem", /^30 days/);
    await press("button", "Undo");
    await said("Put back.");

    expect(sent.map((change) => String((change.body as { readonly expires?: string }).expires).replace(ISO_MOMENT, (moment) => (moment === new Date(stored).toISOString() ? "<stored>" : "<moment>")))).toEqual(["<moment>", "<moment>", "<stored>"]);
  });

  // Drift: a refused change would be said in a line that leaves, or as done, with nothing at the control it was chosen at.
  test("a refused choice is said under the fact, which stays as it was, and no line says it is saved", async () => {
    drawn("never", true);
    await openMenu();
    await press("menuitem", /^30 days/);
    await waitFor(() => expect(within(document.body).queryAllByRole("alert").map((alert) => alert.textContent)).toEqual([REFUSAL]));

    expect([fact(), within(document.body).queryAllByText("Saved.").length]).toEqual([`Never | ${REFUSAL}`, 0]);
  });

  // Drift: a day would be saved with no word of the moment it starts at, or the button would save before a day is picked; a refused day would close the dialog and lose the day.
  test("a day is picked in a dialog that writes the moment it starts, sends it once Save is pressed, and keeps the day when it is refused", async () => {
    const sent = drawn("never", true);
    await openMenu();
    await press("menuitem", "On a day...");
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Pick a day" }));
    const before = [dialog.getByText("No day picked.").textContent, dialog.getByRole("button", { name: "Save" }).hasAttribute("disabled")];
    const day = dialog.getAllByRole("button").find((button) => button.closest("td") !== null && !button.hasAttribute("disabled"));
    await act(async () => fireEvent.click(day as HTMLElement));
    const picked = dialog.getByText(/^Expires /).textContent;
    await press("button", "Save");
    await waitFor(() => expect(dialog.queryAllByRole("alert").map((alert) => alert.textContent)).toEqual([REFUSAL]));

    expect([before, /^Expires \d{2} [A-Z][a-z]{2} \d{4}, 00:00$/.test(picked ?? "")]).toEqual([["No day picked.", true], true]);
    // What was sent is read as the server reads it: the midnight the dialog wrote, in the browser's own time zone.
    const set = new Date(Number(readExpires(String((sent[0]?.body as { readonly expires?: string } | undefined)?.expires), Date.now())));
    const kept = document.querySelectorAll("[data-selected-single='true']").length;

    expect([sent.length, picked?.includes(dayIn(set.getTime(), "own")), [set.getHours(), set.getMinutes()], kept]).toEqual([1, true, [0, 0], 1]);
  });
});
