// The Settings screen's routes: the control each setting gets from its type, the one unit an amount is typed in, what a row says, what a save changes and refuses, the update link that no answer holds, and the sign-out.

import { describe, expect, test } from "bun:test";

import { MOST_FILES_PER_PUBLISH, SETTING_VALUES } from "@poplin/core/src/records/settings";
import * as v from "valibot";

import type { DomainPlug } from "../../src/console/domain/records";
import { CONTROL_KINDS, controlOf } from "../../src/console/setting-controls";
import { openConsole, REBUILD_HOST } from "./support/console";

/** One setting as the route answers it. */
interface Row {
  readonly key: string;
  readonly control: { readonly kind: string; readonly word?: string | null };
  readonly text: string;
  readonly unit: string;
  readonly fallback: string;
  readonly repair: boolean;
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
    ["trash_days", { kind: "number", word: null }],
    ["site_share_of_day", { kind: "number", word: null }],
    ["logins", { kind: "lines" }],
    ["max_sites", { kind: "number", word: "none" }],
    ["max_total_size", { kind: "number", word: null }],
    ["default_expires", { kind: "number", word: "never" }],
  ] as const)("%s is changed with its own control", (key, control) => {
    expect(controlOf(SETTING_VALUES.entries[key])).toEqual(control);
  });

  // Drift: a type with no control would stop the whole screen, where every setting can still be typed as text.
  test("is the text control for a type that has none", () => {
    expect(controlOf(v.date())).toEqual({ kind: "text" });
  });
});

describe("the rows", () => {
  // Drift: a size's limit would be counted in bytes beside a field typed in MB, or in MB beside one typed in KB, so the screen's mark would follow another number than the typed one.
  test.each([
    ["typed in MB", {}, [{ over: 10_000, unit: "MB" }]],
    ["typed in KB, and in the MB of the default that Reset puts back", { max_total_size: "500KB" }, [{ over: 10_000_000, unit: "KB" }, { over: 10_000, unit: "MB" }]],
  ])("count a size's free limit in the unit its text is %s", async (_what, texts, counts) => {
    const opened = await openConsole();
    if (Object.keys(texts).length > 0) await opened.change("/data/settings", { texts });
    const row = (await settingsOf(opened)).rows.find((one) => one.key === "max_total_size") as unknown as { readonly limits: readonly unknown[] };

    expect(row.limits).toEqual(counts.map((count) => ({ ...count, warning: "all sites are above the free 10 GB" })));
  });

  // Drift: a row would lose its default or its limits, a new setting would be left out, or the logins, which the Access screen changes, would come back as a row.
  test("hold every setting of the rule book but the logins, each with its text, its default, and the free limits it can be put above", async () => {
    const opened = await openConsole();
    const changed = await opened.change("/data/settings", { texts: { requests_per_day: "250000", site_share_of_day: "40%" } });
    const { rows } = await settingsOf(opened);
    const byKey: Readonly<Record<string, unknown>> = Object.fromEntries(rows.map((row) => [row.key, row]));

    expect(changed.status).toBe(200);
    expect(rows.map((row) => row.key)).toEqual(Object.keys(SETTING_VALUES.entries).filter((key) => key !== "logins"));
    expect([byKey.requests_per_day, byKey.site_share_of_day, byKey.block_bots]).toEqual([
      {
        key: "requests_per_day",
        control: { kind: "number", word: null },
        text: "250000",
        unit: "",
        fallback: "100000",
        limits: [
          { over: 102_526, unit: "", warning: "above the free 10,000,000 reads a month" },
          { over: 100_000, unit: "", warning: "above the free 100,000 requests a day" },
        ],
        repair: false,
      },
      { key: "site_share_of_day", control: { kind: "number", word: null }, text: "40%", unit: "%", fallback: "25%", limits: [], repair: false },
      { key: "block_bots", control: { kind: "choice", options: ["auto", "on", "off"] }, text: "auto", unit: "", fallback: "auto", limits: [], repair: false },
    ]);
  });

  // Drift: a size would be shown in the unit it was stored in, so the screen's fixed MB would stand beside a count of GB; or a value that is no whole number of the screen's unit would be rounded, and a save of the row would change it.
  test.each([
    ["a size stored in GB", {}, "max_total_size", { text: "9000MB", unit: "MB", fallback: "9000MB" }],
    ["the same size saved in MB", { max_total_size: "9000MB" }, "max_total_size", { text: "9000MB", unit: "MB" }],
    ["a size that is no whole number of MB", { max_site_size: "500KB" }, "max_site_size", { text: "500KB", unit: "KB", fallback: "200MB" }],
    ["a span of whole days stored in hours", { default_expires: "48h" }, "default_expires", { text: "2d", unit: "d", fallback: "never" }],
    ["a span that is no whole number of days", { default_expires: "12h" }, "default_expires", { text: "12h", unit: "h" }],
    ["no span at all", {}, "default_expires", { text: "never", unit: "d" }],
    ["no count at all", {}, "max_sites", { text: "none", unit: "" }],
  ])("write %s in the one unit the screen types it in", async (_what, texts, key, row) => {
    const opened = await openConsole();
    if (Object.keys(texts).length > 0) await opened.change("/data/settings", { texts });

    expect((await settingsOf(opened)).rows.find((entry) => entry.key === key)).toMatchObject(row);
  });

  // Drift: the line that sends a person to the Domain screen would show in a dashboard that has none, or be missing where a repair is what carries the change to the domain.
  test("mark the settings a repair carries to the domain only in a dashboard with the Domain screen", async () => {
    const marked = async (domain?: DomainPlug): Promise<readonly string[]> => (await settingsOf(await openConsole("", domain))).rows.filter((row) => row.repair).map((row) => row.key);

    expect([await marked(), await marked({} as DomainPlug)]).toEqual([[], ["outside_pages", "search_engines_allowed", "block_bots"]]);
  });
});

