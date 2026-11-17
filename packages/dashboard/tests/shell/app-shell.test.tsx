// The frame around every screen: what it marks and says at the side, and the way past the sections.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { FRAME_KEY } from "@/lib/frame";
import { AppShell } from "@/shell/app-shell";
import { drawAt } from "../lib/support/router";

/** The key the look is kept under in these tests. */
const THEME_KEY = "test.theme";

/** What the frame holds besides the note on the domain and the marks. */
const FRAME = { ok: true, update: null, starts: false, back: null, recent: [] } as const;

/** The way back of an install that holds its key and came to its version by an update, on the first of December 2026. */
const BACK = { back: { to: "0.9.0", since: Date.UTC(2026, 11, 1, 12) }, starts: true } as const;

/** A newer release the install knows of, on an install that holds its key. */
const NEWER = { update: { current: BOOT.version, newest: "1.1.0", released: "2026-11-02", notes: "https://example.com/notes", database: false }, starts: true } as const;

/** The marks of an install where nothing went wrong. */
const NO_MARKS = { usage: null, domain: null, settings: null };

/** What of the frame a test sets besides the note on the domain. */
type Shown = Partial<typeof NEWER & typeof BACK> & { readonly marks?: object };

/** Draw the frame around an empty screen, over a frame that holds the note given, and what else of the frame a test sets. */
async function drawWith(domainNote: { readonly label: string; readonly sentence: string; readonly quiet: boolean } | null, more: Shown = {}): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(FRAME_KEY, { ...FRAME, marks: NO_MARKS, ...more, domainNote });

  await drawAt(
    "/",
    <QueryClientProvider client={client}>
      <ThemeProvider storageKey={THEME_KEY}>
        <TooltipProvider>
          <AppShell current="sites" heading="Sites">
            <p>The screen.</p>
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mock.restore();
});
afterAll(clearPage);

