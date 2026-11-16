// The reset of the test install runs against a local fake: the SQL it sends has no other reader, and a reset that left a token, a second demo site, an emptied setting, or other sites than the demo lists behind would show on the real install alone.

import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CEILINGS } from "../../packages/cloudflare/scripts/live/budget";
import { resetInstall, runReset } from "../../packages/cloudflare/scripts/live/reset";
import { ROW_CEILINGS } from "../../packages/cloudflare/scripts/live/rows";
import { openRun } from "../../packages/cloudflare/scripts/live/util";
import { BunSqliteDriver } from "../../packages/core/tests/database/support/bun-sqlite-driver";
import { readSamples } from "../../packages/demo/scripts/samples";
import { createPreview } from "../../packages/demo/src/preview/preview";
import { readRealSites } from "../../packages/demo/src/preview/real-sites";
import { withFake } from "../../packages/cloudflare/tests/zone/support/fake-cloudflare";
import { type Asked, page, refusal } from "../../packages/cloudflare/tests/zone/support/replies";
import { liveAddresses } from "./addresses";
import { openBench } from "./bench";
import { FAKE_DOMAIN } from "./support/fake-install";
import { STORED_TYPE_HEADER } from "../../packages/core/src/api/routes";
import { FAKE_NOW, openSqlInstall } from "./support/sql-install";
import { catchStep } from "./support/step";

/** The repository's sample sites. */
const SAMPLES = join(import.meta.dir, "..", "..", "demo", "samples");

/** What a reset leaves, written by hand: every site by its name, who may open it, its public name, whether it is in the trash, its live version, and whether it runs out. The demo's version is the reset's own count. */
const LEFT_SITES: readonly (readonly [name: string, access: string, publicName: string | null, trashed: 0 | 1, version: number, expires: 0 | 1])[] = [
  ["checkout", "private", null, 0, 1, 1],
  ["handbook", "public", "handbook", 0, 1, 0],
  ["launch-deck", "unlisted", null, 0, 1, 0],
  ["lisbon-trip", "public", "lisbon", 0, 1, 0],
  ["old-notes", "unlisted", null, 1, 1, 0],
  ["pricing", "unlisted", null, 0, 1, 0],
  ["sales-report", "private", null, 0, 3, 0],
  ["spring-offer", "unlisted", null, 0, 1, 1],
  ["status-board", "private", null, 0, 1, 0],
  ["team-site", "private", null, 0, 1, 0],
  ["winter-offer", "unlisted", null, 0, 1, 1],
];

/** The sample sites a reset leaves outside the trash, and the ones it leaves inside it. */
const [PUBLISHED = [], BINNED = []] = [0, 1].map((trashed) => LEFT_SITES.filter((site) => site[3] === trashed).map(([name]) => name));

/** The samples the demo links to at an address that is new with every publish: the ones outside the trash that no public name gives one. */
const MOVES = LEFT_SITES.filter(([, access, , trashed]) => access !== "public" && trashed === 0).map(([name]) => name);

/** The path of the demo's file of real addresses, as an upload names it. */
const REAL_SITES_PATH = "path=sites.json";

/** The version the demo's installs are told they run. */
const VERSION = "1.0.0";

/** The dashboard's client of a demo no browser opens. */
const NO_CLIENT = { entry: async () => ({ script: "app.js", style: "app.css" }), file: async () => undefined };

/** The account of the fake Cloudflare. */
const ACCOUNT = "0".repeat(32);

/** The one zone of the fake Cloudflare's account. */
const ZONE = { id: "1".repeat(32), name: FAKE_DOMAIN, account: { id: ACCOUNT }, plan: { name: "Free Website" } };

/** The addresses of the fake install, which answers under that zone's name. */
const ADDRESSES = liveAddresses({ kind: "domain", domain: FAKE_DOMAIN });

/** Two computers that wait to be let in: one nobody decided on, and one allowed whose token was never collected. */
const WAITING = `INSERT INTO logins (id, code, hash, scope, computer, visitor, state, decided_by, created_at, expires_at) VALUES
  ('login-one', 'CODEONE1', 'hash-one', 'publisher', 'a laptop', 'a visitor', 'pending', NULL, 1700000000000, 1700000600000),
  ('login-two', 'CODETWO2', 'hash-two', 'admin', 'a desktop', 'a visitor', 'allowed', 'ada@example.com', 1700000000000, 1700000600000)`;

