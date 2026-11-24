// The Domain screen as it opens: what an install whose check needs no token shows with no press, when it checks again by itself, and where a token is still asked for.
// And what Copy status copies in each state the screen rests in.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  remembered: [{ piece: "Record", state: "unchanged", tone: "good", detail: "the remembered record" }],
  found: [{ piece: "Record", state: "missing", tone: "bad", detail: "the record a check found" }],
} as const;

/** What a check made now finds. */
const FOUND = { ok: true, rows: ROWS.found, steps: [], summary: { line: "1 to repair", tone: "bad" }, waiting: 1, repaired: 0 };

/** The moment the server says every run made now was. */
const RAN_AT = Date.UTC(2026, 0, 2, 3, 4);

/** How the server names each kind of install on the screen. */
const KINDS = {
  domain: { thing: "the domain", line: null, kind: "under a domain" },
  none: { thing: "the install", line: "No domain: your sites answer at the provider's free address.", kind: "without a domain" },
} as const;

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
 * Answer as the server does: what the screen opens with, and every run with which run it was, when, and what it found, or with the refusal.
 *
 * @param alone - whether a check needs no token
 * @param last - the run the install remembers, or `null`
 * @param answers - whether the provider answers a check, whether a check waits until a test lets it through, and what a check finds where it is not the one missing piece
 * @param words - how the server names the kind of the install
 */
function serve(
  alone: boolean,
  last: Record<string, unknown> | null,
  answers: { now: boolean; holds?: boolean; found?: Record<string, unknown> } = { now: true },
  words: (typeof KINDS)[keyof typeof KINDS] = KINDS.domain,
): void {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input, window.location.href);
    const domainAsks = Array.from({ length: frame.asks }, (_, at) => asking(at));
    if (pathname === `${BOOT.base}/data/frame`) return Response.json({ ok: true, title: "poplin", update: null, starts: false, back: null, domainNote: null, recent: [], marks: { usage: null, domain: null, settings: null }, domainAsks });

    if (init?.method !== "POST") return Response.json({ ok: true, form: FORM, words, checks_alone: alone, last });

    checks.push(JSON.parse(String(init.body)));
    if (answers.holds === true) await new Promise<void>((resolve) => held.push(resolve));

    const run = pathname.endsWith("/repair") ? "repair" : "check";

    return answers.now ? Response.json({ run, ran_at: RAN_AT, ...(answers.found ?? FOUND) }) : Response.json(UNREACHED, { status: 502 });
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
  onlineManager.setOnline(true);
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
    Object.assign(last, { summary: { line: "Users or alerts changed. Press Repair.", tone: "bad" } });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["domain"] });
    });

    await waitFor(() => expect(shown(page).line.startsWith("Users or alerts changed. Press Repair.")).toBe(true));

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
  test.each(["2 not done", "Users or alerts changed. Press Repair."])("a run whose line is %s keeps it over problems that ask for a repair", async (line) => {
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

    expect([opened, checks]).toEqual([{ line: "Not checked yetPress Check to see every piece.poplin 1.0.0", details: [], dialog: false }, []]);
  });
});

