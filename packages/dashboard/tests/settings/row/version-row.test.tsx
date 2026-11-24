// The row of the version on the Settings screen: what it says in each state of the install, and what its two starts send.

import { clearPage } from "../../lib/support/page";

import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { FRAME_KEY } from "@/lib/frame";
import { VersionRow } from "@/settings/row/version-row";
import { AppShell } from "@/shell/app-shell";
import { drawAt } from "../../lib/support/router";

/** The frame of an install that holds no key, knows of no newer release, and has no way back. */
const FRAME = { ok: true, update: null, starts: false, back: null, domainNote: null, recent: [], marks: { usage: null, domain: null, settings: null } } as const;

/** A newer release the install knows of. */
const NEWER = { current: BOOT.version, newest: "1.1.0", released: "2026-11-02", notes: "https://example.com/notes", database: false } as const;

/** The way back of an install that came to its version by an update, on the first of December 2026. */
const BACK = { to: "0.9.0", since: Date.UTC(2026, 11, 1, 12) } as const;

/** What stands where the start of an update would, on an install that holds no key. */
const NO_KEY = "The install holds no key, so it cannot update itself. Open Domain and press Repair.";

/** What the row says of a release that changes the database. */
const DATABASE = "This release changes the database, so it never starts by itself.";

/** The states of an install, each with what the row then holds: its words as one text, and its buttons. */
const STATES = [
  { name: "the version alone, while nothing newer is known and there is no way back", frame: {}, says: `Version${BOOT.version}`, buttons: [] },
  { name: "a newer release with its notes and the start of the update, on an install that holds its key", frame: { update: NEWER, starts: true }, says: `Version${BOOT.version}1.1.0 is out. What changedUpdate now`, buttons: ["Update now"] },
  {
    name: "a newer release and no start, on an install that holds no key",
    frame: { update: NEWER },
    says: `Version${BOOT.version}1.1.0 is out. What changed${NO_KEY}`,
    buttons: [],
  },
  {
    name: "that a release changes the database, and to press Update now, on an install that holds its key",
    frame: { update: { ...NEWER, database: true }, starts: true },
    says: `Version${BOOT.version}1.1.0 is out. What changed${DATABASE} Press Update now.Update now`,
    buttons: ["Update now"],
  },
  {
    name: "that a release changes the database, with nothing to press, on an install that holds no key",
    frame: { update: { ...NEWER, database: true } },
    says: `Version${BOOT.version}1.1.0 is out. What changed${DATABASE}${NO_KEY}`,
    buttons: [],
  },
  { name: "since when the version runs, and the way back, after an update", frame: { back: BACK, starts: true }, says: `Version${BOOT.version}, since 2026-12-01Go back to 0.9.0`, buttons: ["Go back to 0.9.0"] },
  { name: "since when the version runs, and no way back, on an install that holds no key", frame: { back: BACK }, says: `Version${BOOT.version}, since 2026-12-01`, buttons: [] },
  {
    name: "the way back over the newer release, where the install has both",
    frame: { back: BACK, update: NEWER, starts: true },
    says: `Version${BOOT.version}, since 2026-12-01Go back to 0.9.01.1.0 is out. What changedUpdate now`,
    buttons: ["Go back to 0.9.0", "Update now"],
  },
] as const;

/** A request as the row sent it. */
function sent(input: Request | string | URL, init?: RequestInit): Request {
  return input instanceof Request ? input : new Request(new URL(String(input), window.location.href), init);
}

/** Draw the row inside the frame of the Settings screen, over a frame that holds what a test sets. */
async function drawWith(more: object = {}): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(FRAME_KEY, { ...FRAME, ...more });

  await drawAt(
    "/settings",
    <QueryClientProvider client={client}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <AppShell current="settings" heading="Settings">
            <VersionRow marked={false} />
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The row, or `null` where none is drawn. */
function row(): HTMLElement | null {
  return document.getElementById("setting-version");
}

afterEach(() => {
  cleanup();
  mock.restore();
});
afterAll(clearPage);

describe("the row of the version", () => {
  // Drift: the row is the one place that says these lines. A state of an install that lost its line here would say it nowhere.
  test.each(STATES)("says $name", async ({ frame, says, buttons }) => {
    await drawWith(frame);
    const drawn = within(row() as HTMLElement);

    expect([row()?.textContent, drawn.queryAllByRole("button").map((button) => button.textContent), drawn.queryAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])]).toEqual([
      says,
      [...buttons],
      "update" in frame ? [["What changed", NEWER.notes]] : [],
    ]);
  });

  // Drift: a version that could not be read would be drawn as a name with nothing after it, or with a dash that reads as a version.
  test("is not drawn on an install that could not read its version", async () => {
    const own = BOOT.version;
    Object.assign(BOOT, { version: "" });
    try {
      await drawWith();

      expect([row() === null, screen.getByRole("heading", { level: 1 }).textContent]).toEqual([true, "Settings"]);
    } finally {
      Object.assign(BOOT, { version: own });
    }
  });
});

describe("a try to start an update", () => {
  // Drift: a refused start is a problem the server notes, and the page, which read the frame once, would go on showing Settings with the mark of a newer release and none of a problem until it is loaded again.
  test("that the server refuses has the frame read again, so the section whose problem it now is carries its mark", async () => {
    const server = spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      if (sent(input, init).method === "POST") return Response.json({ ok: false, code: "refused", about: null, sentence: "The update could not be started." }, { status: 502 });

      return Response.json({ ...FRAME, update: NEWER, starts: true, marks: { ...FRAME.marks, settings: { count: 1, says: "An update could not be started" } } });
    }) as typeof fetch);
    await drawWith({ update: NEWER, starts: true });
    const before = screen.getAllByRole("img").map((mark) => mark.getAttribute("aria-label"));

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" })).getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(screen.queryAllByRole("link", { name: "Settings 1 problem" }).length).toBe(1));

    const asked = server.mock.calls.map(([input, init]) => `${sent(input, init).method} ${new URL(sent(input, init).url).pathname.slice(BOOT.base.length)}`);

    expect([before, asked]).toEqual([["update available"], ["POST /data/update", "GET /data/frame"]]);
  });
});

describe("the way back to the version before", () => {
  // Drift: the button posts the version before by name. A press that sent an empty body would take the newest release, and put the install forward where a person asked to go back.
  test("asks first, with nothing sent until the answer, and then sends the version before", async () => {
    const bodies: unknown[] = [];
    // A start is counted the moment it is sent, before its body is read.
    let starts = 0;
    spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      const request = sent(input, init);
      if (request.method !== "POST") return Response.json({ ...FRAME, back: BACK, starts: true });

      starts += 1;
      bodies.push(await request.json());

      return Response.json({ ok: true, to: "0.9.0" });
    }) as typeof fetch);
    await drawWith({ back: BACK, starts: true });

    fireEvent.click(screen.getByRole("button", { name: "Go back to 0.9.0" }));
    const asked = await screen.findByRole("alertdialog", { name: "Go back to 0.9.0?" });
    const before = starts;
    fireEvent.click(within(asked).getByRole("button", { name: "Go back to 0.9.0" }));
    await waitFor(() => expect(bodies.length).toBe(1));

    expect([before, bodies]).toEqual([0, [{ to: "0.9.0" }]]);
  });
});
