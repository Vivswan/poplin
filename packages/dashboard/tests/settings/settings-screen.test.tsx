// The Settings screen: the one page with every setting under its block's heading, the one Save for everything changed, the refusal that comes back at its field, Discard, and the Undo of a done save.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
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

/** Draw the screen and wait for its rows. */
async function drawn(address = "/settings"): Promise<ReturnType<typeof within>> {
  await drawAt(
    address,
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
function engines(page: ReturnType<typeof within>): HTMLElement {
  return page.getByRole("switch", { name: "Show new sites in search engines" });
}

/** The field of a count, by the name of its setting. */
function field(page: ReturnType<typeof within>, name: string): HTMLInputElement {
  return page.getByRole("textbox", { name }) as HTMLInputElement;
}

/** Type a count into a field. */
function type(page: ReturnType<typeof within>, name: string, text: string): void {
  fireEvent.change(field(page, name), { target: { value: text } });
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

describe("the one page", () => {
  // Drift: a setting that arrives with no words would be shown under its raw key, or under a heading nobody looks for it under; or the settings would be split over tabs again.
  test("holds every setting once under the heading of its block, a setting with no words under the heading its key reads like, with a readable name", async () => {
    await drawn();
    const blocks = [...document.querySelectorAll("form section")].map((block) => [block.querySelector("h2")?.textContent, ...[...block.querySelectorAll("h3")].map((name) => name.textContent)]);

    expect([blocks, document.body.textContent?.includes("update_channel")]).toEqual([
      [
        ["New sites", "Search engines", "Keep deleted sites"],
        ["Storage", "All sites together"],
        ["Updates", "Check for new versions", "Update channel", "Update link"],
        ["Sessions", "Sign everyone out"],
      ],
      false,
    ]);
  });
});

describe("the address of one setting", () => {
  // Drift: a link of another screen would land on the top of the page, and the person would have to find the setting it meant among twenty.
  test("points its block out: the block is shaded and its control has the focus", async () => {
    const { to, hash } = settingAddress("trash_days");
    const page = await drawn(`${to}#${hash}`);
    await waitFor(() => expect(document.activeElement).toBe(field(page, "Keep deleted sites")));

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