/** The bucket writes and lists of a reset that removes three sites and publishes the samples and a new demo of three files: 3 removals, 85 for eleven sites and their 74 files, 12 for two more versions of one, 1 move to the trash, 4 for the demo. */
const FIRST_RESET = 105;

/** The rows the same reset counts: 3 removals at 13, 12 new sites at 19, the demo among them, 1 more for each of the 3 that run out, 2 more versions at 13, and 1 move to the trash at 6. */
const FIRST_RESET_ROWS = 302;

/** The rows of a site removed for good, as the harness counts one. */
const REMOVAL_ROWS = 13;

/** The rows of a new version of a site, 13, and of the title it asks for, 2: what a reset that keeps every sample and updates the demo's site counts. */
const DEMO_UPDATE_ROWS = 15;

/** Every sample site, in the table's order: what a reset that finds each as its row ends says it kept. */
const SAMPLES_IN_ORDER = ["handbook", "sales-report", "old-notes", "launch-deck", "team-site", "lisbon-trip", "winter-offer", "pricing", "spring-offer", "status-board", "checkout"];

/** A day, in milliseconds. */
const DAY_MS = 86_400_000;

/** The bucket writes and lists of a reset that keeps every sample and updates the demo's site: its three files, and the listing that finishes the publish. */
const DEMO_UPDATE = 4;

/** What a reset says of an install that held none of the samples: the samples in the table's order, the ones in the trash, the one site with three versions, how many the demo links to, and that it kept none. */
const PUT = {
  kept: [],
  live: ["handbook", "sales-report", "launch-deck", "team-site", "lisbon-trip", "winter-offer", "pricing", "spring-offer", "status-board", "checkout"],
  binned: BINNED,
  versioned: { name: "sales-report", versions: 3 },
  linked: PUBLISHED.length,
};