describe("Copy status", () => {
  /** A run the install remembers from a set minute. An install whose check needs a token shows it however old it is. */
  const kept = (): Record<string, unknown> => ({ ...lastOf(0), ran_at: Date.UTC(2026, 0, 1) });

  /** What is copied of that run on an install under a domain. */
  const KEPT_TEXT = ["poplin 1.0.0, under a domain. Checked 2026-01-01T00:00Z. Nothing to repair.", "unchanged  Record  the remembered record"];

  /** A step only a person can do, at an address of the provider that names the account. */
  const STEP = { text: "An older key may still be at the provider. Delete it there:", address: "https://provider.example/0123456789abcdef0123456789abcdef/api-tokens" };

  /** What a repair that made the one piece finds, with that step. */
  const MADE = { ok: true, rows: [{ piece: "Record", state: "created", tone: "good", detail: "the record a repair made" }], steps: [STEP], summary: { line: "1 repaired", tone: "good" }, waiting: 0, repaired: 1 };

  /** The button. */
  const button = (page: Within): HTMLButtonElement => page.getByRole("button", { name: "Copy status" }) as HTMLButtonElement;

  /** Take what the page copies in the browser's place: the text is what matters. */
  const copies = () => spyOn(navigator.clipboard, "writeText").mockImplementation(async () => undefined);

  /** The ways the screen comes to rest, each with what it then copies. */
  const STATES: readonly (readonly [name: string, rests: () => Promise<Within>, lines: readonly string[]])[] = [
    [
      "every piece in place, under a domain",
      () => {
        serve(false, kept());

        return drawn();
      },
      KEPT_TEXT,
    ],
    [
      "every piece in place, without a domain",
      () => {
        serve(false, kept(), undefined, KINDS.none);

        return drawn();
      },
      ["poplin 1.0.0, without a domain. Checked 2026-01-01T00:00Z. Nothing to repair.", "unchanged  Record  the remembered record"],
    ],
    [
      "no run yet",
      () => {
        serve(false, null);

        return drawn();
      },
      ["poplin 1.0.0, under a domain. Not checked yet."],
    ],
    [
      "a check the provider did not answer",
      async () => {
        serve(true, null, { now: false });
        const page = await drawn();
        await waitFor(() => expect(shown(page).line.includes(UNREACHED.sentence)).toBe(true));

        return page;
      },
      ["poplin 1.0.0, under a domain. Not checked. No answer from the provider. Try again."],
    ],
    [
      "a pressed check that found a piece to repair beside a problem that asks for a repair, with its own moment before the screen reads what the install remembers of it",
      async () => {
        serve(true, lastOf(1));
        const page = await asked();
        await press(page, "Check");
        await waitFor(() => expect(shown(page).details).toEqual([ROWS.found[0].detail]));

        return page;
      },
      ["poplin 1.0.0, under a domain. Checked 2026-01-02T03:04Z. 2 to repair.", `To repair: ${asking(0)}`, "missing  Record  the record a check found"],
    ],
    [
      "a repair that ended a problem and left a step only a person can do, under a line that names who ran it: the problem as repaired, and neither the step's address, which names the account, nor that user",
      async () => {
        const last = kept();
        serve(false, last, { now: true, found: MADE });
        const page = await asked();
        await press(page, "Repair");
        const asks = within(await waitFor(() => page.getByRole("dialog", { name: "Repair the domain" })));
        fireEvent.change(asks.getByLabelText("Account token"), { target: { value: "a-token" } });
        // The repair ends the problem, and the install remembers the repair once it is done: the screen reads it again, and names who ran it.
        frame.asks = 0;
        Object.assign(last, { run: "repair", ran_at: RAN_AT });
        await press(asks, "Repair");
        const onScreen = (): unknown[] => [
          shown(page).line.includes("Repaired"),
          shown(page).line.includes("mira@example.com"),
          page.queryAllByRole("link", { name: STEP.address }).length,
          page.queryAllByRole("list", { name: "Repaired" }).map((list) => list.textContent),
        ];
        await waitFor(() => expect(onScreen()).toEqual([true, true, 1, [`Repaired: ${asking(0)}`]]));

        return page;
      },
      ["poplin 1.0.0, under a domain. Repaired 2026-01-02T03:04Z. 2 repaired.", `Repaired: ${asking(0)}`, "created  Record  the record a repair made"],
    ],
    [
      "a repair the provider refused, which changed nothing",
      async () => {
        serve(false, kept(), { now: false });
        const page = await drawn();
        await press(page, "Repair");
        const asks = within(await waitFor(() => page.getByRole("dialog", { name: "Repair the domain" })));
        fireEvent.change(asks.getByLabelText("Account token"), { target: { value: "a-token" } });
        await press(asks, "Repair");
        await waitFor(() => asks.getByText(UNREACHED.sentence));
        await press(asks, "Cancel");
        await waitFor(() => expect(shown(page).dialog).toBe(false));

        return page;
      },
      KEPT_TEXT,
    ],
  ];

  // Drift: a status could only be retyped into a report; or the copy would hold the rows to repair alone, the pieces of another state than the one on the screen, or no moment for a run made just now.
  // Or it would hold what the screen shows beside the status: who ran the check, and the provider's address of a step.
  test.each(STATES)("copies the line and every piece as the screen shows them, and says so: %s", async (_name, rests, lines) => {
    using copied = copies();
    const page = await rests();
    await press(page, "Copy status");
    await waitFor(() => page.getByText("Status copied."));

    expect(copied.mock.calls.map(([text]) => text.split("\n"))).toEqual([[...lines]]);
  });

  // Drift: a copy made while a check is on its way would be of the pieces that check is about to replace, right after a person pressed Check to have new ones.
  test("is disabled while a check is on its way and copies nothing then; once the check has ended it can be pressed again", async () => {
    using copied = copies();
    serve(true, lastOf(CHECK_FRESH_MS / 60_000 + 1), { now: true, holds: true });
    const page = await drawn();
    await waitFor(() => expect(checks).toEqual([{ unasked: true }]));
    await press(page, "Copy status");
    const meanwhile = { disabled: button(page).disabled, copied: copied.mock.calls.length };
    await act(async () => {
      for (const release of held) release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(shown(page).details).toEqual([ROWS.found[0].detail]));

    expect([meanwhile, button(page).disabled]).toEqual([{ disabled: true, copied: 0 }, false]);
  });

  // Drift: a press on Check that waits for the network is no check on its way yet, and the pieces on show are the ones it will replace: a copy that looked at the check alone would write them.
  test("is disabled, as Check is, while a pressed check waits for the network, and copies nothing then", async () => {
    using copied = copies();
    serve(true, lastOf(1));
    const page = await drawn();
    onlineManager.setOnline(false);
    await press(page, "Check");
    await press(page, "Copy status");
    const waiting = { disabled: button(page).disabled, copied: copied.mock.calls.length, sent: [...checks] };
    await act(async () => {
      onlineManager.setOnline(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(shown(page).details).toEqual([ROWS.found[0].detail]));

    expect([waiting, button(page).disabled]).toEqual([{ disabled: true, copied: 0, sent: [] }, false]);
  });

  // Drift: a browser that copies nothing would leave a person with a paste of whatever they copied last, and no word of it.
  test("says that nothing was copied where the browser refuses the copy", async () => {
    using _refused = spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("refused"));
    serve(false, kept());
    const page = await drawn();
    await press(page, "Copy status");

    await waitFor(() => page.getByText("Not copied. The browser did not allow it."));
  });
});
