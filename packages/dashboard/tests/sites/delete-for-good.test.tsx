// Deleting a site in the trash for good: what arms the button, what a done delete says and leaves, and where a refusal is said.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { Fragment, type ReactNode, StrictMode } from "react";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BOOT } from "@/lib/boot";
import type { Site } from "@/lib/sites";
import { DeleteForGood } from "@/sites/delete-for-good";
import { DeleteForGoodQuestion } from "@/sites/delete-for-good-question";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** What the server refuses the delete with. */
const REFUSAL = "The site is not in the trash.";

/** A site in the trash as the server answers it, as far as the control reads it: its title is not its name. */
const SITE = { label: "trip-notes--abc123def456", name: "trip-notes", title: "Trip notes", state: "trash" } as unknown as Site;

/** What a drawn control did. */
interface Done {
  /** The path of every change it sent. */
  readonly sent: string[];

  /** How often it said the site is gone. */
  gone: number;
}

/** How the server answers, and how the page is drawn. */
interface Scene {
  /** Whether the server refuses every delete. */
  readonly refuses?: boolean;

  /** Whether the page is drawn as a development build draws it, with every effect set up twice. */
  readonly strict?: boolean;

  /** What an answer waits for before it comes in; it comes in at once when left out. */
  readonly until?: Promise<void>;
}

/** Draw the control and the question it asks, with the server doing every delete or refusing every one. */
function drawn(look: "menu" | "button", { refuses = false, strict = false, until }: Scene = {}): Done & { readonly leave: () => void } {
  const done: Done = { sent: [], gone: 0 };
  const Mode = strict ? StrictMode : Fragment;
  globalThis.fetch = (async (input: Request | string | URL) => {
    done.sent.push(new URL(input instanceof Request ? input.url : input, window.location.href).pathname.slice(BOOT.base.length));
    await until;

    return refuses ? Response.json({ ok: false, code: "not_in_trash", about: null, sentence: REFUSAL }, { status: 409 }) : Response.json({ ok: true, site: null });
  }) as typeof fetch;
  const client = new QueryClient();
  const page = (screen: boolean): ReactNode => (
    <Mode>
      <ThemeProvider storageKey="test.theme">
        <QueryClientProvider client={client}>
          {screen ? <DeleteForGood site={SITE} look={look} onGone={() => (done.gone += 1)} /> : null}
          {screen ? <DeleteForGoodQuestion /> : null}
        </QueryClientProvider>
        <Toaster />
      </ThemeProvider>
    </Mode>
  );
  const { rerender } = render(page(true));

  return Object.assign(done, { leave: () => rerender(page(false)) });
}

/** Press a control, and let the dialog take in what follows. */
async function press(control: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(control);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Open the question from a button, and answer what it is read through. */
async function ask(): Promise<ReturnType<typeof within>> {
  await press(within(document.body).getByRole("button", { name: "Delete for good" }));

  return within(await within(document.body).findByRole("alertdialog"));
}

/** Type into the question's field. */
async function type(dialog: ReturnType<typeof within>, text: string): Promise<void> {
  await act(async () => fireEvent.change(dialog.getByRole("textbox", { name: "Site's name" }), { target: { value: text } }));
}

afterEach(() => {
  toast.dismiss();
  cleanup();
  globalThis.fetch = OWN_FETCH;
});
afterAll(clearPage);

describe("deleting a site in the trash for good", () => {
  // Drift: a press of Enter on an opened question would delete at once, or the title, which a row shows, would arm a button that asks for the name.
  test("asks first, with the focus on Cancel and the button off until the site's name is typed, not its title", async () => {
    const done = drawn("button");
    const dialog = await ask();
    const button = (): boolean => dialog.getByRole("button", { name: "Delete for good" }).hasAttribute("disabled");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    const states = [button()];
    for (const typed of ["Trip notes", "trip-note", "trip-notes"]) {
      await type(dialog, typed);
      states.push(button());
    }

    expect([dialog.getByRole("heading").textContent, document.querySelector("[data-slot='field-description']")?.textContent, states, [done.sent, done.gone]]).toEqual([
      "Delete Trip notes for good?",
      "Type trip-notes to delete it.",
      [true, true, true, false],
      [[], 0],
    ]);
  });

  // Drift: a done delete would offer an Undo that nothing can do, leave its question open, or not tell the screen that the site is gone.
  // A development build sets every effect up twice: a screen that took the first teardown for its leaving would tell nobody that the site is gone, and the panel of the gone site would stay open.
  test.each([
    ["a shipped build", false],
    ["a development build", true],
  ] as const)("sends the delete once the name is typed, says it in a line with no button, tells the screen once, and closes, in %s", async (_build, strict) => {
    const done = drawn("button", { strict });
    const dialog = await ask();
    await type(dialog, "trip-notes");
    await press(dialog.getByRole("button", { name: "Delete for good" }));
    await within(document.body).findAllByText((_text, node) => node?.textContent === "Trip notes deleted for good.");
    await waitFor(() => expect(within(document.body).queryAllByRole("alertdialog").length).toBe(0));

    expect([done.sent, done.gone, document.querySelectorAll("[data-sonner-toast] button").length]).toEqual([[`/data/sites/${SITE.label}/delete-for-good`], 1, 0]);
  });

  // Drift: a delete that ends after its screen was left would close a panel of the screen a person is on by then.
  test.each([
    ["a shipped build", false],
    ["a development build", true],
  ] as const)("a delete that is done after its screen was left is said, and tells no screen that the site is gone, in %s", async (_build, strict) => {
    const answer = Promise.withResolvers<void>();
    const done = drawn("button", { strict, until: answer.promise });
    const dialog = await ask();
    await type(dialog, "trip-notes");
    await press(dialog.getByRole("button", { name: "Delete for good" }));
    await act(async () => done.leave());
    await act(async () => answer.resolve());
    await waitFor(() => expect(within(document.body).queryAllByText("Trip notes deleted for good.").length).toBe(1));

    expect([done.sent.length, done.gone]).toEqual([1, 0]);
  });

  // Drift: a refused delete would be said as done, close the question, or empty the name that was typed.
  test("says a refusal at the field, with the typed name kept and the site not told as gone", async () => {
    const done = drawn("button", { refuses: true });
    const dialog = await ask();
    await type(dialog, "trip-notes");
    await press(dialog.getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(dialog.queryAllByRole("alert").map((alert) => alert.textContent)).toEqual([REFUSAL]));

    expect([(dialog.getByRole("textbox") as HTMLInputElement).value, done.gone, within(document.body).queryAllByText("Trip notes deleted for good.").length]).toEqual(["trip-notes", 0, 0]);
  });

  // Drift: a row of the trash would show a red button beside Restore, or its menu would delete with no question.
  test("stands in a row as a menu with the one entry, which opens the same question and sends nothing", async () => {
    const done = drawn("menu");
    await press(within(document.body).getByRole("button", { name: "More for Trip notes" }));
    const entries = (await within(document.body).findAllByRole("menuitem")).map((entry) => entry.textContent);
    await press(within(document.body).getByRole("menuitem", { name: "Delete for good" }));
    const asked = (await within(document.body).findAllByRole("alertdialog")).length;

    expect([entries, asked, done.sent, done.gone]).toEqual([["Delete for good"], 1, [], 0]);
  });
});