/** One thing that differs when the second reset runs, and the samples that reset must publish anew. */
const CHANGES: readonly Change[] = [
  { what: "nothing changed", change: async () => undefined, anew: [] },
  { what: "a site was opened to more people", change: sql("UPDATE sites SET access = 'unlisted' WHERE name = 'team-site'"), anew: ["team-site"] },
  { what: "a site got another public name", change: sql("UPDATE sites SET public_name = 'lisbon-two' WHERE name = 'lisbon-trip'"), anew: ["lisbon-trip"] },
  { what: "a site got another title", change: sql("UPDATE sites SET title = 'Other' WHERE name = 'pricing'"), anew: ["pricing"] },
  { what: "a site lost its typed title", change: sql("UPDATE sites SET title = NULL WHERE name = 'status-board'"), anew: ["status-board"] },
  { what: "a site's frame switch was flipped", change: sql("UPDATE sites SET embeddable = 1 - embeddable WHERE name = 'checkout'"), anew: ["checkout"] },
  { what: "a site's search engine switch was flipped", change: sql("UPDATE sites SET search_engines = 1 - search_engines WHERE name = 'handbook'"), anew: ["handbook"] },
  { what: "a site that never ran out was given an expiry", change: sql(`UPDATE sites SET expires_at = ${FAKE_NOW + 10 * DAY_MS} WHERE name = 'launch-deck'`), anew: ["launch-deck"] },
  { what: "a site that ran out was given no expiry", change: sql("UPDATE sites SET expires_at = NULL WHERE name = 'winter-offer'"), anew: ["winter-offer"] },
  { what: "a site came within a day of running out", change: sql(`UPDATE sites SET expires_at = ${FAKE_NOW + DAY_MS} WHERE name = 'spring-offer'`), anew: ["spring-offer"] },
  { what: "a site was given longer than its seven days", change: sql(`UPDATE sites SET expires_at = ${FAKE_NOW + 7 * DAY_MS + 1} WHERE name = 'spring-offer'`), anew: ["spring-offer"] },
  { what: "a site was moved to the trash", change: sql(`UPDATE sites SET trashed_at = ${FAKE_NOW} WHERE name = 'team-site'`), anew: ["team-site"] },
  { what: "the trashed site was restored", change: sql("UPDATE sites SET trashed_at = NULL WHERE name = 'old-notes'"), anew: ["old-notes"] },
  { what: "a site was rolled back", change: sql("UPDATE sites SET live_version = 2 WHERE name = 'sales-report'"), anew: ["sales-report"] },
  { what: "a site kept as many versions under later numbers", change: publishOnto("sales-report", "sales-report"), anew: ["sales-report"] },
  { what: "a site stores another title of its entry page", change: sql("UPDATE sites SET page_title = 'Other' WHERE name = 'sales-report'"), anew: ["sales-report"] },
  { what: "the install was told to keep two versions of a site", change: sql("UPDATE settings SET value = json_set(value, '$.versions_kept', 2)"), anew: ["sales-report"] },
  {
    what: "the install was told to keep two versions of a site that holds the first and the third",
    change: sql("UPDATE settings SET value = json_set(value, '$.versions_kept', 2)", "DELETE FROM versions WHERE number = 2 AND folder = (SELECT folder FROM sites WHERE name = 'sales-report')"),
    anew: ["sales-report"],
  },
  { what: "the trashed site came within a day of being removed for good", change: sql(`UPDATE sites SET trashed_at = ${FAKE_NOW - 6 * DAY_MS} WHERE name = 'old-notes'`), anew: ["old-notes"] },
  { what: "a site lost a version", change: sql("DELETE FROM versions WHERE number = 1 AND folder = (SELECT folder FROM sites WHERE name = 'sales-report')"), anew: ["sales-report"] },
  { what: "a site got a version more", change: publishOnto("status-board"), anew: ["status-board"] },
  { what: "a site was renamed", change: sql("UPDATE sites SET name = 'other-name' WHERE name = 'checkout'"), anew: ["checkout"] },
  { what: "a site took the name of another", change: sql("UPDATE sites SET name = 'checkout' WHERE name = 'status-board'"), anew: ["status-board", "checkout"] },
  { what: "one letter of a sample's file changed, at the same length", change: sampleFile("trip-summary", "site.css", (text) => text.replace("e", "a")), anew: ["handbook", "old-notes", "lisbon-trip"] },
  { what: "a sample got a file more", change: sampleFile("launch-deck", "more.txt", () => "more"), anew: ["launch-deck", "team-site", "status-board"] },
  { what: "a file of a sample got another name", change: sampleRenamed("sales-report", "charts.js", "graphs.js"), anew: ["sales-report", "team-site", "pricing"] },
  { what: "a sample lost a file", change: sampleRemoved("checkout-prototype", "assets/ink.svg"), anew: ["team-site", "winter-offer", "spring-offer", "checkout"] },
  { what: "the install stores a file under another media type", change: storedAs("checkout.js", "text/plain"), anew: ["team-site", "winter-offer", "spring-offer", "checkout"] },
  { what: "the demo was built with another page", change: demoWith("<title>another demo</title>"), anew: [], demoDiffers: true },
  { what: "the demo's site got another title", change: sql("UPDATE sites SET title = 'Other' WHERE public_name = 'demo'"), anew: [], demoDiffers: true },
];

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** A fake install and the token a reset of it runs with. */
type Install = Awaited<ReturnType<typeof openSqlInstall>>;

/** A site as the API lists it, in what a row of the Sites screen shows of it. */
interface Listed {
  readonly name: string;
  readonly access: string;
  readonly public_name: string | null;
  readonly title: string | null;
  readonly title_typed: boolean;
  readonly embeddable: boolean;
  readonly expires: "never" | number;
  readonly state: string;
  readonly url: string;
}

/** What a reset must leave of an install: every site with its place and version, and how many tokens and waiting logins. */
interface Left {
  readonly sites: readonly Record<string, unknown>[];
  readonly tokens: unknown;
  readonly logins: unknown;
}

