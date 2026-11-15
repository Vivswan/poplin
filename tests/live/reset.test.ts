// The reset of the test install runs against a local fake: the SQL it sends has no other reader, and a reset that left a token, a second demo site, an emptied setting, or other sites than the demo lists behind would show on the real install alone.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CEILINGS } from "../../packages/cloudflare/scripts/live/budget";
import { resetInstall, runReset } from "../../packages/cloudflare/scripts/live/reset";
import { openRun } from "../../packages/cloudflare/scripts/live/util";
import { BunSqliteDriver } from "../../packages/core/tests/database/support/bun-sqlite-driver";
import { readSamples } from "../../packages/demo/scripts/samples";
import { createPreview } from "../../packages/demo/src/preview/preview";
import { readRealSites } from "../../packages/demo/src/preview/real-sites";
import { withFake } from "../../packages/cloudflare/tests/zone/support/fake-cloudflare";
import { type Asked, page, refusal } from "../../packages/cloudflare/tests/zone/support/replies";
import { openBench } from "./bench";
import { FAKE_DOMAIN } from "./support/fake-install";
import { openSqlInstall } from "./support/sql-install";
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
];

/** The sample sites a reset leaves outside the trash, and the ones it leaves inside it. */
const [PUBLISHED = [], BINNED = []] = [0, 1].map((trashed) => LEFT_SITES.filter((site) => site[3] === trashed).map(([name]) => name));

/** The site of the demo's seed alone: one that ran out, which an install that is put back does not hold. */
const SEED_ALONE = "winter-offer";

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

/** Two computers that wait to be let in: one nobody decided on, and one allowed whose token was never collected. */
const WAITING = `INSERT INTO logins (id, code, hash, scope, computer, visitor, state, decided_by, created_at, expires_at) VALUES
  ('login-one', 'CODEONE1', 'hash-one', 'publisher', 'a laptop', 'a visitor', 'pending', NULL, 1700000000000, 1700000600000),
  ('login-two', 'CODETWO2', 'hash-two', 'admin', 'a desktop', 'a visitor', 'allowed', 'ada@example.com', 1700000000000, 1700000600000)`;

/** The bucket writes and lists of a reset that removes three sites and publishes the samples and a new demo of three files: 3 removals, 76 for ten sites and their 66 files, 12 for two more versions of one, 1 move to the trash, 4 for the demo. */
const FIRST_RESET = 96;

/** What every reset says it published: the samples in the table's order, the ones in the trash, the one site with three versions, and how many the demo links to. */
const PUT = {
  published: ["handbook", "sales-report", "launch-deck", "team-site", "lisbon-trip", "pricing", "spring-offer", "status-board", "checkout"],
  binned: BINNED,
  versioned: { name: "sales-report", versions: 3 },
  linked: PUBLISHED.length,
};

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

/** What stands in front of a reset in one test: who answers for the install, where its waits are kept, and its ceiling of bucket writes and lists. */
interface Front {
  readonly fetch?: Install["fetch"];
  readonly pauses?: number[];
  readonly ceiling?: number;
}

/** The demo as a test builds it: a first page and a worker, written by hand. */
async function buildDemo(out: string): Promise<void> {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), "<title>a demo</title>");
  writeFileSync(join(out, "sw.js"), "self.addEventListener('fetch', () => undefined);");
}

/** Give a fake install three sites, one of them in the trash, a second token, and two waiting logins. */
async function fill(install: Install): Promise<void> {
  const { bench, close } = openBench({
    domain: FAKE_DOMAIN,
    token: await install.addToken("a person's own"),
    run: "reset",
    missing: {},
    fetch: install.fetch,
    pause: async () => undefined,
    manyFiles: 1,
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
  const { fetch = install.fetch, pauses = [], ceiling = CEILINGS.reset } = front;

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
    samples: SAMPLES,
    buildDemo,
    ceiling,
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
  test("a reset leaves the sample sites and the demo alone, one sample in the trash, with no token or waiting login, and the settings untouched; the next one updates the demo's site", async () => {
    const install = await openSqlInstall();
    await fill(install);
    const settings = await install.settings();

    const first = await reset(install, await install.addToken("the first reset"));
    const demo = await install.sql("SELECT id FROM sites WHERE public_name = 'demo'");

    expect({ ended: first, left: await left(install), settings: await install.settings() }).toEqual({
      ended: { ...PUT, removed: 2, trashed: 1, demo: "published", operations: FIRST_RESET },
      left: resetState(1),
      settings,
    });

    // A demo's site that ran out since the reset before answers 404 until the next one gives it no expiry again.
    await install.sql("UPDATE sites SET expires_at = created_at WHERE public_name = 'demo'");
    const second = await reset(install, await install.addToken("the second reset"));

    expect({ ended: second, left: await left(install), demo: await install.sql("SELECT id FROM sites WHERE public_name = 'demo'") }).toEqual({
      ended: { ...PUT, removed: PUBLISHED.length, trashed: BINNED.length, demo: "updated", operations: FIRST_RESET + PUBLISHED.length + BINNED.length - 3 },
      left: resetState(2),
      demo,
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
      demo: shown((await read(preview.fetch(new Request(`http://127.0.0.1:4400/api/sites?trash=${trash}&limit=100`, { headers: { Authorization: `Bearer ${preview.token()}` } })))).filter((site) => site.name !== SEED_ALONE)),
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
      ended: { ...PUT, removed: 2, trashed: 1, demo: "published", operations: FIRST_RESET + 1 },
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

  test("a reset that would pass its ceiling of bucket writes and lists stops red with that as its reason, and still removes every token and waiting login", async () => {
    const install = await openSqlInstall();
    await fill(install);

    const ended = await reset(install, await install.addToken("a reset"), { ceiling: 10 });
    const after = await left(install);

    expect({ ended, tokens: after.tokens, logins: after.logins }).toEqual({
      ended: { kind: "failed", what: "the reset passed its ceiling of 10 bucket writes and lists" },
      tokens: 0,
      logins: 0,
    });
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
