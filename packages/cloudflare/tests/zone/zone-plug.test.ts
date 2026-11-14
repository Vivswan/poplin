import { expect, test } from "bun:test";
import type { DomainReading, DomainSettings } from "@poplin/app/src/dashboard/domain/records";
import type { Login } from "@poplin/core/src/auth/logins";
import { createDomainPlug } from "../../src/zone/zone-plug";
import { type Asked, withFake } from "./support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, OTHER_TOKEN, TOKEN } from "./support/fake-install";
import { LAYOUT } from "./support/layouts";

const STORED: DomainSettings = { logins: ["owner@example.com" as Login], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" };
const SETTINGS = async (): Promise<DomainSettings> => STORED;
const REFUSED = { ok: false, refusal: "token" } as const;

/** The objects of an install, in the order the table shows them, with the state every one has in `states`. */
function table(states: Readonly<Record<string, string>>): string[] {
  const state = (object: string, usual: string): string => states[object] ?? usual;
  const usual = states.all ?? "present";

  return [
    `DNS record | ${state("dns", usual)} | *.example.com`,
    `DNS record | ${state("dns", usual)} | poplin.example.com`,
    `Worker route | ${state("routes", usual)} | *-poplin.example.com/*`,
    `Worker route | ${state("routes", usual)} | poplin.example.com/*`,
    `Access application | ${state("access", usual)} | poplin`,
    `Access policy | ${state("access", usual)} | poplin logins`,
    `WAF rule | ${state("guards", usual)} | bots rule`,
    `WAF rule | ${state("guards", usual)} | outside pages rule`,
    `Rate rule | ${state("rate", usual)} | rate rule`,
    `Bot settings | ${state("bots", usual)} | zone bot switches`,
    `D1 database | ${state("database", usual)} | poplin`,
  ];
}

function shown(reading: DomainReading): string[] {
  if (!reading.ok) return [`refused: ${reading.refusal}`];

  return reading.rows.map((row) => `${row.object} | ${row.state} | ${row.detail}`);
}

function writes(asked: readonly Asked[]): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`);
}

/** Run a test against an account at the fake API, with a plug bound to it. */
async function withAccount(account: Account, run: (plug: ReturnType<typeof createDomainPlug>, asked: readonly Asked[]) => Promise<void>): Promise<void> {
  await withFake(
    (asked) => answer(account, asked),
    (connection, asked) => run(createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl }), asked),
  );
}

test("a check of an account with nothing in it names every object as missing and sends no change: a check that wrote would repair behind the owner's back", async () => {
  const account = emptyAccount();
  const before = structuredClone(account);

  await withAccount(account, async (plug, asked) => {
    const reading = await plug.check(TOKEN, SETTINGS);

    expect(shown(reading)).toEqual(table({ all: "missing", bots: "differs" }));
    expect(reading).toMatchObject({ steps: [] });
    expect(writes(asked)).toEqual([]);
    expect(account).toEqual(before);
  });
});

test("a repair makes every object, a check then finds all present, and a second repair sends no change", async () => {
  const account = emptyAccount();

  await withAccount(account, async (plug, asked) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({ all: "created", bots: "changed" }));
    expect(writes(asked)).toHaveLength(10);

    const sent = asked.length;

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(table({}));
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({}));
    expect(writes(asked.slice(sent))).toEqual([]);
  });
});

test("one object taken away and one changed by hand: the check names exactly those two, and the repair changes exactly those two", async () => {
  const account = emptyAccount();

  await withAccount(account, async (plug, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    account.routes = account.routes.filter((route) => route.pattern !== "poplin.example.com/*");
    account.records = account.records.map((record) => (record.name === "poplin.example.com" ? { ...record, proxied: false } : record));

    const expected = (missing: string, differs: string): string[] =>
      table({}).map((row) =>
        row
          .replace("DNS record | present | poplin", `DNS record | ${differs} | poplin`)
          .replace("Worker route | present | poplin", `Worker route | ${missing} | poplin`),
      );
    const sent = asked.length;

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(expected("missing", "differs"));
    expect(writes(asked.slice(sent))).toEqual([]);
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(expected("created", "changed"));
    expect(writes(asked.slice(sent))).toEqual(["PUT /zones/zone-1/dns_records/made-1", "POST /zones/zone-1/workers/routes"]);
  });
});

test("Access that was never switched on is no failure: both runs go on past it, mark its two rows, and hand over the one step with the address to open", async () => {
  const account = { ...emptyAccount(), accessOff: true };
  const off = (states: Readonly<Record<string, string>>): string[] =>
    table(states).map((row) => row.replace(/^(Access \w+ \| missing \|) .*$/, "$1 Access is off for the account"));
  const steps = [{ text: "Open Zero Trust and pick a plan (Free works): that switches Access on.", address: "https://one.dash.cloudflare.com/account-a" }];

  await withAccount(account, async (plug) => {
    const checked = await plug.check(TOKEN, SETTINGS);

    expect(shown(checked)).toEqual(off({ all: "missing", bots: "differs" }));
    expect(checked).toMatchObject({ steps });

    const repaired = await plug.repair(TOKEN, SETTINGS);

    expect(shown(repaired)).toEqual(off({ all: "created", bots: "changed", access: "missing" }));
    expect(repaired).toMatchObject({ steps });
    expect([account.policies, account.applications]).toEqual([[], []]);

    account.accessOff = false;

    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({ access: "created" }));
  });
});

test("a token that is malformed, unknown to Cloudflare, or valid for another account with a zone of the same name: all three are refused alike, and nothing of the install is read, its settings included", async () => {
  const tokens = ["", "short", `${TOKEN}\r\nX-Injected: 1`, `${TOKEN} `, "unknown-token-0123456789-abcdef", OTHER_TOKEN];

  let reads = 0;
  const counted = async (): Promise<DomainSettings> => {
    reads += 1;

    return STORED;
  };

  await withAccount(emptyAccount(), async (plug, asked) => {
    for (const token of tokens) {
      expect([token, await plug.check(token, counted)]).toEqual([token, REFUSED]);
      expect([token, await plug.repair(token, counted)]).toEqual([token, REFUSED]);
    }

    expect(reads).toBe(0);

    expect([...new Set(asked.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`))]).toEqual(["GET /zones"]);
  });
});