/** What stands in front of a reset in one test: who answers for the install, where its waits are kept, its ceiling of bucket writes and lists, the folder of the samples, and what builds the demo. */
interface Front {
  readonly fetch?: Install["fetch"];
  readonly pauses?: number[];
  readonly ceiling?: number;
  readonly rowCeiling?: number;
  readonly samples?: string;
  readonly buildDemo?: (out: string) => Promise<void>;
}

/** What a change is made on: the install after its first reset, and the folder both resets read the samples from. */
interface Changed {
  readonly install: Install;
  readonly samples: string;
}

/** What makes one thing differ, and what then stands in front of the second reset. */
type Differ = (at: Changed) => Promise<Front | undefined>;

/** One change: what differs, what makes it differ, the samples the second reset publishes anew, and whether the demo's own site or files differ. */
interface Change {
  readonly what: string;
  readonly change: Differ;
  readonly anew: readonly string[];
  readonly demoDiffers?: true;
}

/** The demo as a test builds it: a first page and a worker, written by hand. */
async function buildDemo(out: string, page = "<title>a demo</title>"): Promise<void> {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), page);
  writeFileSync(join(out, "sw.js"), "self.addEventListener('fetch', () => undefined);");
}

/** A change made in the install's database, as a person's change on the dashboard leaves it. */
function sql(...statements: readonly string[]): Differ {
  return async ({ install }) => {
    for (const statement of statements) await install.sql(statement);

    return undefined;
  };
}

/** A change to one file of a sample's folder: its text rewritten, or the file made. */
function sampleFile(sample: string, file: string, rewrite: (text: string) => string): Differ {
  return async ({ samples }) => {
    const path = join(samples, sample, file);
    writeFileSync(path, rewrite(existsSync(path) ? readFileSync(path, "utf8") : ""));

    return undefined;
  };
}

/** A file of a sample's folder under another name, its bytes as they were. */
function sampleRenamed(sample: string, from: string, to: string): Differ {
  return async ({ samples }) => {
    renameSync(join(samples, sample, from), join(samples, sample, to));

    return undefined;
  };
}

/** A sample's folder without one of its files, which the install's versions still hold. */
function sampleRemoved(sample: string, file: string): Differ {
  return async ({ samples }) => {
    rmSync(join(samples, sample, file));

    return undefined;
  };
}

/** An install that hands out every file of one name with another media type than a publish declares. */
function storedAs(file: string, type: string): Differ {
  return async ({ install }) => ({
    fetch: async (input, init) => {
      const answer = await install.fetch(input, init);
      if (!input.includes(`path=${file}`) || (init.method ?? "GET") !== "GET") return answer;

      const headers = new Headers(answer.headers);
      headers.set(STORED_TYPE_HEADER, type);

      return new Response(answer.body, { status: answer.status, headers });
    },
  });
}

/** A demo whose build writes another first page. */
function demoWith(page: string): Differ {
  return async () => ({ buildDemo: (out) => buildDemo(out, page) });
}

/** One more version of a site, published by a person: a page of their own, or a sample's folder as it is. */
function publishOnto(site: string, sample?: string): Differ {
  return async ({ install, samples }) => {
    const parts = { addresses: ADDRESSES, token: await install.addToken("a person's own"), run: "reset", missing: {}, fetch: install.fetch, pause: async () => undefined, now: () => 0, manyFiles: 1, largeCopy: 1 };
    const { bench, close } = openBench({ ...parts, say: () => undefined });
    OPENED.push(close);
    const [row] = await install.sql("SELECT id FROM sites WHERE name = ?", [site]);
    const folder = sample === undefined ? bench.folder("<p>one more</p>") : join(samples, sample);
    expect((await bench.cli("publish", folder, "--site", String(row?.id))).code).toBe(0);

    return undefined;
  };
}

