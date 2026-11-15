// The Settings screen's routes: the control each setting gets from its type, what a row says, what a save changes and refuses, the rebuild address that no answer holds, and the sign-out.

import { describe, expect, test } from "bun:test";

import { SETTING_VALUES } from "@poplin/core/src/records/settings";
import * as v from "valibot";

import { CONTROL_KINDS, controlOf } from "../../src/console/setting-controls";
import { openConsole, REBUILD_HOST } from "./support/console";

/** One setting as the route answers it. */
interface Row {
  readonly key: string;
  readonly control: { readonly kind: string; readonly least?: number | null; readonly most?: number | null };
  readonly text: string;
  readonly changed: boolean;
  readonly elsewhere: boolean;
}

/** What the route answers. */
interface Settings {
  readonly rows: readonly Row[];
  readonly updateAddress: { readonly set: boolean; readonly since: number | null };
}

async function settingsOf(opened: Awaited<ReturnType<typeof openConsole>>): Promise<Settings> {
  return (await (await opened.get("/data/settings")).json()) as Settings;
}

async function textsOf(opened: Awaited<ReturnType<typeof openConsole>>): Promise<Readonly<Record<string, string>>> {
  return Object.fromEntries((await settingsOf(opened)).rows.map((row) => [row.key, row.text]));
}

describe("the control of a setting", () => {
  // Drift: a setting of a new type would be shown as free text, where it may be an on or off or a fixed list.
  test.each(Object.entries(SETTING_VALUES.entries))("%s has a type that has a control", (_key, schema) => {
    expect(Object.keys(CONTROL_KINDS)).toContain(schema.type);
  });

  // Drift: a control would be drawn without the options or the range its schema gives.
  test.each([
    ["update_check", { kind: "switch" }],
    ["block_bots", { kind: "choice", options: ["auto", "on", "off"] }],
    ["trash_days", { kind: "number", least: 1, most: null }],
    ["site_share_of_day", { kind: "number", least: 1, most: 100 }],
    ["logins", { kind: "lines" }],
    ["max_sites", { kind: "text" }],
    ["max_total_size", { kind: "text" }],
  ] as const)("%s is changed with its own control", (key, control) => {
    expect(controlOf(SETTING_VALUES.entries[key])).toEqual(control);
  });

  // Drift: a type with no control would stop the whole screen, where every setting can still be typed as text.
  test("is the text control for a type that has none", () => {
    expect(controlOf(v.date())).toEqual({ kind: "text" });
  });
});

describe("the rows", () => {
  // Drift: a row would lose its default, its warning, or the mark of a setting changed elsewhere, or a new setting would be left out.
  test("hold every setting of the rule book, each with its text, its default, and its state", async () => {
    const opened = await openConsole();
    const changed = await opened.change("/data/settings", { texts: { requests_per_day: "250000", site_share_of_day: "40%" } });
    const { rows } = await settingsOf(opened);
    const byKey: Readonly<Record<string, unknown>> = Object.fromEntries(rows.map((row) => [row.key, row]));

    expect(changed.status).toBe(200);
    expect(rows.map((row) => row.key)).toEqual(Object.keys(SETTING_VALUES.entries));
    expect([byKey.requests_per_day, byKey.site_share_of_day, byKey.logins, byKey.block_bots]).toEqual([
      {
        key: "requests_per_day",
        control: { kind: "number", least: 1, most: null },
        text: "250000",
        suffix: "",
        fallback: "100000",
        changed: true,
        warning: "above the free 10,000,000 reads a month; above the free 100,000 requests a day",
        elsewhere: false,
      },
      { key: "site_share_of_day", control: { kind: "number", least: 1, most: 100 }, text: "40%", suffix: "%", fallback: "25%", changed: true, warning: null, elsewhere: false },
      { key: "logins", control: { kind: "lines" }, text: opened.base.owner, suffix: "", fallback: "The email of whoever set the install up", changed: false, warning: null, elsewhere: false },
      { key: "block_bots", control: { kind: "choice", options: ["auto", "on", "off"] }, text: "auto", suffix: "", fallback: "auto", changed: false, warning: null, elsewhere: true },
    ]);
  });
});

