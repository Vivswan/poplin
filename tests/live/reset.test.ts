// The reset of the test install runs against a local fake: the SQL it sends has no other reader, and a reset that left a token, a second demo site, or an emptied setting behind would show on the real install alone.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resetInstall, runReset } from "../../packages/cloudflare/scripts/live/reset";
import { openRun } from "../../packages/cloudflare/scripts/live/util";
import { withFake } from "../../packages/cloudflare/tests/zone/support/fake-cloudflare";
import { type Asked, page, refusal } from "../../packages/cloudflare/tests/zone/support/replies";
import { openBench } from "./bench";
import { FAKE_DOMAIN } from "./support/fake-install";
import { openSqlInstall } from "./support/sql-install";

/** The repository's sample sites. */
const SAMPLES = join(import.meta.dir, "..", "..", "demo", "samples");

/** The names of the sample sites, as a reset publishes them. */
const SAMPLE_NAMES = ["checkout-prototype", "launch-deck", "sales-report", "trip-summary"];

/** The account of the fake Cloudflare. */
const ACCOUNT = "0".repeat(32);

/** The one zone of the fake Cloudflare's account. */
const ZONE = { id: "1".repeat(32), name: FAKE_DOMAIN, account: { id: ACCOUNT }, plan: { name: "Free Website" } };

/** Two computers that wait to be let in: one nobody decided on, and one allowed whose token was never collected. */
const WAITING = `INSERT INTO logins (id, code, hash, scope, computer, visitor, state, decided_by, created_at, expires_at) VALUES
  ('login-one', 'CODEONE1', 'hash-one', 'publisher', 'a laptop', 'a visitor', 'pending', NULL, 1700000000000, 1700000600000),
  ('login-two', 'CODETWO2', 'hash-two', 'admin', 'a desktop', 'a visitor', 'allowed', 'ada@example.com', 1700000000000, 1700000600000)`;

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** A fake install and the token a reset of it runs with. */
type Install = Awaited<ReturnType<typeof openSqlInstall>>;

/** What a reset must leave of an install: every site with its place and version, and how many tokens and waiting logins. */
interface Left {
  readonly sites: readonly Record<string, unknown>[];
  readonly tokens: unknown;
  readonly logins: unknown;
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

/** Run a reset with a token made for it; `fetch` stands in front of the install when a test answers for it. */
function reset(install: Install, token: string, fetch = install.fetch, pauses: number[] = []): ReturnType<typeof resetInstall> {
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
  });
}

async function left(install: Install): Promise<Left> {
  const [tokens] = await install.sql("SELECT COUNT(*) AS rows FROM tokens");
  const [logins] = await install.sql("SELECT COUNT(*) AS rows FROM logins");

  return {
    sites: await install.sql("SELECT name, access, public_name, trashed, expires_at, live_version FROM sites ORDER BY name"),
    tokens: tokens?.rows,
    logins: logins?.rows,
  };
}

/** What a reset leaves: the demo's site at a version, the four samples, and nothing else. */
function resetState(demoVersion: number): Left {
  const samples = SAMPLE_NAMES.map((name) => ({ name, access: "private", public_name: null, trashed: 0, expires_at: null, live_version: 1 }));
  const demo = { name: "demo", access: "public", public_name: "demo", trashed: 0, expires_at: null, live_version: demoVersion };

  return { sites: [...samples, demo].sort((one, other) => one.name.localeCompare(other.name)), tokens: 0, logins: 0 };
}

afterEach(() => {
  for (const close of OPENED.splice(0)) close();
});

describe("the reset of the test install, against a local fake", () => {
  test("a reset leaves the samples and the demo alone, with no trash, token, or waiting login, and the settings untouched; the next one updates the demo's site", async () => {
    const install = await openSqlInstall();
    await fill(install);
    const settings = await install.settings();

    const first = await reset(install, await install.addToken("the first reset"));
    const demo = await install.sql("SELECT id FROM sites WHERE public_name = 'demo'");

    expect({ ended: first, left: await left(install), settings: await install.settings() }).toEqual({
      ended: { removed: 2, trashed: 1, published: SAMPLE_NAMES, demo: "published" },
      left: resetState(1),
      settings,
    });

    // A demo's site that ran out since the reset before answers 404 until the next one gives it no expiry again.
    await install.sql("UPDATE sites SET expires_at = created_at WHERE public_name = 'demo'");
    const second = await reset(install, await install.addToken("the second reset"));

    expect({ ended: second, left: await left(install), demo: await install.sql("SELECT id FROM sites WHERE public_name = 'demo'") }).toEqual({
      ended: { removed: 4, trashed: 0, published: SAMPLE_NAMES, demo: "updated" },
      left: resetState(2),
      demo,
    });
  });

  test("an answer of too many requests is waited out for as long as it asks, and the reset goes on", async () => {
    const install = await openSqlInstall();
    await fill(install);
    const pauses: number[] = [];
    let refused = false;

    const ended = await reset(
      install,
      await install.addToken("a reset"),
      async (input, init) => {
        if (init.method !== "DELETE" || refused) return install.fetch(input, init);

        refused = true;

        return Response.json({ error: { code: "too_many_requests", message: "Too many requests." } }, { status: 429, headers: { "Retry-After": "7" } });
      },
      pauses,
    );

    expect({ ended, pauses, left: await left(install) }).toEqual({ ended: { removed: 2, trashed: 1, published: SAMPLE_NAMES, demo: "published" }, pauses: [7000], left: resetState(1) });
  });

  test("a reset the install stops still removes every token and waiting login", async () => {
    const install = await openSqlInstall();
    await fill(install);

    const ended = await reset(install, await install.addToken("a reset"), async () => Response.json({ error: { code: "internal", message: "It broke." } }, { status: 500 }));
    const after = await left(install);

    expect({ ended, tokens: after.tokens, logins: after.logins, sites: after.sites.length }).toEqual({
      ended: { kind: "failed", what: "the install did not list its sites (refused with status 500 and code internal)" },
      tokens: 0,
      logins: 0,
      sites: 3,
    });
  });

  test("on an account that holds no test install the script says so as a notice and ends green", async () => {
    using log = spyOn(console, "log").mockImplementation(() => undefined);
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

    const lines = log.mock.calls.map(([line]) => String(line)).filter((line) => !line.startsWith("::add-mask::"));
    expect({ code, lines }).toEqual({ code: 0, lines: ["::notice::There is no test install yet: nothing was put back."] });
  });
});