/** Give a fake install three sites, one of them in the trash, a second token, and two waiting logins. */
async function fill(install: Install): Promise<void> {
  const { bench, close } = openBench({
    addresses: ADDRESSES,
    token: await install.addToken("a person's own"),
    run: "reset",
    missing: {},
    fetch: install.fetch,
    pause: async () => undefined,
    now: () => 0,
    say: () => undefined,
    manyFiles: 1,
    largeCopy: 1,
  });
  OPENED.push(close);

  await bench.publish({ access: "private", text: "<p>one</p>" });
  await bench.publish({ access: "public", text: "<p>two</p>" });
  const trashed = await bench.publish({ access: "unlisted", text: "<p>three</p>" });
  expect((await bench.cli("delete", trashed.label)).code).toBe(0);

  await install.sql(WAITING);
}

/** Run a reset with a token made for it. */
function reset(install: Install, token: string, front: Front = {}): ReturnType<typeof resetInstall> {
  const { fetch = install.fetch, pauses = [], ceiling = CEILINGS.reset, samples = SAMPLES } = front;

  return resetInstall({
    server: install.server,
    token,
    fetch,
    pause: async (ms) => {
      pauses.push(ms);
    },
    sql: async (statement) => {
      await install.sql(statement);

      return undefined;
    },
    now: () => FAKE_NOW,
    samples,
    buildDemo: front.buildDemo ?? buildDemo,
    ceiling,
    rowCeiling: front.rowCeiling ?? ROW_CEILINGS.reset,
  });
}

async function left(install: Install): Promise<Left> {
  const [tokens] = await install.sql("SELECT COUNT(*) AS rows FROM tokens");
  const [logins] = await install.sql("SELECT COUNT(*) AS rows FROM logins");

  return {
    sites: await install.sql("SELECT name, access, public_name, trashed, expires_at IS NOT NULL AS expires, live_version FROM sites ORDER BY name"),
    tokens: tokens?.rows,
    logins: logins?.rows,
  };
}

/** What a reset leaves: the demo's site at a version, the sample sites, and nothing else. */
function resetState(demoVersion: number): Left {
  const samples = LEFT_SITES.map(([name, access, publicName, trashed, version, expires]) => ({ name, access, public_name: publicName, trashed, expires, live_version: version }));
  const demo = { name: "demo", access: "public", public_name: "demo", trashed: 0, expires: 0, live_version: demoVersion };

  return { sites: [...samples, demo].sort((one, other) => one.name.localeCompare(other.name)), tokens: 0, logins: 0 };
}

afterEach(() => {
  for (const close of OPENED.splice(0)) close();
});