test("a repair refused half way: the rows say what was made, which change failed and why, and what was never reached, and the account holds exactly the part that was made", async () => {
  const account = { ...emptyAccount(), refuse: "POST /zones/zone-1/workers/routes" };

  await withAccount(account, async (plug) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual([
      "DNS record | created | *.example.com",
      "DNS record | created | poplin.example.com",
      `Worker route | failed | *-poplin.example.com/*: refused with status 403: 10000 Authentication error for Bearer ${TOKEN}`,
      "Worker route | not-run | poplin.example.com/*",
      "Access application | not-run | ",
      "WAF rule | not-run | ",
      "Rate rule | not-run | ",
      "Bot settings | not-run | ",
      "D1 database | not-run | ",
    ]);
    expect(account.records.map((record) => record.name)).toEqual(["*.example.com", "poplin.example.com"]);
    expect([account.routes, account.policies, account.applications, account.databases, account.rulesets]).toEqual([[], [], [], [], {}]);
  });
});

test("the token travels in the Authorization header alone: never in an address or a body, where a log would keep it", async () => {
  await withAccount(emptyAccount(), async (plug, asked) => {
    await plug.repair(TOKEN, SETTINGS);

    expect(asked.every((entry) => entry.key === `Bearer ${TOKEN}`)).toBe(true);
    expect(asked.filter((entry) => `${entry.path} ${JSON.stringify(entry.body)}`.includes(TOKEN))).toEqual([]);
  });
});

test("an API that does not answer is told apart from a refused token, so the owner does not go looking for a new one", async () => {
  const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: "http://127.0.0.1:1" });

  expect(await plug.check(TOKEN, SETTINGS)).toEqual({ ok: false, refusal: "unreachable" });
});

test("a proven token on an install with no settings is told so and reads nothing further: only the zone list was asked for", async () => {
  await withAccount(emptyAccount(), async (plug, asked) => {
    expect(await plug.repair(TOKEN, async () => undefined)).toEqual({ ok: false, refusal: "not_set_up" });
    expect([...new Set(asked.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`))]).toEqual(["GET /zones"]);
  });
});

test("Access refused as not switched on after the policy was already made is a stopped repair: the made row stays in the table", async () => {
  const account = { ...emptyAccount(), refuse: "POST /accounts/account-a/access/apps", refuseMessage: "access.api.error.not_enabled" };

  await withAccount(account, async (plug) => {
    const rows = shown(await plug.repair(TOKEN, SETTINGS));

    expect(rows.slice(4, 7)).toEqual([
      "Access policy | created | poplin logins",
      "Access application | failed | poplin: refused with status 403: 10000 access.api.error.not_enabled",
      "WAF rule | not-run | ",
    ]);
    expect(account.policies).toHaveLength(1);
  });
});

test("the bots setting's note names the switch that can lock the owner's own tools out, in Cloudflare's words: the page has no other place that warns of it", () => {
  const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT });

  expect(plug.guardNotes.block_bots).toContain("Bot Fight Mode, which can block the command line from cloud hosts");
});
