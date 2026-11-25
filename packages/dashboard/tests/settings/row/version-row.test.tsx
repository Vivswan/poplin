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

/** The frame of an install that runs the version the page was loaded with, holds no key, knows of no newer release, and has no way back. */
const FRAME = { ok: true, version: BOOT.version, update: null, starts: false, back: null, domainNote: null, recent: [], marks: { usage: null, domain: null, settings: null } } as const;

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
  { name: "the version and Check now, while nothing newer is known and there is no way back", frame: {}, named: BOOT.version, line: "Check now", note: null, buttons: ["Check now"] },
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
  {
    name: "since when the version runs, and Check now before the way back, after an update",
    frame: { back: BACK, starts: true },
    named: SINCE,
    line: "Check nowGo back to 0.9.0",
    note: null,
    buttons: ["Check now", "Go back to 0.9.0"],
  },
  { name: "since when the version runs, and no way back, on an install that holds no key", frame: { back: BACK }, named: SINCE, line: "Check now", note: null, buttons: ["Check now"] },
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

describe("a press of Check now", () => {
  /** What the row asked of the server so far, each request as its method and its path under the console. */
  function asked(server: { readonly mock: { readonly calls: readonly (readonly [Request | string | URL, RequestInit?])[] } }): string[] {
    return server.mock.calls.map(([input, init]) => `${sent(input, init).method} ${new URL(sent(input, init).url).pathname.slice(BOOT.base.length)}`);
  }

  /** What the install answers a check it made: the version it runs, and the newer release or `null`. */
  function learned(update: object | null): object {
    return { ok: true, version: BOOT.version, update };
  }

  /** What the line a screen reader is told a result in holds now; the line is nowhere in sight. */
  function told(): string | null | undefined {
    return document.querySelector("output")?.textContent;
  }

  /** Answer every request of the row: a check with what is given, at the status given, and the frame read again with the frame given. */
  function serveCheck(check: object, frame: object = {}, status = 200): ReturnType<typeof spyOn<typeof globalThis, "fetch">> {
    return spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) =>
      sent(input, init).method === "POST" ? Response.json(check, { status }) : Response.json({ ...FRAME, ...frame })) as typeof fetch);
  }

  /** Give Check now the focus, as a key that reaches it does, and press it. */
  async function check(): Promise<void> {
    const button = screen.getByRole("button", { name: "Check now" });
    act(() => button.focus());
    await press(button);
  }

  // Drift: right after a release the row was empty, with nothing to press. A found release that waited for a reload, or left the focus on the page, would read as a press that did nothing.
  test("that finds a newer release puts it in the row with the start of the update, gives the start the focus, and has the frame read again", async () => {
    const server = serveCheck(learned(NEWER), { update: NEWER, starts: true });
    await drawWith({ starts: true });
    await check();
    const expected = drawnRight({ named: BOOT.version, line: "1.1.0 is out. What changedUpdate now", note: null, buttons: ["Update now"] });
    await waitFor(() => expect(held()).toEqual(expected));
    await waitFor(() => expect(asked(server)).toEqual(["POST /data/update/check", "GET /data/frame"]));

    expect(document.activeElement?.textContent).toBe("Update now");
  });

  // Drift: the frame names a release only while `update_check` is on. A row that followed the frame alone would lose the release a person just asked for at the frame's next read.
  test("keeps the release it found in the row while the frame, read again, names none", async () => {
    const server = serveCheck(learned(NEWER));
    await drawWith();
    await check();
    await waitFor(() => expect(asked(server)).toEqual(["POST /data/update/check", "GET /data/frame"]));
    // The control: the frame was read again and names no release.
    await waitFor(() => expect(screen.queryAllByRole("link", { name: "Settings update available" })).toEqual([]));

    expect(held()).toEqual(drawnRight({ named: BOOT.version, line: "1.1.0 is out. What changed", note: NO_KEY }));
  });

  // Drift: what a press learned is kept by the page, beside the frame, and is said of the version the install ran then.
  // An install updated or put back meanwhile, from another tab or by a command, runs another one: the row would go on offering an update that is in, or calling an install up to date that is behind.
  test.each([
    { name: "the release it found", update: NEWER, line: "1.1.0 is out. What changed", note: NO_KEY },
    { name: "that none is newer", update: null, line: "Check now", note: "Up to date. Checked just now." },
  ])("lets $name go once the frame says the install runs another version", async ({ update, line, note }) => {
    const runs = { version: BOOT.version };
    const server = spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) =>
      Response.json(sent(input, init).method === "POST" ? learned(update) : { ...FRAME, ...runs })) as typeof fetch);
    const client = await drawWith();
    await check();
    await waitFor(() => expect(asked(server)).toEqual(["POST /data/update/check", "GET /data/frame"]));
    const before = [parts("version-line"), parts("version-note")];
    runs.version = NEWER.newest;
    await act(async () => client.invalidateQueries({ queryKey: FRAME_KEY }));
    const expected = drawnRight({ named: BOOT.version, line: "Check now", note: null, buttons: ["Check now"] });
    await waitFor(() => expect(held()).toEqual(expected));

    expect(before).toEqual([[line], [note]]);
  });

  // Drift: the answer names the version the install ran when it asked. A result kept under the version this page was loaded with would be shown for an install another tab has updated meanwhile, before the frame says so.
  test("holds what it learned back while the frame names another version than the answer's, and shows it once the frame names that one", async () => {
    const runs = { version: BOOT.version };
    const server = spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) =>
      Response.json(sent(input, init).method === "POST" ? { ok: true, version: NEWER.newest, update: null } : { ...FRAME, ...runs })) as typeof fetch);
    const client = await drawWith();
    await check();
    await waitFor(() => expect(asked(server)).toEqual(["POST /data/update/check", "GET /data/frame"]));
    // The control: the asking is over and drawn, so a note that is not there was held back, not late.
    await waitFor(() => expect(screen.getByRole("button", { name: "Check now" }).getAttribute("aria-disabled")).toBe("false"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const before = parts("version-note");
    runs.version = NEWER.newest;
    await act(async () => client.invalidateQueries({ queryKey: FRAME_KEY }));
    await waitFor(() => expect(parts("version-note")).toEqual(["Up to date. Checked just now."]));

    expect(before).toEqual([]);
  });

  // Drift: a press that found nothing and said nothing reads as a button that does not work. The focus stays on the button, so a screen reader hears the result only from a line that was on the page before its words.
  test("that finds none says that the install is up to date and when it asked, to a screen reader too, and leaves the button with the focus", async () => {
    serveCheck(learned(null));
    await drawWith();
    const before = told();
    await check();
    const expected = drawnRight({ named: BOOT.version, line: "Check now", note: "Up to date. Checked just now.", buttons: ["Check now"] });
    await waitFor(() => expect(held()).toEqual(expected));

    expect([before, told(), document.activeElement?.textContent]).toEqual(["", "Up to date.", "Check now"]);
  });

  // Drift: the install's sentence says why nothing was learned. Said as a line at the edge of the screen it is gone in a moment, and the row would look as it did before the press.
  test("that is refused says the install's sentence under the button, until the next press", async () => {
    const sentence = "A check was made in this minute already. Wait a minute.";
    serveCheck({ ok: false, code: "too_many_requests", about: "check", sentence }, {}, 429);
    await drawWith();
    await check();
    const refused = await within(row() as HTMLElement).findByRole("alert");
    const said = [refused.textContent, row()?.textContent, document.activeElement?.textContent];
    mock.restore();
    serveCheck(learned(null));
    await check();
    await waitFor(() => expect(parts("version-note")).toEqual(["Up to date. Checked just now."]));

    expect([said, within(row() as HTMLElement).queryByRole("alert")]).toEqual([[sentence, `Version${BOOT.version}Check now${sentence}`, "Check now"], null]);
  });

  // Drift: the line a screen reader hears is emptied while an asking is on its way, and filled at its answer. Filled again after a press that was refused, it would say "Up to date." as the result of a press that learned nothing.
  test("that is refused after one that found none keeps the grey line of the first, and tells a screen reader the refusal alone", async () => {
    const sentence = "A check was made in this minute already. Wait a minute.";
    serveCheck(learned(null));
    await drawWith();
    await check();
    await waitFor(() => expect(told()).toBe("Up to date."));
    mock.restore();
    serveCheck({ ok: false, code: "too_many_requests", about: "check", sentence }, {}, 429);
    await check();
    const refused = await within(row() as HTMLElement).findByRole("alert");

    expect([refused.textContent, parts("version-note"), told()]).toEqual([sentence, ["Up to date. Checked just now."], ""]);
  });

  // Drift: a double click comes before the page is drawn again, so a button that is only drawn as off still takes it. Two askings would spend the minute's one and answer the second press with a refusal.
  // A button the browser itself switches off drops the focus to the page, so this one is off by its state alone and keeps the focus.
  test("takes one press of two that come before it is drawn again, and while its asking is on its way it is off, keeps the focus, and shows that it works", async () => {
    const answer = Promise.withResolvers<void>();
    const server = spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      if (sent(input, init).method !== "POST") return Response.json(FRAME);

      await answer.promise;

      return Response.json(learned(null));
    }) as typeof fetch);
    await drawWith();
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Check now" });
    act(() => button.focus());
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const busy = [button.getAttribute("aria-disabled"), button.disabled, document.activeElement === button, button.querySelector("[data-slot=spinner]") !== null];
    await act(async () => answer.resolve());
    await waitFor(() => expect(parts("version-note")).toEqual(["Up to date. Checked just now."]));
    const posts = asked(server).filter((request) => request.startsWith("POST"));

    expect([busy, button.getAttribute("aria-disabled"), button.querySelector("[data-slot=spinner]"), posts]).toEqual([["true", false, true, true], "false", null, ["POST /data/update/check"]]);
  });

  // Drift: an update that has started is the release the press found. Offered again beside "Updated. Reload the page.", it would start the same update twice.
  test("leaves the row with the update it led to: once that has started, the release it found is offered no more, and neither is another check", async () => {
    spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      const request = sent(input, init);
      if (request.method !== "POST") return Response.json({ ...FRAME, starts: true });

      return Response.json(new URL(request.url).pathname.endsWith("/check") ? learned(NEWER) : { ok: true, to: NEWER.newest });
    }) as typeof fetch);
    await drawWith({ starts: true });
    await check();
    fireEvent.click(await screen.findByRole("button", { name: "Update now" }));
    await press(within(await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" })).getByRole("button", { name: "Update now" }));
    const expected = drawnRight({ named: BOOT.version, line: null, note: RELOAD });
    await waitFor(() => expect(held()).toEqual(expected));
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