describe("the reset of the test install, against a local fake", () => {
  test("a reset leaves the sample sites and the demo alone, one sample in the trash, with no token or waiting login, and the settings untouched; the next one keeps every sample as it stands and updates the demo's site alone", async () => {
    const install = await openSqlInstall();
    await fill(install);
    const settings = await install.settings();

    const first = await reset(install, await install.addToken("the first reset"));
    const demo = await install.sql("SELECT id FROM sites WHERE public_name = 'demo'");

    expect({ ended: first, left: await left(install), settings: await install.settings() }).toEqual({
      ended: { ...PUT, removed: 2, trashed: 1, demo: "published", operations: FIRST_RESET, rows: FIRST_RESET_ROWS },
      left: resetState(1),
      settings,
    });

    // A demo's site that ran out since the reset before answers 404 until the next one gives it no expiry again.
    await install.sql("UPDATE sites SET expires_at = created_at WHERE public_name = 'demo'");
    const second = await reset(install, await install.addToken("the second reset"));

    expect({ ended: second, left: await left(install), demo: await install.sql("SELECT id FROM sites WHERE public_name = 'demo'") }).toEqual({
      ended: { ...PUT, kept: SAMPLES_IN_ORDER, removed: 0, trashed: 0, demo: "updated", operations: DEMO_UPDATE, rows: DEMO_UPDATE_ROWS },
      left: resetState(2),
      demo,
    });
  });

  // Drift: a reset keeps a site it finds as its row ends, to spare the database its rows. A site kept though one thing of it differs would stay wrong on the test install for good: every later reset would keep it again.
  test.each(CHANGES)("a reset after $what publishes those samples anew and keeps every other, and updates the demo when one it links to has a new address", async ({ change, anew, demoDiffers }) => {
    using copy = mkdtempDisposableSync(join(tmpdir(), "poplin-reset-samples-"));
    cpSync(SAMPLES, copy.path, { recursive: true });
    const install = await openSqlInstall();
    await reset(install, await install.addToken("the first reset"), { samples: copy.path });

    const front = await change({ install, samples: copy.path });
    const second = await reset(install, await install.addToken("the second reset"), { samples: copy.path, ...front });

    const demo = demoDiffers === true || anew.some((name) => MOVES.includes(name)) ? "updated" : "kept";

    expect({ ended: "kind" in second ? second : { kept: second.kept, demo: second.demo }, left: await left(install) }).toEqual({
      ended: { kept: SAMPLES_IN_ORDER.filter((name) => !anew.includes(name)), demo },
      left: resetState(demo === "kept" ? 1 : 2),
    });
  });

  // Drift: the demo and the install are told to hold the same sites by one table, through two writers. A writer that read a row otherwise would show on the two Sites screens side by side alone.
  test("after a reset the install lists the sites the demo's seed lists, each with the same name, access, public name, title, frame switch, expiry or none, and place in or out of the trash", async () => {
    const install = await openSqlInstall();
    await reset(install, await install.addToken("a reset"));
    const preview = await createPreview({ openDriver: () => new BunSqliteDriver(), samples: await readSamples(), version: VERSION, client: NO_CLIENT });
    const token = await install.addToken("a reader");
    const shown = (sites: readonly Listed[]): unknown[] =>
      sites
        .map(({ name, access, public_name, title, title_typed, embeddable, expires, state }) => ({ name, access, public_name, title, title_typed, embeddable, runsOut: expires !== "never", state }))
        .sort((one, other) => one.name.localeCompare(other.name));
    const read = async (answer: Response | Promise<Response>): Promise<readonly Listed[]> => ((await (await answer).json()) as { sites: readonly Listed[] }).sites;
    const lists = ["false", "true"].map(async (trash) => ({
      install: shown(await read(install.fetch(`${install.server}/api/sites?trash=${trash}&limit=100`, { headers: { Authorization: `Bearer ${token}` } }))),
      demo: shown(await read(preview.fetch(new Request(`http://127.0.0.1:4400/api/sites?trash=${trash}&limit=100`, { headers: { Authorization: `Bearer ${preview.token()}` } })))),
    }));
    const [live, trash] = await Promise.all(lists);

    expect([live?.install, trash?.install]).toEqual([live?.demo, trash?.demo]);
    expect([live?.install.length, trash?.install.length]).toEqual([PUBLISHED.length + 1, BINNED.length]);
  });

  // Drift: the demo's links lead where this file says. A site left out sends a visitor to the demo's own copy; one in the trash, or one that runs out within the day, sends them to a page that is gone.
  test("the demo a reset publishes holds the address of every sample site outside the trash, as the install lists it, of no other, and each in the form the demo takes", async () => {
    const install = await openSqlInstall();
    const files: string[] = [];

    await reset(install, await install.addToken("a reset"), {
      fetch: async (input, init) => {
        if (!input.includes(REAL_SITES_PATH)) return install.fetch(input, init);

        const body = await new Response(init.body).text();
        files.push(body);

        return install.fetch(input, { ...init, body });
      },
    });
    const listed = await install.fetch(`${install.server}/api/sites?limit=100`, { headers: { Authorization: `Bearer ${await install.addToken("a reader")}` } });
    const { sites } = (await listed.json()) as { sites: readonly Listed[] };
    const addresses = Object.fromEntries(sites.filter((site) => site.name !== "demo").map((site) => [site.name, `${new URL(site.url).origin}/`]));

    expect(files.map((file) => JSON.parse(file))).toEqual([addresses]);
    expect(files.map((file) => readRealSites(JSON.parse(file)))).toEqual([addresses]);
    expect(Object.keys(addresses).sort()).toEqual(PUBLISHED);
  });

  // Drift: every site of an install without a domain answers under a path, which is no address the demo takes for a link. A reset that wrote the host's root there would send every link of the demo to a 404, on the second test account alone.
  test("on an install without a domain a reset leaves the same sites, each under a path, gives the demo no link to them, and the next reset keeps every one", async () => {
    const install = await openSqlInstall("account address");
    const files: string[] = [];
    const first = await reset(install, await install.addToken("the first reset"), {
      fetch: async (input, init) => {
        if (!input.includes(REAL_SITES_PATH)) return install.fetch(input, init);

        const body = await new Response(init.body).text();
        files.push(body);

        return install.fetch(input, { ...init, body });
      },
    });
    const listed = await install.fetch(`${install.server}/api/sites?limit=100`, { headers: { Authorization: `Bearer ${await install.addToken("a reader")}` } });
    const { sites } = (await listed.json()) as { sites: readonly Listed[] };
    const second = await reset(install, await install.addToken("the second reset"));

    expect([first, files, await left(install)]).toEqual([expect.objectContaining({ ...PUT, linked: 0, demo: "published" }), ["{}"], resetState(1)]);
    expect(sites.filter((site) => new URL(site.url).pathname === "/")).toEqual([]);
    expect(second).toMatchObject({ kept: SAMPLES_IN_ORDER, linked: 0, demo: "kept" });
  });

  test("an answer of too many requests is waited out for as long as it asks, and the reset goes on", async () => {
    const install = await openSqlInstall();
    await fill(install);
    const pauses: number[] = [];
    let refused = false;

    const ended = await reset(install, await install.addToken("a reset"), {
      fetch: async (input, init) => {
        if (init.method !== "DELETE" || refused) return install.fetch(input, init);

        refused = true;

        return Response.json({ error: { code: "too_many_requests", message: "Too many requests." } }, { status: 429, headers: { "Retry-After": "7" } });
      },
      pauses,
    });

    // The request that was told to wait is asked again, and both are counted.
    expect({ ended, pauses, left: await left(install) }).toEqual({
      ended: { ...PUT, removed: 2, trashed: 1, demo: "published", operations: FIRST_RESET + 1, rows: FIRST_RESET_ROWS + REMOVAL_ROWS },
      pauses: [7000],
      left: resetState(1),
    });
  });

  test("a reset the install stops still removes every token and waiting login", async () => {
    const install = await openSqlInstall();
    await fill(install);

    const ended = await reset(install, await install.addToken("a reset"), { fetch: async () => Response.json({ error: { code: "internal", message: "It broke." } }, { status: 500 }) });
    const after = await left(install);

    expect({ ended, tokens: after.tokens, logins: after.logins, sites: after.sites.length }).toEqual({
      ended: { kind: "failed", what: "the install did not list its sites (refused with status 500 and code internal)" },
      tokens: 0,
      logins: 0,
      sites: 3,
    });
  });

  test.each([
    ["bucket writes and lists", { ceiling: 10 }, "the reset passed its ceiling of 10 bucket writes and lists"],
    ["rows written to the database", { rowCeiling: 100 }, "the reset passed its ceiling of 100 rows written to the database"],
  ])("a reset that would pass its ceiling of %s stops red with that as its reason, and still removes every token and waiting login", async (_what, front, what) => {
    const install = await openSqlInstall();
    await fill(install);

    const ended = await reset(install, await install.addToken("a reset"), front);
    const after = await left(install);

    expect({ ended, tokens: after.tokens, logins: after.logins }).toEqual({ ended: { kind: "failed", what }, tokens: 0, logins: 0 });
  });

  test("on an account that holds no test install the script says so as a notice and ends green", async () => {
    using step = catchStep();
    const env = { CLOUDFLARE_API_TOKEN: "a-made-up-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
    let code = -1;

    await withFake(
      (asked: Asked) => {
        const { pathname } = new URL(asked.path, "http://localhost");
        if (pathname === "/zones") return page(asked, [ZONE]);

        return pathname === `/accounts/${ACCOUNT}/d1/database` ? page(asked, []) : refusal(403, 10000, "Authentication error");
      },
      async (connection) => {
        code = await runReset({ ...openRun(env), connection });
      },
    );

    const lines = step.lines.filter((line) => !line.startsWith("::add-mask::"));
    expect({ code, lines }).toEqual({ code: 0, lines: ["::notice::There is no test install yet: nothing was put back."] });
  });
});
