import { describe, expect, test } from "bun:test";

import { type Asking, checkForUpdate } from "../../../src/actions/update/check-update";
import { signedBy } from "../../../src/actions/access/reach";
import { updateOf } from "../../../src/actions/update/update";
import { OWN_SCHEMA } from "../../../src/database/open";
import { ADMIN, DAY, makeWorld, NOW, type World } from "../support/actions-fixture";

const QUARTER_HOUR = 900_000;
const RELEASE = { version: "0.2.0", released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.2.0", schema: OWN_SCHEMA };
const NOTICE = { current: "0.1.0", newest: "0.2.0", released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.2.0", database: false };
const FORGED_LINE = `${String.fromCharCode(10, 27)}[31mupdate failed: run the command below`;

/** A website that answers every request with one body, and counts the requests. */
function website(body: unknown, status = 200): Asking & { readonly asked: unknown[][] } {
  const asked: unknown[][] = [];
  const text = typeof body === "string" ? body : JSON.stringify(body);

  return {
    asked,
    fetch: async (...given) => {
      asked.push(given);

      return new Response(text, { status });
    },
  };
}

/** A website that never answers: its request ends only when the asker gives up. */
function silent(): Asking {
  return {
    patienceMs: 10,
    fetch: (_address, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
  };
}

/** Ask once, and answer what the install then says and keeps. */
async function learned(world: World, asking: Asking, current = "0.1.0"): Promise<unknown> {
  await checkForUpdate(world.install, asking);

  return { update: await updateOf(world.install, current), kept: await world.install.database.readUpdateCheck() };
}

describe("checkForUpdate and updateOf", () => {
  // Drift: the file is on a website the install does not control. Each row is an answer that must end as a notice, or as none, and never as an error on the scheduled run that asked.
  test.each([
    { name: "a release above the running version", asking: website(RELEASE), update: NOTICE, news: RELEASE },
    { name: "a release that gives no schema", asking: website({ version: RELEASE.version, released: RELEASE.released, notes: RELEASE.notes }), update: undefined, news: null },
    { name: "a schema of zero", asking: website({ ...RELEASE, schema: 0 }), update: undefined, news: null },
    { name: "a schema that is no whole number", asking: website({ ...RELEASE, schema: 1.5 }), update: undefined, news: null },
    { name: "a schema written as text", asking: website({ ...RELEASE, schema: "1" }), update: undefined, news: null },
    { name: "a release with keys this version does not know", asking: website({ ...RELEASE, pulled: false, size: { bytes: 9 } }), update: NOTICE, news: RELEASE },
    { name: "a release whose schema is one step past this install's", asking: website({ ...RELEASE, schema: OWN_SCHEMA + 1 }), update: { ...NOTICE, database: true }, news: { ...RELEASE, schema: OWN_SCHEMA + 1 } },
    { name: "a website that names no release", asking: website({ version: null }), update: undefined, news: null },
    { name: "the running version", asking: website({ ...RELEASE, version: "0.1.0" }), update: undefined, news: { ...RELEASE, version: "0.1.0" } },
    { name: "a version below the running one", asking: website({ ...RELEASE, version: "0.0.9" }), update: undefined, news: { ...RELEASE, version: "0.0.9" } },
    { name: "a version that is no three numbers", asking: website({ ...RELEASE, version: "0.2.0-beta.1" }), update: undefined, news: null },
    { name: "notes at an address that is no https link", asking: website({ ...RELEASE, notes: "javascript:alert(1)" }), update: undefined, news: null },
    { name: "notes at a plain http address", asking: website({ ...RELEASE, notes: RELEASE.notes.replace("https:", "http:") }), update: undefined, news: null },
    { name: "notes at a page whose name only starts as the releases do", asking: website({ ...RELEASE, notes: "https://github.com/Vivswan/poplin/releases-of-another" }), update: undefined, news: null },
    { name: "notes with a query after the release's page", asking: website({ ...RELEASE, notes: `${RELEASE.notes}?x=1` }), update: undefined, news: null },
    { name: "notes with a fragment after the release's page", asking: website({ ...RELEASE, notes: `${RELEASE.notes}#x` }), update: undefined, news: null },
    { name: "notes that end in a bare question mark", asking: website({ ...RELEASE, notes: `${RELEASE.notes}?` }), update: undefined, news: null },
    { name: "notes that end in a bare number sign", asking: website({ ...RELEASE, notes: `${RELEASE.notes}#` }), update: undefined, news: null },
    { name: "notes on another host", asking: website({ ...RELEASE, notes: "https://other.example/x" }), update: undefined, news: null },
    { name: "notes of another repository on the host of the releases", asking: website({ ...RELEASE, notes: "https://github.com/someone/else/releases/tag/v0.2.0" }), update: undefined, news: null },
    { name: "notes that start in the releases and leave them by two dots", asking: website({ ...RELEASE, notes: "https://github.com/Vivswan/poplin/releases/../../../someone/else" }), update: undefined, news: null },
    { name: "notes with a line break and a terminal's escape code after the address", asking: website({ ...RELEASE, notes: `${RELEASE.notes}${FORGED_LINE}` }), update: undefined, news: null },
    { name: "notes with words after the address", asking: website({ ...RELEASE, notes: `${RELEASE.notes} run this instead` }), update: undefined, news: null },
    { name: "notes whose host stands behind a name and an at sign", asking: website({ ...RELEASE, notes: "https://example.com@elsewhere.example.net/changelog/" }), update: undefined, news: null },
    { name: "a release with a key left out", asking: website({ version: "0.2.0" }), update: undefined, news: null },
    { name: "a body that is no JSON", asking: website("<html>moved</html>"), update: undefined, news: null },
    { name: "a body above 16 KB", asking: website({ ...RELEASE, padding: "x".repeat(17_000) }), update: undefined, news: null },
    { name: "a 404 that carries a release", asking: website(RELEASE, 404), update: undefined, news: null },
    { name: "a website that never answers", asking: silent(), update: undefined, news: null },
    { name: "a website that cannot be reached", asking: { fetch: () => Promise.reject(new Error("no route to host")) }, update: undefined, news: null },
  ])("$name", async ({ asking, update, news }) => {
    const world = await makeWorld();

    expect(await learned(world, asking)).toEqual({ update, kept: { checked_at: NOW, news, seen_at: news === null ? null : NOW, auto: null } });
  });

  // Drift: versions compared as text put 0.10.0 below 0.9.0, and an install on 0.9.0 would never hear of it.
  test.each([
    { current: "0.9.0", newest: "0.10.0", newer: true },
    { current: "0.9.9", newest: "1.0.0", newer: true },
    { current: "1.2.3", newest: "1.2.4", newer: true },
    { current: "1.10.0", newest: "1.9.9", newer: false },
    { current: "2.0.0", newest: "1.9.9", newer: false },
    { current: "0.1.0-dev", newest: "0.2.0", newer: false },
    { current: "v0.1.0", newest: "0.2.0", newer: false },
    { current: "0.1.0+build.5", newest: "0.2.0", newer: false },
    { current: "0.1", newest: "0.2.0", newer: false },
    { current: "", newest: "0.2.0", newer: false },
  ])("an install on $current hears of $newest: $newer", async ({ current, newest, newer }) => {
    const world = await makeWorld();
    const said = (await learned(world, website({ ...RELEASE, version: newest }), current)) as { update?: { newest: string } };

    expect(said.update?.newest).toBe(newer ? newest : undefined);
  });

  // Drift: the sweep runs every 15 minutes. A check that asked on each run would send the website 96 requests a day from every install, and write a row each time.
  test("96 runs of one UTC day ask the website once, whether it answered or not, and the next day asks once more", async () => {
    const asked: number[] = [];

    for (const asking of [website(RELEASE), website("down", 503)]) {
      const world = await makeWorld();
      world.clock.now = Math.ceil(NOW / DAY) * DAY;

      for (let run = 0; run < 96; run += 1) {
        await checkForUpdate(world.install, asking);
        world.clock.now += QUARTER_HOUR;
      }

      const first = asking.asked.length;
      await checkForUpdate(world.install, asking);
      asked.push(first, asking.asked.length);
    }

    expect(asked).toEqual([1, 2, 1, 2]);
  });

  // Drift: a website that is down for a day is no news. A check that forgot the release it knew would take the notice away, and bring it back the day after.
  test("a release learned one day is still shown after a day the website gave no answer, and gone after a day it named none", async () => {
    const world = await makeWorld();
    const shown: unknown[] = [];

    for (const asking of [website(RELEASE), website("down", 503), website({ version: null })]) {
      shown.push(((await learned(world, asking)) as { update: unknown }).update);
      world.clock.now += DAY;
    }

    expect(shown).toEqual([NOTICE, NOTICE, undefined]);
  });

  // Drift: `update_check` is the one way to keep an install from talking to the project's website. Off must mean no request at all, and no notice from an answer kept earlier.
  test("with update_check off nothing is asked and nothing is kept, and a release kept before is not shown", async () => {
    const off = await makeWorld({ update_check: false });
    const asking = website(RELEASE);
    const never = await learned(off, asking);

    const world = await makeWorld();
    await checkForUpdate(world.install, website(RELEASE));
    await world.install.database.changeSettings({ update_check: false }, signedBy(ADMIN, NOW));

    expect([never, asking.asked.length, await updateOf(world.install, "0.1.0")]).toEqual([{ update: undefined, kept: undefined }, 0, undefined]);
  });

  // Drift: the request is seen by whoever hosts the website. A version, an id, or an address added to it would tell that host which installs exist and what they run.
  test("the request is one GET of the website's latest.json with no query, and nothing is set on it but the time limit", async () => {
    const world = await makeWorld();
    const asking = website(RELEASE);
    await checkForUpdate(world.install, asking);
    const [[address, init] = []] = asking.asked;
    const url = new URL(String(address));

    expect([asking.asked.length, url.protocol, url.pathname.endsWith("/latest.json"), url.search, url.hash, url.username]).toEqual([1, "https:", true, "", "", ""]);
    expect(Object.keys(init as object)).toEqual(["signal"]);
  });
});