describe("a save", () => {
  // Drift: a save would write a setting it does not name, or refuse the settings that also change the domain's rules, which this screen changes.
  test("changes the settings it names, the ones of the domain included, and no other", async () => {
    const opened = await openConsole();
    const before = await textsOf(opened);
    const saved = await opened.change("/data/settings", { texts: { trash_days: "30", default_search_engines: "on", block_bots: "off", outside_pages: "allowed" } });

    expect(await saved.json()).toEqual({ ok: true });
    expect(await textsOf(opened)).toEqual({ ...before, trash_days: "30", default_search_engines: "on", block_bots: "off", outside_pages: "allowed" });
  });

  // Drift: a refused save would write the settings before the refused one, or name the wrong field.
  test.each([
    ["text that is not in the setting's form", { versions_kept: "9", trash_days: "soon" }, "bad_argument", "trash_days"],
    ["a number outside its range", { site_share_of_day: "140%" }, "bad_argument", "site_share_of_day"],
    ["the logins, which the Access screen changes", { trash_days: "9", logins: "owner@example.com,jonas@example.com" }, "bad_argument", "logins"],
    ["a key that is no setting", { colour: "blue" }, "bad_argument", "colour"],
    ["no setting at all", {}, "bad_argument", "settings"],
  ])("refuses %s and changes nothing", async (_what, texts, code, about) => {
    const opened = await openConsole();
    const before = await textsOf(opened);
    const response = await opened.change("/data/settings", { texts });

    expect([response.status, await response.json()]).toMatchObject([400, { ok: false, code, about }]);
    expect(await textsOf(opened)).toEqual(before);
  });

  // Drift: a save of several refused values would name one of them, so the screen would mark one field a press and Save would be pressed once for each.
  test("is refused about every setting whose text it refuses, each with its own sentence, and about the first as any refusal is", async () => {
    const opened = await openConsole();
    const texts = { trash_days: "", max_files_per_publish: "20000", site_share_of_day: "150%", visitor_requests_per_minute: "0" };
    const response = await opened.change("/data/settings", { texts });
    const refusal = (await response.json()) as { readonly about: string; readonly sentence: string; readonly each: readonly { readonly about: string; readonly sentence: string }[] };

    expect([response.status, refusal.each.map((one) => one.about), refusal.each[0]]).toEqual([400, Object.keys(texts), { about: refusal.about, sentence: refusal.sentence }]);
    expect(new Set(refusal.each.map((one) => one.sentence)).size).toBeGreaterThan(1);
  });

  // Drift: a setting would be refused in the general sentence, which names its key and no rule; or a number's sentence would tell another range than core's rule has.
  test("is refused in a sentence that tells the setting's rule and not its key", async () => {
    const opened = await openConsole();
    const told: [string, string][] = [];
    for (const row of (await settingsOf(opened)).rows) {
      const refusal = (await (await opened.change("/data/settings", { texts: { [row.key]: "" } })).json()) as { readonly sentence: string };
      told.push([row.key, refusal.sentence]);
    }

    expect(told.filter(([key, sentence]) => sentence.includes(key) || sentence.includes("is not one it takes"))).toEqual([]);
    expect(Object.fromEntries(told)).toMatchObject({
      trash_days: "Use a whole number, 1 or more.",
      max_total_size: "Use a whole number, 1 or more.",
      max_sites: "Use a whole number, 1 or more, or leave it empty for no limit.",
      max_files_per_publish: `Use a whole number from 1 to ${MOST_FILES_PER_PUBLISH.toLocaleString("en-US")}.`,
      site_share_of_day: "Use a whole number from 1 to 100.",
    });
  });
});

describe("the update link", () => {
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
      { ok: false, code: "bad_argument", about: "address", sentence: "That is not an update link of the host. Paste the whole link, starting with https://." },
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
