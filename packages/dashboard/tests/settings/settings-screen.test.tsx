// The Settings screen: the one page with every setting under its block's heading, the one Save for everything changed, the refusal that comes back at its field, Discard, and the Undo of a done save.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { FRAME_KEY } from "@/lib/frame";
import { settingAddress } from "@/settings/setting-address";
import type { Row } from "@/settings/settings-queries";
import { SettingsScreen } from "@/settings/settings-screen";

import { drawAt } from "../lib/support/router";

/** The sentence the server refuses a save with in these tests. */
const RULE = "Use a whole number, 1 or more.";

/** A count with no word for none. */
const COUNT = { kind: "number", word: null } as const;

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The texts the server of these tests starts with, by setting. */
const AT_START = { default_search_engines: "off", trash_days: "7", max_total_size: "9000MB", update_check: "on", auto_update: "off", update_channel: "off", provider_logs: "on" } as const;

/** The texts the server of these tests holds, by setting. */
const stored: Record<string, string> = {};

/** The texts of every save the screen sent. */
const saves: unknown[] = [];

/** Where every save was sent: its method and its path under the console. */
const sentTo: string[] = [];

/** The saves the server holds back until a test lets them through. */
const held: (() => void)[] = [];

/** How the server of these tests answers. */
interface Served {
  readonly refusedKey?: string;
  readonly refusedKeys?: readonly string[];
  readonly holds?: boolean;
  readonly keyed?: boolean;
  readonly waits?: { readonly repair?: readonly string[]; readonly update?: readonly string[] };
  readonly carried?: readonly string[];
}

function rowOf(key: string, control: Row["control"], unit = ""): Row {
  return { key: key as Row["key"], control, text: stored[key] ?? "", unit, fallback: stored[key] ?? "", limits: [], repair: false, needs: null };
}

/**
 * Answer as the server does: the rows as stored, and every save done, or refused about `refusedKey`, or about each of `refusedKeys` at once.
 *
 * @param holds - whether a save waits until a test lets it through
 * @param keyed - whether the install holds its key
 * @param waits - the settings whose half at the provider waits after a save that holds them, by what they wait for
 * @param carried - the settings the install carries to the provider by itself after a save that holds them
 */
function serve({ refusedKey, refusedKeys = [], holds = false, keyed = false, waits = {}, carried = [] }: Served = {}): void {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input, window.location.href);
    if (pathname === `${BOOT.base}/data/frame`) return Response.json({ ok: true, title: "poplin", update: null, starts: keyed, back: null, domainNote: null, recent: [], marks: { usage: null, domain: null, settings: null } });

    if (init?.method !== "POST") {
      const rows = [
        rowOf("default_search_engines", { kind: "switch" }),
        rowOf("trash_days", COUNT),
        rowOf("max_total_size", COUNT, "MB"),
        rowOf("update_check", { kind: "switch" }),
        rowOf("auto_update", { kind: "switch" }),
        rowOf("update_channel", { kind: "switch" }),
        rowOf("provider_logs", { kind: "switch" }),
      ];

      return Response.json({ ok: true, rows });
    }

    const { texts } = JSON.parse(String(init.body)) as { readonly texts: Record<string, string> };
    saves.push(texts);
    sentTo.push(`${init.method} ${pathname.slice(BOOT.base.length)}`);
    if (holds) await new Promise<void>((resolve) => held.push(resolve));

    if (refusedKey !== undefined) return Response.json({ ok: false, code: "bad_argument", about: refusedKey, sentence: RULE }, { status: 400 });

    const each = refusedKeys.map((about) => ({ about, sentence: `${RULE} (${about})` }));
    if (each.length > 0) return Response.json({ ok: false, code: "bad_argument", about: each[0]?.about, sentence: each[0]?.sentence, each }, { status: 400 });

    Object.assign(stored, texts);
    const waiting = (keys: readonly string[] = []): readonly string[] => keys.filter((key) => Object.hasOwn(texts, key));

    return Response.json({ ok: true, waits: { repair: waiting(waits.repair), update: waiting(waits.update) }, carried: waiting(carried).length > 0 });
  }) as typeof fetch;
}

