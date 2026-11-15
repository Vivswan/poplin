// The Settings screen: which tab holds a setting, the one Save for everything changed, the refusal that comes back at its field, Discard, and the Undo of a done save.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import type { Row } from "@/settings/settings-queries";
import { SettingsScreen } from "@/settings/settings-screen";

import { drawAt } from "../lib/support/router";

/** The sentence the server refuses a save with in these tests. */
const RULE = "Use a whole number, 1 or more.";

/** A count with no word for none. */
const COUNT = { kind: "number", least: 1, most: null, word: null } as const;

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The texts the server of these tests starts with, by setting. */
const AT_START = { default_search_engines: "off", trash_days: "7", max_total_size: "9000MB", update_check: "on", update_channel: "off" } as const;

/** The texts the server of these tests holds, by setting. */
const stored: Record<string, string> = {};

/** The texts of every save the screen sent. */
const saves: unknown[] = [];

/** Where every save was sent: its method and its path under the console. */
const sentTo: string[] = [];

/** The saves the server holds back until a test lets them through. */
const held: (() => void)[] = [];

function rowOf(key: string, control: Row["control"], unit = ""): Row {
  return { key: key as Row["key"], control, text: stored[key] ?? "", unit, fallback: stored[key] ?? "", warnings: [], repair: false };
}

/**
 * Answer as the server does: the rows as stored, and every save done, or refused about `refusedKey`.
 *
 * @param holds - whether a save waits until a test lets it through
 */
function serve({ refusedKey, holds = false }: { readonly refusedKey?: string; readonly holds?: boolean } = {}): void {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input, window.location.href);
    if (pathname === `${BOOT.base}/data/frame`) return Response.json({ ok: true, title: "poplin", update: null, starts: false, domainNote: null });

    if (init?.method !== "POST") {
      const rows = [
        rowOf("default_search_engines", { kind: "switch" }),
        rowOf("trash_days", COUNT),
        rowOf("max_total_size", COUNT, "MB"),
        rowOf("update_check", { kind: "switch" }),
        rowOf("update_channel", { kind: "switch" }),
      ];

      return Response.json({ ok: true, rows, updateAddress: { set: false, since: null } });
    }

    const { texts } = JSON.parse(String(init.body)) as { readonly texts: Record<string, string> };
    saves.push(texts);
    sentTo.push(`${init.method} ${pathname.slice(BOOT.base.length)}`);
    if (holds) await new Promise<void>((resolve) => held.push(resolve));

    if (refusedKey !== undefined) return Response.json({ ok: false, code: "bad_argument", about: refusedKey, sentence: RULE }, { status: 400 });

    Object.assign(stored, texts);

    return Response.json({ ok: true });
  }) as typeof fetch;
}

/** Draw the screen at a tab and wait for its rows. */
async function drawn(tab = ""): Promise<ReturnType<typeof within>> {
  await drawAt(
    `/settings${tab === "" ? "" : `?tab=${tab}`}`,
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <SettingsScreen />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const page = within(document.body);
  await waitFor(() => page.getAllByRole("button", { name: /^About: / }));

  return page;
}

/** Press something of the page, and let the screen take what follows in. */
async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(target);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function showTab(page: ReturnType<typeof within>, name: RegExp): Promise<void> {
  await press(page.getByRole("tab", { name }));
}

/** Type a count into the one number field the shown tab has. */
function type(page: ReturnType<typeof within>, text: string): void {
  fireEvent.change(page.getByRole("textbox"), { target: { value: text } });
}

/** What the bar says, or `null` while there is none. */
function bar(page: ReturnType<typeof within>): string | null {
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
  window.localStorage.clear();
  saves.length = 0;
  sentTo.length = 0;
  held.length = 0;
});
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearPage();
});

