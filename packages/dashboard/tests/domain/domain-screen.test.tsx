// The Domain screen as it opens: what an install whose check needs no token shows with no press, when it checks again by itself, and where a token is still asked for.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CHECK_FRESH_MS } from "@/domain/domain-queries";
import { DomainScreen } from "@/domain/domain-screen";
import { BOOT } from "@/lib/boot";
import { FRAME_KEY } from "@/lib/frame";

import { drawAt } from "../lib/support/router";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** What a token must hold, in an invented provider's words. */
const FORM = { tokenRights: ["Records: Edit"], tokenLink: "https://provider.example/tokens/new", tokenOptional: [], tokenNote: "Choose what the account token is for." };

/** The one piece of the remembered run, and the one a check made now finds. */
const ROWS = {
  remembered: [{ piece: "Record", state: "present", tone: "good", detail: "the remembered record" }],
  found: [{ piece: "Record", state: "missing", tone: "bad", detail: "the record a check found" }],
} as const;

/** What a check made now answers. */
const FOUND = { ok: true, rows: ROWS.found, steps: [], summary: { line: "1 to repair", tone: "bad" }, waiting: 1, repaired: 0 };

/** The sentence of the problem of the domain that asks for a repair at a place in the frame's list. */
function asking(at: number): string {
  return `Problem ${at} of the domain`;
}

/** The refusal of a check the provider did not answer. */
const UNREACHED = { ok: false, code: "unreachable", about: null, sentence: "No answer from the provider. Try again." };

/** How many problems of the domain the frame says ask for a repair, until a test sets it: none. */
const frame = { asks: 0 };

/** The body of every check the screen sent. */
const checks: unknown[] = [];

/** The checks the server holds back until a test lets them through. */
const held: (() => void)[] = [];

/** The run the install remembers, made `minutes` ago. */
function lastOf(minutes: number): Record<string, unknown> {
  return { ran_at: Date.now() - minutes * 60_000, by: "mira@example.com", run: "check", stale: false, waits: false, rows: ROWS.remembered, summary: { line: "Nothing to repair", tone: "good" }, waiting: 0, repaired: 0 };
}

/**
 * Answer as the server does: what the screen opens with, and every check with what it found, or with the refusal.
 *
 * @param alone - whether a check needs no token
 * @param last - the run the install remembers, or `null`
 * @param answers - whether the provider answers a check, whether a check waits until a test lets it through, and what a check finds where it is not the one missing piece
 */
function serve(alone: boolean, last: Record<string, unknown> | null, answers: { now: boolean; holds?: boolean; found?: Record<string, unknown> } = { now: true }): void {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input, window.location.href);
    const domainAsks = Array.from({ length: frame.asks }, (_, at) => asking(at));
    if (pathname === `${BOOT.base}/data/frame`) return Response.json({ ok: true, title: "poplin", update: null, starts: false, back: null, domainNote: null, recent: [], marks: { usage: null, domain: null, settings: null }, domainAsks });

    if (init?.method !== "POST") return Response.json({ ok: true, form: FORM, words: { thing: "the domain", line: null }, checks_alone: alone, last });

    checks.push(JSON.parse(String(init.body)));
    if (answers.holds === true) await new Promise<void>((resolve) => held.push(resolve));

    return answers.now ? Response.json(answers.found ?? FOUND) : Response.json(UNREACHED, { status: 502 });
  }) as typeof fetch;
}

/** The store of what the screen read, new for each drawing. */
let client = new QueryClient();

