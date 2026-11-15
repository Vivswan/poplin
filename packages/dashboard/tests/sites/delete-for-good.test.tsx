// Deleting a site in the trash for good: what arms the button, what a done delete says and leaves, and where a refusal is said.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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

/** Draw the control and the question it asks, with the server doing every delete or refusing every one. */
function drawn(refuses = false): Done {
  const done: Done = { sent: [], gone: 0 };
  globalThis.fetch = (async (input: Request | string | URL) => {
    done.sent.push(new URL(input instanceof Request ? input.url : input, window.location.href).pathname.slice(BOOT.base.length));

    return refuses ? Response.json({ ok: false, code: "not_in_trash", about: null, sentence: REFUSAL }, { status: 409 }) : Response.json({ ok: true, site: null });
  }) as typeof fetch;
  render(
    <ThemeProvider storageKey="test.theme">
      <QueryClientProvider client={new QueryClient()}>
        <DeleteForGood site={SITE} onGone={() => (done.gone += 1)} />
        <DeleteForGoodQuestion />
      </QueryClientProvider>
      <Toaster />
    </ThemeProvider>,
  );

  return done;
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
    const done = drawn();
    const dialog = await ask();
    const button = (): boolean => dialog.getByRole("button", { name: "Delete for good" }).hasAttribute("disabled");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    const states = [button()];
    for (const typed of ["Trip notes", "trip-note", "trip-notes"]) {
      await type(dialog, typed);
      states.push(button());
    }

    expect([dialog.getByRole("heading").textContent, document.querySelector("[data-slot='field-description']")?.textContent, states, done]).toEqual([
      "Delete Trip notes for good?",
      "Type trip-notes to delete it.",
      [true, true, true, false],
      { sent: [], gone: 0 },
    ]);
  });

  // Drift: a done delete would offer an Undo that nothing can do, leave its question open, or not tell the screen that the site is gone.
  test("sends the delete once the name is typed, says it in a line with no button, and closes", async () => {
    const done = drawn();
    const dialog = await ask();
    await type(dialog, "trip-notes");
    await press(dialog.getByRole("button", { name: "Delete for good" }));
    await within(document.body).findAllByText((_text, node) => node?.textContent === "Trip notes deleted for good.");
    await waitFor(() => expect(within(document.body).queryAllByRole("alertdialog").length).toBe(0));

    expect([done, document.querySelectorAll("[data-sonner-toast] button").length]).toEqual([{ sent: [`/data/sites/${SITE.label}/delete-for-good`], gone: 1 }, 0]);
  });

  // Drift: a refused delete would be said as done, close the question, or empty the name that was typed.
  test("says a refusal at the field, with the typed name kept and the site not told as gone", async () => {
    const done = drawn(true);
    const dialog = await ask();
    await type(dialog, "trip-notes");
    await press(dialog.getByRole("button", { name: "Delete for good" }));
    await waitFor(() => expect(dialog.queryAllByRole("alert").map((alert) => alert.textContent)).toEqual([REFUSAL]));

    expect([(dialog.getByRole("textbox") as HTMLInputElement).value, done.gone, within(document.body).queryAllByText("Trip notes deleted for good.").length]).toEqual(["trip-notes", 0, 0]);
  });
});
