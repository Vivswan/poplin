// The Download menu of the Activity screen: which file each press saves, what is asked of the server first, and how a log longer than one file is saved a file after another.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { DownloadMenu } from "@/activity/download-menu";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BOOT } from "@/lib/boot";

/** The runtime's own `fetch` and the way a link is pressed, put back after each test. */
const OWN = { fetch: globalThis.fetch, click: HTMLAnchorElement.prototype.click };

/** The longest a result may take to leave the page, in milliseconds: it leaves on a timer, which a busy machine runs late. */
const LEAVES_WITHIN = { timeout: 5000 };

/** How long a result that is on its way out stays at the most on an idle machine, with room to spare, in milliseconds: one still there after it has not been taken away. */
const STAYED_MS = 500;

/** What a menu did: the questions it asked of the server, and the addresses it had the browser save. */
interface Done {
  readonly asked: string[];
  readonly saved: string[];
}

/**
 * Draw the menu over the log of one kind, with the server answering each question about the file after a file in turn.
 *
 * The server says each file is read from the place it was asked about, and a first file from place 900.
 *
 * @param places - the place each file's follower goes on from, in the order asked; `null` ends the log, and a sentence refuses
 * @param query - the query of the address the log is at
 */
function drawn(fitsOne: boolean, places: readonly (string | null | { readonly sentence: string })[] = [], query = "kind=sites&after=40"): Done {
  const done: Done = { asked: [], saved: [] };
  const answers = [...places];
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement): void {
    done.saved.push(this.getAttribute("href") ?? "");
  };
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { pathname, search } = new URL(input instanceof Request ? input.url : input, window.location.href);
    done.asked.push(`${pathname.slice(BOOT.base.length)}${search}`);
    const answer = answers.shift() ?? null;
    if (answer !== null && typeof answer === "object") return Response.json({ ok: false, code: "no_more_reading", about: null, ...answer }, { status: 503 });

    return Response.json({ ok: true, from: new URLSearchParams(search).get("after") ?? "900", after: answer });
  }) as typeof fetch;
  render(
    <ThemeProvider storageKey="test.theme">
      <DownloadMenu query={new URLSearchParams(query)} fitsOne={fitsOne} empty={false} />
      <Toaster />
    </ThemeProvider>,
  );

  return done;
}

/** Open the menu and choose one of its entries, and let the menu take in what the server answers. */
async function choose(name: string): Promise<void> {
  await act(async () => fireEvent.click(within(document.body).getByRole("button", { name: "Download" })));
  const item = await within(document.body).findByRole("menuitem", { name });
  await act(async () => {
    fireEvent.click(item);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Wait for words on the page: a line at the top says them, and the line beside the button may too. */
function said(words: string): Promise<HTMLElement[]> {
  return within(document.body).findAllByText((_text, node) => node?.textContent === words);
}

afterEach(() => {
  toast.dismiss();
  cleanup();
  globalThis.fetch = OWN.fetch;
  HTMLAnchorElement.prototype.click = OWN.click;
});
afterAll(clearPage);

describe("the Download menu", () => {
  // Drift: a short log would cost a question to the server before every file, or its file would carry the place of the page shown and hold only the entries behind it.
  test.each([
    ["CSV", "csv"],
    ["JSON Lines", "jsonl"],
  ])("saves a log known to fit one file at once as %s: the filters' entries from the newest, with no number in its name", async (name, format) => {
    const done = drawn(true);
    await choose(name);
    await said("Download started.");

    expect(done).toEqual({ asked: [], saved: [`${BOOT.base}/data/activity/download?format=${format}&kind=sites`] });
  });

  // Drift: a long log could be saved only as its newest part: the next file would start over, repeat the first, lose the format, or two files would be saved under one name.
  // A filtered file may end sooner, so the screen must not say 2,000; a first file read from another place than its end was counted from would leave an entry out between two files.
  test.each([
    ["the whole log, whose files are full", "after=40", "", "Downloaded 2,000.", "Next 2,000"],
    ["a filtered log, whose file may end sooner", "kind=sites&after=40", "&kind=sites", "Downloaded a part.", "Next part"],
  ])("saves %s a file after another: each is read from the place the server names, numbered, until the log ends", async (_what, query, kept, done, next) => {
    const menu = drawn(false, ["150", null], query);
    await choose("CSV");
    await said(done);
    const offered = within(document.body).getAllByRole("button", { name: next }).length;
    await choose(next);
    await said("Downloaded the last part.");

    expect([offered, within(document.body).queryByRole("button", { name: next }), menu]).toEqual([
      1,
      null,
      {
        asked: [`/data/activity/download/next${kept.replace("&", "?")}`, `/data/activity/download/next?${kept.slice(1)}${kept === "" ? "" : "&"}after=150`],
        saved: [`${BOOT.base}/data/activity/download?format=csv${kept}&after=900&part=1`, `${BOOT.base}/data/activity/download?format=csv${kept}&after=150&part=2`],
      },
    ]);
  });

  // Drift: an older result would keep its own way to the next file, which saves the last file twice once the log is done.
  // A result pressed for the next file would take the newer result away with it, or the focus would be lost with the button that saved the last file.
  test.each([
    ["the toolbar", "Next 2,000"],
    ["the result", "Download the next 2,000"],
  ])("with the second file asked for from %s, keeps one result with a way to the next file at a time, none once the last file is saved, and then gives the focus to Download", async (_from, second) => {
    const menu = drawn(false, ["150", "300", null], "after=40");
    const ways = (): number => within(document.body).queryAllByRole("button", { name: "Download the next 2,000" }).length;
    const settle = (ms: number): Promise<void> => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));
    const press = async (name: string): Promise<void> => {
      const button = within(document.body).getByRole("button", { name });
      button.focus();
      fireEvent.click(button);
      await settle(0);
    };
    await choose("CSV");
    await said("Downloaded 2,000.");

    // A result that was pressed leaves a moment after the press, at no fixed time: the count is waited for, and one that stayed at two would never come.
    await press(second);
    await waitFor(() => expect([menu.saved.length, ways()]).toEqual([2, 1]), LEAVES_WITHIN);
    // The one result left is the newer one, which stays: it is still there once a result on its way out would be gone.
    await settle(STAYED_MS);
    const stayed = ways();
    await press("Next 2,000");
    await said("Downloaded the last part.");
    await waitFor(() => expect(ways()).toBe(0), LEAVES_WITHIN);

    expect([stayed, menu.saved.map((address) => new URL(address, window.location.href).searchParams.get("part")), document.activeElement?.getAttribute("aria-label")]).toEqual([1, ["1", "2", "3"], "Download"]);
  });

  // Drift: a result would outlive the screen it was said on, and a download begun after coming back would stand beside it, two ways to a next file at once.
  test("takes its result with the way to the next file away when the screen is left", async () => {
    drawn(false, ["150"], "after=40");
    await choose("CSV");
    await said("Downloaded 2,000.");
    const shown = toast.getToasts().length;

    cleanup();

    expect([shown, toast.getToasts().length]).toEqual([1, 0]);
  });

  // Drift: a refusal of the server would be followed by a file that holds the refusal, saved under the log's name.
  test("saves nothing when the server refuses to say where a file ends, and says the server's sentence", async () => {
    const done = drawn(false, [{ sentence: "The dashboard is paused." }]);
    await choose("CSV");
    await said("The dashboard is paused.");

    expect(done.saved).toEqual([]);
  });
});
