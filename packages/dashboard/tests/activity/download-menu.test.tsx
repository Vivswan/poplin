// The Download menu of the Activity screen: which file each press saves, what is asked of the server first, and how a log longer than one file is saved a file after another.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { toast } from "sonner";

import { DownloadMenu } from "@/activity/download-menu";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BOOT } from "@/lib/boot";

/** The runtime's own `fetch` and the way a link is pressed, put back after each test. */
const OWN = { fetch: globalThis.fetch, click: HTMLAnchorElement.prototype.click };

/** What a menu did: the questions it asked of the server, and the addresses it had the browser save. */
interface Done {
  readonly asked: string[];
  readonly saved: string[];
}

/**
 * Draw the menu over the log of one kind, with the server answering each question about the file after a file in turn.
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

    return Response.json({ ok: true, after: answer });
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
  // A file of a filtered log may end where its search stopped, so the screen would say 2,000 entries were saved when the file holds fewer.
  test.each([
    ["the whole log, whose files are full", "after=40", "", "Downloaded 2,000.", "Next 2,000"],
    ["a filtered log, whose file may end sooner", "kind=sites&after=40", "&kind=sites", "Downloaded a part.", "Next part"],
  ])("saves %s a file after another: each goes on from the place the server names, numbered, until the log ends", async (_what, query, kept, done, next) => {
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
        saved: [`${BOOT.base}/data/activity/download?format=csv${kept}&part=1`, `${BOOT.base}/data/activity/download?format=csv${kept}&after=150&part=2`],
      },
    ]);
  });

  // Drift: a refusal of the server would be followed by a file that holds the refusal, saved under the log's name.
  test("saves nothing when the server refuses to say where a file ends, and says the server's sentence", async () => {
    const done = drawn(false, [{ sentence: "The dashboard is paused." }]);
    await choose("CSV");
    await said("The dashboard is paused.");

    expect(done.saved).toEqual([]);
  });
});