describe("a save", () => {
  // Drift: a save of one group would write another group's settings, or miss that the logins changed and need a repair.
  test("changes the settings it names and no other, and says when the logins changed", async () => {
    const opened = await openConsole();
    const before = await textsOf(opened);
    const logins = `${opened.base.owner},jonas@example.com`;
    const plain = await opened.change("/data/settings", { texts: { trash_days: "30", default_search_engines: "on" } });
    const withLogins = await opened.change("/data/settings", { texts: { logins } });

    expect([await plain.json(), await withLogins.json()]).toEqual([
      { ok: true, loginsChanged: false },
      { ok: true, loginsChanged: true },
    ]);
    expect(await textsOf(opened)).toEqual({ ...before, trash_days: "30", default_search_engines: "on", logins });
  });

  // Drift: a refused save would write the settings before the refused one, or name the wrong field.
  test.each([
    ["text that is not in the setting's form", { versions_kept: "9", trash_days: "soon" }, 400, "bad_argument", "trash_days"],
    ["a number outside its range", { site_share_of_day: "140%" }, 400, "bad_argument", "site_share_of_day"],
    ["a setting changed where the domain is", { block_bots: "on" }, 400, "bad_argument", "block_bots"],
    ["a key that is no setting", { colour: "blue" }, 400, "bad_argument", "colour"],
    ["no setting at all", {}, 400, "bad_argument", "settings"],
    ["logins without the admin's own email", { logins: "jonas@example.com" }, 409, "no_working_login", "logins"],
  ])("refuses %s and changes nothing", async (_what, texts, status, code, about) => {
    const opened = await openConsole();
    const before = await textsOf(opened);
    const response = await opened.change("/data/settings", { texts });

    expect([response.status, await response.json()]).toMatchObject([status, { ok: false, code, about }]);
    expect(await textsOf(opened)).toEqual(before);
  });

  // Drift: a setting would be refused in the general sentence, which names its key and no rule, or a number's sentence would tell a range its schema no longer has.
  test("is refused in a sentence that tells the setting's rule and not its key, a number's with the range of its schema", async () => {
    const opened = await openConsole();
    const saved = (await settingsOf(opened)).rows.filter((row) => !row.elsewhere);
    const told: [string, string][] = [];
    for (const row of saved) {
      const refusal = (await (await opened.change("/data/settings", { texts: { [row.key]: "" } })).json()) as { readonly sentence: string };
      told.push([row.key, refusal.sentence]);
    }
    const rangeOf = ({ least, most }: Row["control"]): string => (most === null ? `Use a whole number, ${least} or more.` : `Use a whole number from ${least} to ${most}.`);
    const ranges = new Map(saved.filter((row) => row.control.kind === "number").map((row) => [row.key, rangeOf(row.control)]));

    expect(told.filter(([key, sentence]) => sentence.includes(key) || sentence.includes("is not one it takes"))).toEqual([]);
    expect(told.filter(([key]) => ranges.has(key))).toEqual([...ranges]);
    expect(Object.fromEntries(told)).toMatchObject({ trash_days: "Use a whole number, 1 or more.", default_expires: "Use never, or a span such as 12h or 30d." });
  });
});

describe("the rebuild address", () => {
  // Drift: the address is a credential, and an answer or the log would hand it to whoever reads them.
  test("is saved, told only as set since a moment, and removed, with no answer holding it", async () => {
    const opened = await openConsole();
    const address = `https://${REBUILD_HOST}/start/a-long-secret-part`;
    const saved = await (await opened.change("/data/settings/update-address", { address })).text();
    const shown = await (await opened.get("/data/settings")).text();
    const removed = await (await opened.change("/data/settings/update-address/remove", {})).text();
    const { now } = opened.base.clock;

    expect([JSON.parse(saved), (JSON.parse(shown) as Settings).updateAddress, JSON.parse(removed)]).toEqual([
      { ok: true, set: true, since: now },
      { set: true, since: now },
      { ok: true, set: false, since: null },
    ]);
    expect(`${saved}${shown}${removed}${JSON.stringify(await opened.base.audit())}`).not.toContain("a-long-secret-part");
    expect((await settingsOf(opened)).updateAddress).toEqual({ set: false, since: null });
  });

  // Drift: an address the host starts no rebuild at would be kept, and the next update would send the session's admin nowhere.
  test.each(["https://elsewhere.example.com/start/x", `http://${REBUILD_HOST}/start/x`, "not an address"])("refuses %s at its field and keeps none", async (address) => {
    const opened = await openConsole();
    const response = await opened.change("/data/settings/update-address", { address });

    expect([response.status, await response.json()]).toEqual([
      400,
      { ok: false, code: "bad_argument", about: "address", sentence: "That is not an address the host starts a rebuild at. Paste the whole address, starting with https://." },
    ]);
    expect((await settingsOf(opened)).updateAddress).toEqual({ set: false, since: null });
  });
});

describe("the sign-out of everyone", () => {
  // Drift: the button would answer done while the session that pressed it, or any other, went on working.
  test("ends the session that asked for it and writes one entry", async () => {
    const opened = await openConsole();
    const done = await opened.change("/data/settings/sign-everyone-out", {});
    const after = await opened.get("/data/settings");

    expect([done.status, await done.json(), after.status]).toEqual([200, { ok: true }, 401]);
    expect((await opened.base.audit()).filter((entry) => entry.action === "signed_everyone_out")).toHaveLength(1);
  });
});
