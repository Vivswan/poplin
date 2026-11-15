// A group of the Settings screen: what is saved the moment it is changed, what waits for Save, and what a refused save leaves on the screen.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { SettingGroup } from "@/settings/setting-group";
import { type Row, useSettings } from "@/settings/settings-queries";

/** The sentence the server refuses a save with in these tests. */
const RULE = "Use a whole number, 1 or more.";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The texts the server of these tests holds, by setting. */
const stored: Record<string, string> = {};

/** The texts of every save the group sent. */
const saves: unknown[] = [];

/** What the group told about its unsaved typing, newest last. */
const unsaved: boolean[] = [];

/** The saves the server holds back until a test lets them through. */
const held: (() => void)[] = [];

function rowOf(key: string, control: Row["control"]): Row {
  return { key: key as Row["key"], control, text: stored[key] ?? "", suffix: "", fallback: "", changed: false, warning: null, elsewhere: false };
}

function answer(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Answer as the server does: the rows as stored, and every save done, or refused about `refusedKey`.
 *
 * @param holds - whether a save waits until a test lets it through
 */
function serve({ refusedKey, holds = false }: { readonly refusedKey?: string; readonly holds?: boolean } = {}): void {
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") {
      const rows = [rowOf("default_search_engines", { kind: "switch" }), rowOf("trash_days", { kind: "number", least: 1, most: null })];

      return answer({ ok: true, rows, updateAddress: { set: false, since: null } });
    }

    const { texts } = JSON.parse(String(init.body)) as { readonly texts: Record<string, string> };
    saves.push(texts);
    if (holds) await new Promise<void>((resolve) => held.push(resolve));

    if (refusedKey !== undefined) return answer({ ok: false, code: "bad_argument", about: refusedKey, sentence: RULE }, 400);

    Object.assign(stored, texts);

    return answer({ ok: true, loginsChanged: false });
  }) as typeof fetch;
}

/** The group over the settings as they are read, as the screen draws it. */
function Screen(): ReactNode {
  const { data } = useSettings();
  if (data === undefined) return null;

  return <SettingGroup group={{ id: "sites", label: "Sites", folded: false, rows: data.rows }} onUnsaved={(_id, holds) => unsaved.push(holds)} />;
}

async function drawn(): Promise<ReturnType<typeof within>> {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Screen />
    </QueryClientProvider>,
  );
  const page = within(document.body);
  await waitFor(() => page.getByRole("switch"));

  return page;
}

/** Type into the field of the days in the trash. */
function type(page: ReturnType<typeof within>, text: string): void {
  fireEvent.change(page.getByRole("textbox"), { target: { value: text } });
}

beforeEach(() => {
  Object.assign(stored, { default_search_engines: "off", trash_days: "7" });
  serve();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = OWN_FETCH;
  saves.length = 0;
  unsaved.length = 0;
  held.length = 0;
});
afterAll(clearPage);

describe("a group of settings", () => {
  // Drift: a switch would wait for Save again, and leaving the screen would drop it without a word.
  test("saves a switch alone the moment it is flipped, and counts it as nothing unsaved", async () => {
    const page = await drawn();
    await act(async () => {
      fireEvent.click(page.getByRole("switch"));
    });
    await waitFor(() => expect(stored.default_search_engines).toBe("on"));

    expect([page.getByRole("switch").getAttribute("aria-checked"), saves, unsaved.at(-1)]).toEqual(["true", [{ default_search_engines: "on" }], false]);
  });

  // Drift: a refused switch would stay where it was put though nothing was saved, or its refusal would not be said.
  test("puts a refused switch back and says the refusal at it", async () => {
    serve({ refusedKey: "default_search_engines" });
    const page = await drawn();
    await act(async () => {
      fireEvent.click(page.getByRole("switch"));
    });
    await waitFor(() => expect(page.getByRole("alert").textContent).toBe(RULE));
    await waitFor(() => expect(page.getByRole("switch").getAttribute("aria-checked")).toBe("false"));

    expect(saves).toEqual([{ default_search_engines: "on" }]);
  });

  // Drift: typing would be sent key by key, or a screen with a typed value could be left without the question.
  test("keeps a typed value for Save and counts it as unsaved until it is stored", async () => {
    const page = await drawn();
    type(page, "9");

    expect([saves, unsaved.at(-1), page.getByRole("button", { name: "Save" }).hasAttribute("disabled")]).toEqual([[], true, false]);

    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(unsaved.at(-1)).toBe(false));

    expect([saves, stored.trash_days, (page.getByRole("textbox") as HTMLInputElement).value]).toEqual([[{ trash_days: "9" }], "9", "9"]);
  });

  // Drift: a value typed back to the old one while a save is on its way would count as saved, the screen could be left unasked, and the other value would be stored.
  test("counts what is typed during a save against the value on its way", async () => {
    serve({ holds: true });
    const page = await drawn();
    type(page, "8");
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Save" }));
    });
    type(page, "7");

    expect(unsaved.at(-1)).toBe(true);

    await act(async () => held.shift()?.());
    await waitFor(() => expect(page.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false));

    expect([stored.trash_days, (page.getByRole("textbox") as HTMLInputElement).value, unsaved.at(-1)]).toEqual(["8", "7", true]);
  });

  // Drift: a switch flipped while a Save is on its way would jump back when that Save is answered, and a second press would send the same value again.
  test("keeps a switch flipped during a Save where it was put, and sends the two saves in the order they were made", async () => {
    serve({ holds: true });
    const page = await drawn();
    type(page, "8");
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Save" }));
    });
    await act(async () => {
      fireEvent.click(page.getByRole("switch"));
    });
    await act(async () => held.shift()?.());
    await waitFor(() => expect(saves).toHaveLength(2));

    expect(page.getByRole("switch").getAttribute("aria-checked")).toBe("true");

    await act(async () => held.shift()?.());
    await waitFor(() => expect(stored.default_search_engines).toBe("on"));

    expect([saves, stored.trash_days, page.getByRole("switch").getAttribute("aria-checked")]).toEqual([
      [{ trash_days: "8" }, { default_search_engines: "on" }],
      "8",
      "true",
    ]);
  });
});