describe("the way out of the login", () => {
  // Drift: the console sends a browser on from one path of its own to where the provider ends a login. A link to any other place, or one the router answers with a screen, would leave the browser logged in.
  test("is named Sign out, the one item of the menu the email at the foot of the side opens, and leads to the console's own way out", async () => {
    await drawWith(null);
    const account = screen.getByTitle(BOOT.email);
    const before = screen.queryAllByText("Sign out").length;
    await act(async () => {
      fireEvent.click(account);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const items = screen.getAllByRole("menuitem");

    expect([before, items.map((item) => [item.textContent, item.getAttribute("href")]), account.getAttribute("aria-expanded")]).toEqual([0, [["Sign out", `${BOOT.base}/out`]], "true"]);
  });

  // Drift: the menu would open beside the email again, over the working area, where it covers what the screen shows.
  test("opens over the email, from the email's left edge", async () => {
    await drawWith(null);
    await act(async () => {
      fireEvent.click(screen.getByTitle(BOOT.email));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const menu = screen.getByRole("menu");

    expect([menu.getAttribute("data-side"), menu.getAttribute("data-align")]).toEqual(["top", "start"]);
  });
});

describe("the mark at a section of the side", () => {
  // Drift: a problem would show only on its own screen, the mark would be a colour with no name for a screen reader, or a section with nothing wrong would carry one.
  test("names how many problems the section's screen holds, on the section's link, and stands at no section without one", async () => {
    await drawWith(null, { marks: { usage: { count: 2, says: "A request failed" }, domain: { count: 1, says: "The login could not be checked" }, settings: null } });
    const marked = screen.getAllByRole("img").map((mark) => [mark.closest("a")?.getAttribute("href"), mark.getAttribute("aria-label")]);

    expect(marked).toEqual([
      [`${BOOT.base}/usage`, "2 problems"],
      [`${BOOT.base}/domain`, "1 problem"],
    ]);
    expect(screen.getByRole("link", { name: "Usage 2 problems" }) !== null).toBe(true);
  });

  // Drift: on a phone the sections are behind a button, so a problem would show nowhere until a person happened to open them.
  test.each([
    ["no section holds a problem", { usage: null, domain: null, settings: null }, "Sections"],
    ["two sections hold three", { usage: { count: 2, says: "A request failed" }, domain: { count: 1, says: "The login could not be checked" }, settings: null }, "Sections, 3 problems"],
  ] as const)("the button that opens the sections on a phone is named %s", async (_what, marks, name) => {
    await drawWith(null, { marks });

    expect(screen.getAllByRole("button", { name: /^Sections/, hidden: true }).map((button) => button.getAttribute("aria-label"))).toEqual([name]);
  });
});

describe("the note on the domain at the side", () => {
  // Drift: an old check would be drawn as an alarm, or the reminder would lead nowhere.
  test("is a quiet word that leads to the Domain screen while the last check is only old", async () => {
    const note = { label: "Domain check is old", sentence: "The last check of the domain is over 30 days old.", quiet: true };
    await drawWith(note);
    const link = screen.getByRole("link", { name: note.label });

    expect([link.getAttribute("href"), link.querySelector("svg"), link.className.includes("text-destructive")]).toEqual([`${BOOT.base}/domain`, null, false]);
  });

  // Drift: a domain with nothing to do would still carry a line at the side.
  test("is not drawn when the install has nothing to say of its domain", async () => {
    await drawWith(null);

    expect(screen.queryByRole("link", { name: /^Domain ./ })).toBeNull();
  });
});

describe("the sections of a phone", () => {
  // Drift: a phone would say only the version it runs again, with the newer one, its notes and the start of the update on a wide screen alone.
  test("say that a newer version is out, link its notes, and start the update with a question, behind which they close", async () => {
    await drawWith(null, NEWER);
    fireEvent.click(screen.getByRole("button", { name: "Sections" }));
    const sections = await screen.findByRole("dialog");
    const notes = within(sections).getByRole("link", { name: "What changed" });
    const said = [within(sections).getByText(`Running poplin ${BOOT.version}`).tagName, notes.parentElement?.textContent, notes.getAttribute("href")];

    fireEvent.click(within(sections).getByRole("button", { name: "Update now" }));
    const asked = await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" });
    await waitFor(() => expect(screen.queryAllByRole("dialog").length).toBe(0));

    expect([said, asked.tagName]).toEqual([["P", "1.1.0 is out. What changed", "https://example.com/notes"], "DIV"]);
  });

  // Drift: an install with nothing newer would offer an update on a phone.
  test("say the version alone while nothing newer is known", async () => {
    await drawWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Sections" }));
    const sections = await screen.findByRole("dialog");

    expect([within(sections).getByText(`Running poplin ${BOOT.version}`).tagName, within(sections).queryByRole("button", { name: "Update now" }), within(sections).queryByText(/is out/)]).toEqual([
      "P",
      null,
      null,
    ]);
  });
});

describe("a try to start an update", () => {
  // Drift: a refused start is a problem the server notes, and the page, which read the frame once, would go on showing Settings with no mark until it is loaded again.
  test("that the server refuses has the frame read again, so the section whose problem it now is carries its mark", async () => {
    const sent = (input: Request | string | URL, init?: RequestInit): Request => (input instanceof Request ? input : new Request(new URL(String(input), window.location.href), init));
    const server = spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      if (sent(input, init).method === "POST") return Response.json({ ok: false, code: "refused", about: null, sentence: "The update could not be started." }, { status: 502 });

      return Response.json({ ...FRAME, ...NEWER, domainNote: null, marks: { ...NO_MARKS, settings: { count: 1, says: "An update could not be started" } } });
    }) as typeof fetch);
    await drawWith(null, NEWER);
    const before = screen.queryAllByRole("link", { name: "Settings 1 problem" }).length;

    fireEvent.click(screen.getAllByRole("button", { name: "Update now", hidden: true })[0] as HTMLElement);
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" })).getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(screen.queryAllByRole("link", { name: "Settings 1 problem" }).length).toBe(1));

    const asked = server.mock.calls.map(([input, init]) => `${sent(input, init).method} ${new URL(sent(input, init).url).pathname.slice(BOOT.base.length)}`);

    expect([before, asked]).toEqual([0, ["POST /data/update", "GET /data/frame"]]);
  });
});

describe("the way back to the version before", () => {
  // Drift: the button posts the version before by name. A press that sent an empty body would take the newest release, and put the install forward where a person asked to go back.
  test("stands under the version and since when it runs, asks first, and sends the version before", async () => {
    const sent = (input: Request | string | URL, init?: RequestInit): Request => (input instanceof Request ? input : new Request(new URL(String(input), window.location.href), init));
    const bodies: unknown[] = [];
    spyOn(globalThis, "fetch").mockImplementation((async (input: Request | string | URL, init?: RequestInit) => {
      const request = sent(input, init);
      if (request.method !== "POST") return Response.json({ ...FRAME, ...BACK, domainNote: null, marks: NO_MARKS });

      bodies.push(await request.json());

      return Response.json({ ok: true, to: "0.9.0" });
    }) as typeof fetch);
    await drawWith(null, BACK);
    const line = screen.getAllByText(/^Running poplin/, { ignore: "[hidden] *" })[0]?.textContent;

    fireEvent.click(screen.getAllByRole("button", { name: "Go back to 0.9.0", hidden: true })[0] as HTMLElement);
    const asked = await screen.findByRole("alertdialog", { name: "Go back to 0.9.0?" });
    fireEvent.click(within(asked).getByRole("button", { name: "Go back to 0.9.0" }));
    await waitFor(() => expect(bodies.length).toBe(1));

    expect([line, bodies]).toEqual([`Running poplin ${BOOT.version}, since 2026-12-01`, [{ to: "0.9.0" }]]);
  });
});

describe("the screen's title", () => {
  // Drift: every screen's tab would be named "poplin" alone again, so a list of tabs or a screen reader's first words would not tell one screen from another.
  test("starts the page's own title, before the product's name", async () => {
    await drawWith(null);

    expect(document.title).toBe("Sites - poplin");
  });

  // Drift: the first stop of the Tab key would be the first of the sections again, with a dozen stops before the screen; or the way past them would lead nowhere.
  test("takes the focus from the way past the sections, which is the first button of the page", async () => {
    await drawWith(null);
    const skip = screen.getAllByRole("button")[0] as HTMLElement;
    fireEvent.click(skip);

    expect([skip.textContent, document.activeElement?.tagName, document.activeElement?.textContent]).toEqual(["Skip to the content", "H1", "Sites"]);
  });
});
