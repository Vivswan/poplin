// The row of the version on the Settings screen: what it says in each state of the install, and what its two starts send.

import { clearPage } from "../../lib/support/page";

import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

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

/** What the row says once an update has started. */
const RELOAD = "Updated. Reload the page.";

/** The version the install runs, as it stands beside the row's name after an update of the install's own. */
const SINCE = `${BOOT.version}, since 2026-12-01`;

/** The states of an install, each with what the row then holds: what stands beside its name, the line at its right with its buttons, and the note under that line. `null` is a part that is not drawn. */
const STATES = [
  { name: "the version alone, while nothing newer is known and there is no way back", frame: {}, named: BOOT.version, line: null, note: null, buttons: [] },
  {
    name: "a newer release, its notes, and the start of the update on one line, on an install that holds its key",
    frame: { update: NEWER, starts: true },
    named: BOOT.version,
    line: "1.1.0 is out. What changedUpdate now",
    note: null,
    buttons: ["Update now"],
  },
  { name: "a newer release and no start, and why under it, on an install that holds no key", frame: { update: NEWER }, named: BOOT.version, line: "1.1.0 is out. What changed", note: NO_KEY, buttons: [] },
  {
    name: "that a release changes the database, and to press Update now, on an install that holds its key",
    frame: { update: { ...NEWER, database: true }, starts: true },
    named: BOOT.version,
    line: "1.1.0 is out. What changedUpdate now",
    note: `${DATABASE} Press Update now.`,
    buttons: ["Update now"],
  },
  {
    name: "that a release changes the database and that the install holds no key, as one note with nothing to press",
    frame: { update: { ...NEWER, database: true } },
    named: BOOT.version,
    line: "1.1.0 is out. What changed",
    note: `${DATABASE} ${NO_KEY}`,
    buttons: [],
  },
  { name: "since when the version runs, and the way back, after an update", frame: { back: BACK, starts: true }, named: SINCE, line: "Go back to 0.9.0", note: null, buttons: ["Go back to 0.9.0"] },
  { name: "since when the version runs, and no way back, on an install that holds no key", frame: { back: BACK }, named: SINCE, line: null, note: null, buttons: [] },
  {
    name: "the newer release and its start before the way back, where the install has both",
    frame: { back: BACK, update: NEWER, starts: true },
    named: SINCE,
    line: "1.1.0 is out. What changedUpdate nowGo back to 0.9.0",
    note: null,
    buttons: ["Update now", "Go back to 0.9.0"],
  },
] as const;

/** What the row holds once an update was started from it, by what the install says of itself when it is asked again. */
const STARTED = [
  { name: "under the newer release, while the install still names it", frame: { update: NEWER, starts: true }, line: "1.1.0 is out. What changed", note: RELOAD },
  {
    name: "after the note of a release that changes the database, as one note",
    frame: { update: { ...NEWER, database: true }, starts: true },
    line: "1.1.0 is out. What changed",
    note: `${DATABASE} ${RELOAD}`,
  },
  { name: "with no line over it, once the install names no newer release", frame: { starts: true }, line: null, note: RELOAD },
] as const;

/** A request as the row sent it. */
function sent(input: Request | string | URL, init?: RequestInit): Request {
  return input instanceof Request ? input : new Request(new URL(String(input), window.location.href), init);
}

/**
 * Draw the row inside the frame of the Settings screen, over a frame that holds what a test sets.
 *
 * @returns what keeps the frame, so a test can put another one in its place
 */
async function drawWith(more: object = {}): Promise<QueryClient> {
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

  return client;
}

/** The row, or `null` where none is drawn. */
function row(): HTMLElement | null {
  return document.getElementById("setting-version");
}

/** The text of each element of the row that carries a part's name. */
function parts(slot: string): (string | null)[] {
  return [...(row()?.querySelectorAll(`[data-slot=${slot}]`) ?? [])].map((part) => part.textContent);
}

/** What the row holds: its whole text, the line of its name, each line at its right, each note, and its buttons. */
function held(): unknown[] {
  const drawn = within(row() as HTMLElement);

  return [row()?.textContent, parts("setting-name-line"), parts("version-line"), parts("version-note"), drawn.queryAllByRole("button").map((button) => button.textContent)];
}

/** What a row holds that is drawn right: its parts in their order and nothing else, the version on the one line of the row's name, at most one line at the right, and at most one note. */
function drawnRight({ named, line, note, buttons = [] }: { readonly named: string; readonly line: string | null; readonly note: string | null; readonly buttons?: readonly string[] }): unknown[] {
  return [`Version${named}${line ?? ""}${note ?? ""}`, [`Version${named}`], line === null ? [] : [line], note === null ? [] : [note], [...buttons]];
}

/** Press a button of a question, and wait a turn inside the same act: after a press sent bare, a cancelled question stayed drawn for many seconds. */
async function press(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Answer every request of the row: a start is taken, and the frame read again is the one given. */
function serve(frame: object): void {
  spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) =>
    Response.json(sent(input, init).method === "POST" ? { ok: true, to: NEWER.newest } : { ...FRAME, ...frame })) as typeof fetch);
}

afterEach(() => {
  cleanup();
  mock.restore();
});
afterAll(clearPage);