/** Draw the screen and wait for its rows. */
async function drawn(address = "/settings", client = new QueryClient({ defaultOptions: { queries: { retry: false } } })): Promise<Within> {
  await drawAt(
    address,
    <QueryClientProvider client={client}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <SettingsScreen />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const page = within(document.body);
  await waitFor(() => page.getByRole("heading", { name: "New sites" }));

  return page;
}

/** Press something of the page, and let the screen take what follows in. */
async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(target);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The switch of the search engines of new sites. */
function engines(page: Within): HTMLElement {
  return page.getByRole("switch", { name: "Show in search engines" });
}

/** The field of a count, by the name of its setting. */
function field(page: Within, name: string): HTMLInputElement {
  return page.getByRole("textbox", { name }) as HTMLInputElement;
}

/** Type a count into a field. */
function type(page: Within, name: string, text: string): void {
  fireEvent.change(field(page, name), { target: { value: text } });
}

/** What the bar says, or `null` while there is none. */
function bar(page: Within): string | null {
  return page.queryByRole("region", { name: "Unsaved changes" })?.querySelector("p")?.textContent ?? null;
}

beforeEach(() => {
  Object.assign(stored, AT_START);
  serve();
});

afterEach(() => {
  // A line said in one test would still be drawn in the next.
  toast.dismiss();
  cleanup();
  globalThis.fetch = OWN_FETCH;
  saves.length = 0;
  sentTo.length = 0;
  held.length = 0;
});
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearPage();
});

describe("the one page", () => {
  // Drift: a setting that arrives with no words would be named by its raw key, or stand under a heading nobody looks for it under; or the settings would be split over tabs again. A row without its key could not be found in `poplin config`.
  test("holds every setting once under the heading of its block, a setting with no words under the heading its key reads like, with a readable name and its key under it", async () => {
    await drawn();
    const blocks = [...document.querySelectorAll("form section")].map((block) => [block.querySelector("h2")?.textContent, ...[...block.querySelectorAll("h3")].map((name) => name.textContent)]);

    const keys = [...document.querySelectorAll("form section code")].map((key) => key.textContent);

    expect([blocks, keys]).toEqual([
      [
        ["New sites", "Show in search engines", "Keep deleted sites"],
        ["Storage", "All sites together"],
        ["Logs", "Keep logs"],
        ["Updates", "Check for new versions", "Update automatically", "Update channel"],
      ],
      ["default_search_engines", "trash_days", "max_total_size", "provider_logs", "update_check", "auto_update", "update_channel"],
    ]);
  });

  // Drift: on an install with no key a change of the logs waits for the next upload of its code. A row that said nothing there would read as switched at once, and one that said it on an install with a key would be untrue.
  test.each([
    { name: "an install that holds no key says when a change takes effect", keyed: false, waits: true },
    { name: "an install that holds its key says nothing there", keyed: true, waits: false },
  ])("under Keep logs, $name", async ({ keyed, waits }) => {
    serve({ keyed });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = await drawn("/settings", client);
    // The frame starts from the page's own values, which are of an install with no key.
    await act(async () => void client.setQueryData(FRAME_KEY, (frame: object | undefined) => ({ ...frame, starts: keyed })));
    const block = page.getByRole("switch", { name: "Keep logs" }).closest("section");

    await waitFor(() =>
      expect([block?.querySelector("h2")?.textContent, block?.textContent?.includes("Logs help find a fault; while off, the provider keeps none."), block?.textContent?.includes("Takes effect at the next update or Repair.")]).toEqual(["Logs", true, waits]),
    );
  });
});

describe("the address of one setting", () => {
  // Drift: a link of another screen would land on the top of the page, and the person would have to find the setting it meant among twenty.
  test("points its block out: the block is shaded and its control has the focus", async () => {
    const { to, hash } = settingAddress("trash_days");
    const page = await drawn(`${to}#${hash}`);
    await waitFor(() => expect(document.activeElement === field(page, "Keep deleted sites")).toBe(true));

    expect([document.getElementById(hash)?.contains(document.activeElement), document.getElementById(hash)?.classList.contains("bg-muted/60")]).toEqual([true, true]);
  });
});