/** Draw the screen and wait for its line. */
async function drawn(): Promise<Within> {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await drawAt(
    "/domain",
    <QueryClientProvider client={client}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <DomainScreen />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const page = within(document.body);
  await waitFor(() => page.getByRole("button", { name: "Repair" }));

  return page;
}

/** Draw the screen over one problem of the domain that asks for a repair, which the frame holds once it is read again. */
async function asked(): Promise<Within> {
  frame.asks = 1;
  const page = await drawn();
  await act(async () => {
    await client.invalidateQueries({ queryKey: FRAME_KEY });
  });
  await waitFor(() => expect(shown(page).line.startsWith("1 to repair")).toBe(true));

  return page;
}

/** Press a button of the page, and let the screen take what follows in. */
async function press(page: Within, name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(page.getByRole("button", { name }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** What the screen shows: its line, the details of its pieces, and whether a dialog is open. */
function shown(page: Within): { readonly line: string; readonly details: string[]; readonly dialog: boolean } {
  const line = page.getByRole("status").textContent ?? "";
  const details = Object.values(ROWS).flatMap((rows) => rows.map((row) => row.detail).filter((detail) => page.queryAllByText(detail).length > 0));

  return { line, details, dialog: page.queryByRole("dialog") !== null };
}

afterEach(() => {
  toast.dismiss();
  cleanup();
  globalThis.fetch = OWN_FETCH;
  checks.length = 0;
  held.length = 0;
  frame.asks = 0;
});
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearPage();
});

describe("on an install whose check needs no token", () => {
  // Drift: the screen would rest on Not checked yet and ask for a press, though the install can read every piece by itself.
  test("with no run remembered, the screen checks by itself and shows the pieces: nothing is pressed, no token is asked for, and the check says nobody pressed", async () => {
    serve(true, null);
    const page = await drawn();
    await waitFor(() => expect(shown(page).details).toEqual([ROWS.found[0].detail]));

    expect([shown(page).line.startsWith("1 to repair"), shown(page).dialog, checks, document.body.textContent?.includes("Not checked yet")]).toEqual([true, false, [{ unasked: true }], false]);
  });

  // Drift: a check is calls to the provider. One made at every opening would spend them on a check a minute old; none made on an old one would show last week's pieces as today's.
  test.each([
    ["within the time a check is gone by", 1, [], [ROWS.remembered[0].detail]],
    ["older than that", CHECK_FRESH_MS / 60_000 + 1, [{ unasked: true }], [ROWS.found[0].detail]],
  ] as const)("a remembered run %s shows at once, and a check is made by itself only for the older one, whose pieces stay on show while it is on its way", async (_name, minutes, sent, details) => {
    serve(true, lastOf(minutes), { now: true, holds: true });
    const page = await drawn();
    await waitFor(() => expect(checks).toEqual([...sent]));
    const meanwhile = shown(page).details;
    await act(async () => {
      for (const release of held) release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(shown(page).details).toEqual([...details]));

    expect([meanwhile, checks, shown(page).dialog]).toEqual([[ROWS.remembered[0].detail], [...sent], false]);
  });

  // Drift: the remembered run is read again when another screen changed what it says, such as its users. Shown as it was first read, the line would go on saying nothing is left to do.
  test("a remembered run the screen's data reads again with another count shows that count", async () => {
    const last = lastOf(1);
    serve(true, last);
    const page = await drawn();
    Object.assign(last, { summary: { line: "Users changed. Press Repair.", tone: "bad" } });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["domain"] });
    });

    await waitFor(() => expect(shown(page).line.startsWith("Users changed. Press Repair.")).toBe(true));

    expect(checks).toEqual([]);
  });

  // Drift: the problems of the domain are drawn under the line from the frame, which is read again as it grows old. A line taken from the run alone would say "Nothing to repair" over a problem that says "press Repair",
  // one kept from the moment of the run would go on asking for a repair after the problem left, and one that counted the pieces alone would say "1 to repair" over a piece and three problems that each ask for one.
  test("the line counts the pieces that wait for a repair and the problems the frame says ask for one, for as long as the frame holds them", async () => {
    serve(true, lastOf(1));
    const page = await drawn();
    const lines = [shown(page).line];
    const reread = async (asks: number): Promise<void> => {
      frame.asks = asks;
      await act(async () => {
        await client.invalidateQueries({ queryKey: FRAME_KEY });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    await reread(3);
    lines.push(shown(page).line);
    await reread(0);
    lines.push(shown(page).line);
    await reread(3);
    await press(page, "Check");
    await waitFor(() => expect(shown(page).details).toEqual([ROWS.found[0].detail]));
    lines.push(shown(page).line);
    await reread(0);
    lines.push(shown(page).line);

    expect(lines.map((line) => line.slice(0, line.indexOf("repair") + "repair".length))).toEqual(["Nothing to repair", "3 to repair", "Nothing to repair", "4 to repair", "1 to repair"]);
  });

  // Drift: a line that says what a repair did not do, or that the users changed, says more than a count: a count of the problems put in its place would hide it.
  test.each(["2 not done", "Users changed. Press Repair."])("a run whose line is %s keeps it over problems that ask for a repair", async (line) => {
    serve(true, { ...lastOf(1), summary: { line, tone: "bad" } });
    frame.asks = 2;
    const page = await drawn();

    expect(shown(page).line.startsWith(line)).toBe(true);
  });

  // Drift: a check that left nothing would be said in the words of the run alone, "Nothing to repair.", beside a line and a problem that ask for a repair.
  test("a pressed check that leaves nothing, over problems that ask for a repair, is said in the line the screen then shows", async () => {
    serve(true, lastOf(1), { now: true, found: { ok: true, rows: ROWS.remembered, steps: [], summary: { line: "Nothing to repair", tone: "good" }, waiting: 0, repaired: 0 } });
    frame.asks = 1;
    const page = await drawn();
    await press(page, "Check");
    await waitFor(() => page.getByText("1 to repair."));

    expect([shown(page).line.startsWith("1 to repair"), page.queryByText("Nothing to repair.")]).toEqual([true, null]);
  });

  // Drift: the line says "3 to repair" over two pieces and a problem. A repair that counted its pieces alone would then say "2 repaired", and the problem would leave the screen with no word of it.
  test.each([
    ["two pieces changed", 2, "2 repaired", "3 repaired"],
    ["no piece changed", 0, "Nothing to repair", "1 repaired"],
  ] as const)("a repair with %s that ends a problem which asked for it counts the problem as repaired, in the line and in what is said, and names it", async (_name, repaired, line, counted) => {
    serve(true, lastOf(1), { now: true, found: { ok: true, rows: ROWS.remembered, steps: [], summary: { line, tone: "good" }, waiting: 0, repaired } });
    const page = await asked();
    await press(page, "Repair");
    const asks = within(await waitFor(() => page.getByRole("dialog", { name: "Repair the domain" })));
    fireEvent.change(asks.getByLabelText("Account token"), { target: { value: "a-token" } });
    frame.asks = 0;
    await press(asks, "Repair");
    await waitFor(() => page.getByText(`${counted}.`));

    expect([shown(page).line.startsWith(counted), within(page.getByRole("list", { name: "Repaired" })).getAllByRole("listitem").map((item) => item.textContent)]).toEqual([true, [`Repaired: ${asking(0)}`]]);
  });

  // Drift: the names of what a repair ended would stay over a later check, which ended nothing, and be counted into its line.
  test("a check after such a repair names nothing as repaired", async () => {
    serve(true, lastOf(1), { now: true, found: { ok: true, rows: ROWS.remembered, steps: [], summary: { line: "Nothing to repair", tone: "good" }, waiting: 0, repaired: 0 } });
    const page = await asked();
    await press(page, "Repair");
    const asks = within(await waitFor(() => page.getByRole("dialog", { name: "Repair the domain" })));
    fireEvent.change(asks.getByLabelText("Account token"), { target: { value: "a-token" } });
    frame.asks = 0;
    await press(asks, "Repair");
    await waitFor(() => page.getByText("1 repaired."));
    await press(page, "Check");
    await waitFor(() => page.getByText("Nothing to repair."));

    expect([shown(page).line.startsWith("Nothing to repair"), page.queryByRole("list", { name: "Repaired" })]).toEqual([true, null]);
  });

  // Drift: Check would open the token dialog again, or a pressed check would be told to the server as one nobody pressed and leave no line in Activity.
  test("Check runs again with no dialog and says it was pressed; Repair still asks for the token", async () => {
    serve(true, lastOf(1));
    const page = await drawn();
    await press(page, "Check");
    await waitFor(() => expect(shown(page).details).toEqual([ROWS.found[0].detail]));
    const afterCheck = { dialog: shown(page).dialog, checks: [...checks] };
    await press(page, "Repair");
    await waitFor(() => page.getByRole("dialog", { name: "Repair the domain" }));

    expect([afterCheck, page.getByLabelText("Account token").getAttribute("type")]).toEqual([{ dialog: false, checks: [{ unasked: false }] }, "password"]);
  });

  // Drift: a provider that does not answer would leave the screen on its skeleton, or wipe the remembered pieces a person was reading.
  test.each([
    ["with no run remembered says it is not checked, and why", null, { line: "Not checked", details: [] as string[] }],
    ["over a remembered run keeps those pieces, and says why beside their count", lastOf(CHECK_FRESH_MS / 60_000 + 1), { line: "Nothing to repair", details: [ROWS.remembered[0].detail] }],
  ] as const)("a check the provider does not answer %s; Check tries again", async (_name, last, expected) => {
    const answers = { now: false };
    serve(true, last, answers);
    const page = await drawn();
    await waitFor(() => expect(shown(page).line.includes(UNREACHED.sentence)).toBe(true));
    const failed = { line: shown(page).line.startsWith(expected.line), details: shown(page).details };
    answers.now = true;
    await press(page, "Check");
    await waitFor(() => expect(shown(page).details).toEqual([ROWS.found[0].detail]));

    expect([failed, checks]).toEqual([{ line: true, details: [...expected.details] }, [{ unasked: true }, { unasked: false }]]);
  });
});

describe("on an install whose check needs a token", () => {
  // Drift: an install with no key would be sent a check with nothing to read with, and its owner would never be shown the dialog that takes the token.
  test("the screen opens on what is remembered and sends nothing; Check opens the token dialog", async () => {
    serve(false, null);
    const page = await drawn();
    const opened = shown(page);
    await press(page, "Check");
    await waitFor(() => page.getByRole("dialog", { name: "Check the domain" }));

    expect([opened, checks]).toEqual([{ line: "Not checked yetPress Check to see every piece.", details: [], dialog: false }, []]);
  });
});