describe("the row of the version", () => {
  // Drift: the row is the one place that says these lines. A state of an install that lost its line here would say it nowhere.
  // The version stood at the right over a second block of lines, which read as two rows: it stands beside the name, and what is at the right is one line with one note under it.
  test.each(STATES)("says $name", async ({ frame, named, line, note, buttons }) => {
    await drawWith(frame);
    const links = within(row() as HTMLElement)
      .queryAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);

    expect([held(), links]).toEqual([drawnRight({ named, line, note, buttons }), "update" in frame ? [["What changed", NEWER.notes]] : []]);
  });

  // Drift: once an update has started the row says so in the place of its start. A note drawn under an empty line would stand a line lower than the row's name, and two notes would read as two blocks.
  test.each(STARTED)("says that an update has started $name, with nothing left to press", async ({ frame, line, note }) => {
    serve(frame);
    await drawWith({ update: NEWER, ...frame });

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await press(within(await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" })).getByRole("button", { name: "Update now" }));
    const expected = drawnRight({ named: BOOT.version, line, note });
    await waitFor(() => expect(held()).toEqual(expected));
  });

  // Drift: the note takes the focus of the question that closes, and the line over it leaves once the install names no newer release. A note drawn anew in the line's place would drop the focus to the page, where no key reaches anything.
  test("keeps the focus on the note that an update has started when the line over it leaves", async () => {
    serve({ update: NEWER, starts: true });
    const client = await drawWith({ update: NEWER, starts: true });

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await press(within(await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" })).getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe(RELOAD));
    const note = document.activeElement;
    const over = parts("version-line");
    client.setQueryData(FRAME_KEY, { ...FRAME, starts: true });
    await waitFor(() => expect(parts("version-line")).toEqual([]));

    expect([over, document.activeElement === note]).toEqual([["1.1.0 is out. What changed"], true]);
  });

  // Drift: the note takes the focus of the question once an update has started, and only then. A note that took it before would have a Cancel leave the focus on a grey line, with the start of the update a key away again.
  test("gives the focus back to Update now after a Cancel, also over a note", async () => {
    await drawWith({ update: { ...NEWER, database: true }, starts: true });
    const start = screen.getByRole("button", { name: "Update now" });

    fireEvent.click(start);
    await press(within(await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" })).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect([document.activeElement === start, parts("version-note")]).toEqual([true, [`${DATABASE} Press Update now.`]]);
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

describe("a question closed before its answer came", () => {
  // Drift: the focus is back on Update now, which leaves once the install takes the start: the focus would drop to the page, where no key reaches anything.
  // The note took it whenever the page held the focus, also from a person who had moved it off the row meanwhile.
  test.each([
    { name: "gives the focus to the note once the install took the start", leaves: false, focused: RELOAD },
    { name: "leaves a focus that a person moved off the row meanwhile where it went", leaves: true, focused: null },
  ] as const)("$name", async ({ leaves, focused }) => {
    const answer = Promise.withResolvers<void>();
    spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      if (sent(input, init).method !== "POST") return Response.json({ ...FRAME, update: NEWER, starts: true });

      await answer.promise;

      return Response.json({ ok: true, to: NEWER.newest });
    }) as typeof fetch);
    await drawWith({ update: NEWER, starts: true });
    const start = screen.getByRole("button", { name: "Update now" });

    fireEvent.click(start);
    const asked = within(await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" }));
    await press(asked.getByRole("button", { name: "Update now" }));
    await press(asked.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement === start).toBe(true));
    if (leaves) act(() => start.blur());
    await act(async () => answer.resolve());
    await waitFor(() => expect(parts("version-note")).toEqual([RELOAD]));

    expect(document.activeElement === document.body ? null : document.activeElement?.textContent).toBe(focused);
  });
});

describe("a question that is open", () => {
  // Drift: a button of the row follows the frame, and the question followed its button. A frame read again while the question was open changed its words under a person, and the answer sent a version nobody pressed.
  test.each([
    {
      name: "the way back",
      pressed: { back: BACK, starts: true },
      later: { back: { ...BACK, to: "1.0.0" }, starts: true },
      button: "Go back to 0.9.0",
      follows: "Go back to 1.0.0",
      words: ["Go back to 0.9.0?", "Go back to 0.9.0"],
      sends: { to: "0.9.0" },
    },
    {
      name: "the update",
      pressed: { update: NEWER, starts: true },
      later: { update: { ...NEWER, newest: "1.2.0", database: true }, starts: true },
      button: "Update now",
      follows: "1.2.0 is out",
      words: ["Update to 1.1.0?", "Update now"],
      sends: {},
    },
  ] as const)("keeps what was pressed for $name: a frame read again meanwhile changes the row, and neither the question's words nor what its answer sends", async ({ pressed, later, button, follows, words, sends }) => {
    const bodies: unknown[] = [];
    spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      const request = sent(input, init);
      if (request.method !== "POST") return Response.json({ ...FRAME, ...later });

      bodies.push(await request.json());

      return Response.json({ ok: true, to: "0.9.0" });
    }) as typeof fetch);
    const client = await drawWith(pressed);

    fireEvent.click(screen.getByRole("button", { name: button }));
    const asked = await screen.findByRole("alertdialog", { name: words[0] });
    const says = asked.textContent;
    client.setQueryData(FRAME_KEY, { ...FRAME, ...later });
    await waitFor(() => expect(row()?.textContent).toContain(follows));

    const kept = [within(asked).getByRole("heading").textContent, asked.textContent === says];
    fireEvent.click(within(asked).getByRole("button", { name: words[1] }));
    await waitFor(() => expect(bodies.length).toBe(1));

    expect([kept, bodies]).toEqual([[words[0], true], [sends]]);
  });
});