describe("the one Save", () => {
  // Drift: a switch would be saved the moment it is flipped again, so the screen would have two ways to save; or the changes would be sent one request a setting, and a refusal of the second would leave the first stored.
  test("holds a flipped switch and a typed number until Save, counts them, and sends them in one request", async () => {
    const page = await drawn();
    await press(engines(page));
    type(page, "All sites together", "12000");
    const waiting = [bar(page), saves.length];
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bar(page)).toBeNull());

    expect([waiting, saves, stored.max_total_size]).toEqual([["2 unsaved changes", 0], [{ default_search_engines: "on", max_total_size: "12000MB" }], "12000MB"]);
  });

  // Drift: a refused value would be put back, its sentence would be said away from its field, or the bar would go though nothing was saved.
  test("says a refusal at the refused setting's field, keeps what was typed, and keeps the bar", async () => {
    serve({ refusedKey: "max_total_size" });
    const page = await drawn();
    type(page, "All sites together", "0");
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(page.getByRole("alert").textContent).toBe(RULE));

    expect([field(page, "All sites together").getAttribute("aria-invalid"), field(page, "All sites together").value, bar(page), stored.max_total_size]).toEqual(["true", "0", "1 unsaved change", "9000MB"]);
  });

  // Drift: a save refused about several settings would mark one of them a press, so Save would be pressed once for each; or the focus would go to another field than the first refused one.
  test("says every refusal of one save at its own field, with the focus in the first, and takes one away when its field is typed in again", async () => {
    serve({ refusedKeys: ["trash_days", "max_total_size"] });
    const page = await drawn();
    type(page, "Keep deleted sites", "0");
    type(page, "All sites together", "0");
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(page.queryAllByRole("alert").length).toBe(2));
    const said = page.getAllByRole("alert").map((alert) => alert.textContent);
    await waitFor(() => expect(document.activeElement === field(page, "Keep deleted sites")).toBe(true));
    type(page, "Keep deleted sites", "9");

    expect([said, page.getAllByRole("alert").map((alert) => alert.textContent), bar(page)]).toEqual([
      [`${RULE} (trash_days)`, `${RULE} (max_total_size)`],
      [`${RULE} (max_total_size)`],
      "2 unsaved changes",
    ]);
  });

  // Drift: Discard would leave a change counted that no control shows, so one flip of a switch after it would count as two changes, or it would send what it drops.
  test("drops every waiting change on Discard and sends nothing", async () => {
    const page = await drawn();
    await press(engines(page));
    type(page, "Keep deleted sites", "30");
    await press(page.getByRole("button", { name: "Discard" }));
    await press(engines(page));
    const again = bar(page);
    await press(engines(page));

    expect([again, bar(page), engines(page).getAttribute("aria-checked"), saves]).toEqual(["1 unsaved change", null, "false", []]);
  });

  // Drift: a double click's second press comes before the page has drawn Save as off: the same changes would be sent twice.
  test("sends one save for two presses that come at once", async () => {
    serve({ holds: true });
    const page = await drawn();
    type(page, "Keep deleted sites", "30");
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Save" }));
      fireEvent.click(page.getByRole("button", { name: "Save" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => held.shift()?.());
    await page.findByText("Saved.");

    expect(saves).toEqual([{ trash_days: "30" }]);
  });

  // Drift: the install writes a saved rule or the logs to the provider by itself, once for each save. A screen that took the next save at once would let a switch be flipped three times in two seconds, and the writes could land in another order.
  // One that held back after every save would make a person wait for nothing.
  test("takes no further save for 5 seconds after one the install carries to the provider: Save and Discard are off and a press sends nothing, then the save is sent; any other save holds nothing back", async () => {
    serve({ carried: ["provider_logs"], holds: true });
    const page = await drawn();
    const logs = page.getByRole("switch", { name: "Keep logs" });
    const off = (name: string): boolean => (page.getByRole("button", { name }) as HTMLButtonElement).disabled;
    // Let the held save through, and let the screen take in what follows, by the clock the test moves.
    const answered = async (): Promise<void> => {
      for (let turn = 0; turn < 20; turn++) {
        await act(async () => {
          if (turn === 0) held.shift()?.();
          jest.advanceTimersByTime(1);
          await Promise.resolve();
        });
      }
    };

    type(page, "Keep deleted sites", "30");
    await press(page.getByRole("button", { name: "Save" }));
    await act(async () => held.shift()?.());
    await page.findByText("Saved.");
    type(page, "Keep deleted sites", "31");
    const afterAnother = off("Save");
    await press(logs);
    await press(page.getByRole("button", { name: "Save" }));
    jest.useFakeTimers();
    try {
      await answered();
      act(() => fireEvent.click(logs));
      const during = [bar(page), off("Save"), off("Discard")];
      act(() => fireEvent.click(page.getByRole("button", { name: "Save" })));
      act(() => void jest.advanceTimersByTime(4000));
      const sent = saves.length;
      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect([afterAnother, during, sent, off("Save")]).toEqual([false, ["1 unsaved change", true, true], 2, false]);
    } finally {
      jest.useRealTimers();
    }
    await press(page.getByRole("button", { name: "Save" }));
    await act(async () => held.shift()?.());

    expect(saves).toEqual([{ trash_days: "30" }, { trash_days: "31", provider_logs: "off" }, { provider_logs: "on" }]);
  });

  // Drift: a setting whose half at the provider waits for a repair, or for the next upload of the install's code, would be said as "Saved." alone, and read as in effect.
  test.each([
    ["nothing waits", {}, "Saved.Press Alt+T to reach Undo."],
    ["every saved setting waits for a repair", { repair: ["default_search_engines", "trash_days"] }, "Saved. Takes effect at the next Repair."],
    ["one of two waits for a repair", { repair: ["default_search_engines"] }, "Saved. 1 setting takes effect at the next Repair."],
    ["both wait, one for a repair", { repair: ["default_search_engines"], update: ["trash_days"] }, "Saved. Takes effect at the next Repair."],
    ["one of two waits for the next update", { update: ["trash_days"] }, "Saved. 1 setting takes effect at the next update or Repair."],
  ] as const)("says after a save when it takes effect: %s", async (_name, waits, line) => {
    serve({ waits });
    const page = await drawn();
    await press(engines(page));
    type(page, "Keep deleted sites", "30");
    await press(page.getByRole("button", { name: "Save" }));
    await page.findByRole("button", { name: "Undo" });

    expect(document.querySelector("[data-sonner-toast] [data-content]")?.textContent).toBe(line);
  });

  // Drift: Undo would take back one setting of a save that changed two, or go another way than the save did.
  test("takes a done save back with Undo: the values from before, through the same route, in one request", async () => {
    const page = await drawn();
    await press(engines(page));
    type(page, "Keep deleted sites", "30");
    await press(page.getByRole("button", { name: "Save" }));
    await press(await page.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(saves).toHaveLength(2));
    await waitFor(() => expect(stored.trash_days).toBe("7"));

    expect([saves, sentTo, engines(page).getAttribute("aria-checked"), bar(page)]).toEqual([
      [
        { default_search_engines: "on", trash_days: "30" },
        { default_search_engines: "off", trash_days: "7" },
      ],
      ["POST /data/settings", "POST /data/settings"],
      "false",
      null,
    ]);
  });

  // Drift: automatic updates need the check for new versions. With the check switched off in a draft, an Undo that stores automatic updates as on again would leave the draft to save the check off alone: a pair that cannot work.
  test("saves automatic updates off with a check switched off, also where an Undo stored them as on meanwhile, and draws their switch off and locked", async () => {
    const page = await drawn();
    const [check, automatic] = [page.getByRole("switch", { name: "Check for new versions" }), page.getByRole("switch", { name: "Update automatically" })];
    await press(automatic);
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    await press(automatic);
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves).toHaveLength(2));
    await press(check);
    await press(await page.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(stored.auto_update).toBe("on"));
    const shown = [automatic.getAttribute("aria-checked"), automatic.hasAttribute("disabled") || automatic.getAttribute("aria-disabled") === "true" || automatic.hasAttribute("data-disabled")];
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves).toHaveLength(4));

    expect([shown, saves.at(-1)]).toEqual([["false", true], { update_check: "off", auto_update: "off" }]);
  });

  // Drift: automatic updates switched on and not yet saved would stay in the draft under a check switched off, hidden while the check waits, and come back as a change of their own once the check is saved: the next Save would store them on.
  test("sends no automatic updates switched on in the draft under a check switched off: one Save stores the check off, and nothing waits after it", async () => {
    const page = await drawn();
    await press(page.getByRole("switch", { name: "Update automatically" }));
    await press(page.getByRole("switch", { name: "Check for new versions" }));
    const waiting = bar(page);
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bar(page)).toBeNull());

    expect([waiting, saves, page.getByRole("switch", { name: "Update automatically" }).getAttribute("aria-checked")]).toEqual(["1 unsaved change", [{ update_check: "off" }], "false"]);
  });

  // Drift: a value typed back to the old one while a save is on its way would count as saved, the screen could be left unasked, and the other value would be stored.
  test("counts what is typed during a save against the value on its way", async () => {
    serve({ holds: true });
    const page = await drawn();
    type(page, "Keep deleted sites", "8");
    await press(page.getByRole("button", { name: "Save" }));
    type(page, "Keep deleted sites", "7");
    const during = bar(page);
    await act(async () => held.shift()?.());
    await waitFor(() => expect(stored.trash_days).toBe("8"));
    await waitFor(() => expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false));

    expect([during, bar(page), field(page, "Keep deleted sites").value]).toEqual(["1 unsaved change", "1 unsaved change", "7"]);
  });
});
