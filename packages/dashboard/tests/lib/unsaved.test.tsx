// Typing into a dialog counts as unsaved while the dialog is open: a login that ended then leaves the page as it is, where a page with nothing typed loads again.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import { answerOf, api, Refused } from "@/lib/api";
import type { Site } from "@/lib/sites";
import { EditSiteDialog, type NamingRefusal } from "@/sites/edit-site-dialog";

/** The site the dialog is opened for. */
const SITE = {
  id: "abc123def456",
  label: "trip-notes--abc123def456",
  name: "trip-notes",
  public_name: null,
  title: "Trip notes",
  title_typed: true,
  access: "private",
  url: "https://example.com/trip-notes/",
  addresses: { site: "https://example.com/trip-notes/", public: null },
  search_engines: true,
  embeddable: false,
  expires: "never",
  versions: [{ number: 1, published: 1_700_000_000_000, published_by: "mira@example.com" }],
  live_version: 1,
  bytes: 2048,
  files: 3,
  updated: 1_700_000_000_000,
  state: "live",
  views: { today: 0, week: 0 },
} as unknown as Site;

/** Ask a data route as the page does, and tell a refusal as the dialog shows it. */
async function asked(): Promise<NamingRefusal | undefined> {
  try {
    await answerOf(api.frame.$get());

    return undefined;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;

    return { about: null, sentence: error.message };
  }
}

/** The dialog's field for the title. */
function titleField(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  for (const shown of toast.getToasts()) toast.dismiss(shown.id);
});

afterAll(clearPage);

describe("a login that ended while a dialog is open", () => {
  // Drift: a dialog would hold typing the page knows nothing of, so a Save, or a read in the background, that the login's end refuses would load the page again and drop what was typed.
  test("leaves the page and what was typed into the dialog as they are, with the line that leads to the login", async () => {
    using _server = spyOn(globalThis, "fetch").mockImplementation((async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch);
    using reload = spyOn(window.location, "reload").mockImplementation(() => undefined);
    render(<EditSiteDialog site={SITE} onClose={() => undefined} onSave={asked} />);
    fireEvent.input(titleField(), { target: { value: "Trip notes, day two" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    await waitFor(() => expect(toast.getToasts()).toHaveLength(1));

    expect([titleField().value, reload.mock.calls.length]).toEqual(["Trip notes, day two", 0]);
  });

  // Drift: an open dialog would hold the page whether or not anything was typed into it, so a page with nothing to lose would stay on a failure nobody can act on.
  test("loads the page again where nothing was typed into the dialog", async () => {
    using _server = spyOn(globalThis, "fetch").mockImplementation((async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch);
    using reload = spyOn(window.location, "reload").mockImplementation(() => undefined);
    render(<EditSiteDialog site={SITE} onClose={() => undefined} onSave={asked} />);
    titleField().focus();
    await asked();

    expect([reload.mock.calls.length, toast.getToasts().length]).toEqual([1, 0]);
  });

  // Drift: a dialog that was typed into would go on holding the page once it is closed, when what was typed is gone already.
  test("loads the page again once a dialog that was typed into has closed", async () => {
    using _server = spyOn(globalThis, "fetch").mockImplementation((async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch);
    using reload = spyOn(window.location, "reload").mockImplementation(() => undefined);
    const { rerender } = render(<EditSiteDialog site={SITE} onClose={() => undefined} onSave={asked} />);
    fireEvent.input(titleField(), { target: { value: "Trip notes, day two" } });
    rerender(<EditSiteDialog site={undefined} onClose={() => undefined} onSave={asked} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await asked();

    expect([reload.mock.calls.length, toast.getToasts().length]).toEqual([1, 0]);
  });
});