describe("the tabs", () => {
  // Drift: a setting that arrives with no words would be shown under its raw key, or in a tab nobody looks for it in.
  test("hold each setting once, a setting with no words in the tab its key reads like under a readable name", async () => {
    const page = await drawn();
    const names = (): (string | null)[] => [...document.querySelectorAll("label")].map((label) => label.textContent);
    const sites = names();
    await showTab(page, /Limits/);
    const limits = names();
    await showTab(page, /Updates/);

    expect({ sites, limits, updates: names(), raw: document.body.textContent?.includes("update_channel") }).toEqual({
      sites: ["Show new sites in search engines", "Keep deleted sites in the trash for"],
      limits: ["Storage for all sites together"],
      updates: ["Check daily for a newer version", "Update channel", "Rebuild address"],
      raw: false,
    });
  });
});

describe("the one Save", () => {
  // Drift: a switch would be saved the moment it is flipped again, so the screen would have two ways to save; or the changes would be sent one request a setting, and a refusal of the second would leave the first stored.
  test("holds a flipped switch and a typed number of two tabs until Save, counts them, and sends them in one request", async () => {
    const page = await drawn();
    await press(page.getByRole("switch"));
    await showTab(page, /Limits/);
    type(page, "12000");
    const waiting = [bar(page), saves.length, page.getByRole("tab", { name: /New sites/ }).textContent];
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bar(page)).toBeNull());

    expect([waiting, saves, stored.max_total_size]).toEqual([["2 unsaved changes", 0, "New sites"], [{ default_search_engines: "on", max_total_size: "12000MB" }], "12000MB"]);
  });

  // Drift: a refusal about a setting of a tab that is not shown would be said nowhere, the typed value would be put back, or the bar would go though nothing was saved.
  test("shows a refused setting's tab with the sentence at its field, keeps what was typed, and keeps the bar", async () => {
    serve({ refusedKey: "max_total_size" });
    const page = await drawn("limits");
    type(page, "0");
    await showTab(page, /New sites/);
    await press(page.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(page.getByRole("alert").textContent).toBe(RULE));

    expect([window.location.search, (page.getByRole("textbox") as HTMLInputElement).value, bar(page), stored.max_total_size]).toEqual(["?tab=limits", "0", "1 unsaved change", "9000MB"]);
  });

  // Drift: Discard would leave a change counted that no control shows, so one flip of a switch after it would count as two changes, or it would send what it drops.
  test("drops every waiting change on Discard and sends nothing", async () => {
    const page = await drawn();
    await press(page.getByRole("switch"));
    type(page, "30");
    await press(page.getByRole("button", { name: "Discard" }));
    await press(page.getByRole("switch"));
    const again = bar(page);
    await press(page.getByRole("switch"));

    expect([again, bar(page), page.getByRole("switch").getAttribute("aria-checked"), saves]).toEqual(["1 unsaved change", null, "false", []]);
  });

  // Drift: Undo would take back one setting of a save that changed two, or go another way than the save did.
  test("takes a done save back with Undo: the values from before, through the same route, in one request", async () => {
    const page = await drawn();
    await press(page.getByRole("switch"));
    type(page, "30");
    await press(page.getByRole("button", { name: "Save" }));
    await press(await page.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(saves).toHaveLength(2));
    await waitFor(() => expect(stored.trash_days).toBe("7"));

    expect([saves, sentTo, page.getByRole("switch").getAttribute("aria-checked"), bar(page)]).toEqual([
      [
        { default_search_engines: "on", trash_days: "30" },
        { default_search_engines: "off", trash_days: "7" },
      ],
      ["POST /data/settings", "POST /data/settings"],
      "false",
      null,
    ]);
  });

  // Drift: a value typed back to the old one while a save is on its way would count as saved, the screen could be left unasked, and the other value would be stored.
  test("counts what is typed during a save against the value on its way", async () => {
    serve({ holds: true });
    const page = await drawn();
    type(page, "8");
    await press(page.getByRole("button", { name: "Save" }));
    type(page, "7");
    const during = bar(page);
    await act(async () => held.shift()?.());
    await waitFor(() => expect(stored.trash_days).toBe("8"));
    await waitFor(() => expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false));

    expect([during, bar(page), (page.getByRole("textbox") as HTMLInputElement).value]).toEqual(["1 unsaved change", "1 unsaved change", "7"]);
  });
});
