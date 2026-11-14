import { expect, test } from "bun:test";
import type { DomainReading, DomainSettings } from "@poplin/app/src/dashboard/domain/records";
import type { Login } from "@poplin/core/src/auth/logins";
import { createDomainPlug } from "../../src/zone/zone-plug";
import { withFake } from "./support/fake-cloudflare";
import type { Asked } from "./support/replies";
import { ACCOUNT, type Account, answer, emptyAccount, OTHER_TOKEN, TEAM, TOKEN } from "./support/fake-install";
import { LAYOUT } from "./support/layouts";

const STORED: DomainSettings = { logins: ["owner@example.com" as Login], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" };
const SETTINGS = async (): Promise<DomainSettings> => STORED;
const REFUSED = { ok: false, refusal: "token" } as const;

/** The objects of an install, in the order the table shows them, with the state every one has in `states`. */
function table(states: Readonly<Record<string, string>>): string[] {
  const state = (object: string, usual: string): string => states[object] ?? usual;
  const usual = states.all ?? "present";
  const variable = state("variable", state("access", usual));

  return [
    "Public word | present | page (public sites answer at <name>-page.example.com)",
    `DNS record | ${state("dns", usual)} | *.example.com`,
    `DNS record | ${state("dns", usual)} | poplin.example.com`,
    `Worker route | ${state("routes", usual)} | *-page.example.com/*`,
    `Worker route | ${state("routes", usual)} | *-poplin.example.com/*`,
    `Worker route | ${state("routes", usual)} | poplin.example.com/*`,
    `Access application | ${state("access", usual)} | poplin: poplin.example.com/login, *-p-poplin.example.com`,
    `Access policy | ${state("access", usual)} | poplin logins`,
    `Worker variable | ${variable} | ${variable === "missing" ? "ACCESS: written once the Access application exists" : "ACCESS"}`,
    `Redirect rule | ${state("https", usual)} | https redirect`,
    `WAF rule | ${state("guards", usual)} | bots rule: also stops every method but GET and HEAD, and the paths *.php, /.env, /.env.*, /.git/, /wp-admin/, /cgi-bin/, /phpmyadmin`,
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
    expect(writes(asked)).toHaveLength(13);

    const sent = asked.length;

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(table({}));
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({}));
    expect(writes(asked.slice(sent))).toEqual([]);
  });
});

test("a repair makes the one Access application over the login path and the private sites, and the https rule only where the zone does not redirect by itself", async () => {
  const [plain, redirecting] = [emptyAccount(), { ...emptyAccount(), zoneRedirects: true }];

  await withAccount(plain, async (plug) => void (await plug.repair(TOKEN, SETTINGS)));
  await withAccount(redirecting, async (plug) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({ all: "created", bots: "changed", https: "present" }));
  });

  expect(plain.applications.map((application) => (application.destinations as { uri: string }[]).map((place) => place.uri))).toEqual([["poplin.example.com/login", "*-p-poplin.example.com"]]);
  expect([Object.keys(plain.rulesets).includes("http_request_dynamic_redirect"), Object.keys(redirecting.rulesets).includes("http_request_dynamic_redirect")]).toEqual([true, false]);
});

test("a repair writes the application's audience tag and the team's domain onto the Worker and keeps every other binding: a Worker with no ACCESS lets nobody log in, and one that lost its bucket serves nothing", async () => {
  const account = emptyAccount();
  const ready = [{ text: "The login is ready. Open your dashboard and log in:", address: "https://poplin.example.com" }];

  await withAccount(account, async (plug) => {
    expect(await plug.repair(TOKEN, SETTINGS)).toMatchObject({ steps: ready });
    expect(account.bindings.map((binding) => binding.name)).toEqual(["SITES", "DB", "ZONE", "ACCESS"]);
    expect(account.bindings.at(-1)).toEqual({ name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications[0]?.aud } });
    expect(await plug.repair(TOKEN, SETTINGS)).toMatchObject({ steps: [] });

    account.bindings = account.bindings.map((binding) => (binding.name === "ACCESS" ? { ...binding, json: JSON.stringify({ team_domain: TEAM, audience: "f".repeat(64) }) } : binding));

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(table({ variable: "differs" }));
  });
});

test("a login added to the settings: the check says the Access policy lets other emails through, and the repair lets the new one in, so a person added in Settings is not stopped at Cloudflare's login", async () => {
  const account = emptyAccount();
  const added: DomainSettings = { ...STORED, logins: [...STORED.logins, "second@example.com" as Login] };

  await withAccount(account, async (plug, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    const sent = asked.length;
    const differs = table({}).map((row) => row.replace("Access policy | present | poplin logins", "Access policy | differs | poplin logins: not the logins of the settings"));

    expect(shown(await plug.check(TOKEN, async () => added))).toEqual(differs);
    expect(writes(asked.slice(sent))).toEqual([]);

    await plug.repair(TOKEN, async () => added);

    expect(account.policies.map((policy) => policy.include)).toEqual([[{ email: { email: "owner@example.com" } }, { email: { email: "second@example.com" } }]]);
  });
});

/** The right each call of a repair needs, by the start of its path after the account or the zone. */
const RIGHT_OF: readonly (readonly [path: RegExp, right: string])[] = [
  [/^\/zones\?/, "Zone: Read"],
  [/^\/zones\/[^/]+\/dns_records/, "DNS: Edit"],
  [/^\/zones\/[^/]+\/workers\/routes/, "Workers Routes: Edit"],
  [/^\/accounts\/[^/]+\/access\/(apps|policies)/, "Access: Apps and Policies: Edit"],
  [/^\/accounts\/[^/]+\/access\/organizations/, "Access: Organizations, Identity Providers, and Groups: Read"],
  [/^\/accounts\/[^/]+\/workers\/scripts/, "Workers Scripts: Edit"],
  [/^\/zones\/[^/]+\/settings\//, "Zone Settings: Read"],
  [/^\/zones\/[^/]+\/rulesets\/phases\/http_request_dynamic_redirect/, "Single Redirect: Edit"],
  [/^\/zones\/[^/]+\/rulesets/, "Zone WAF: Edit"],
  [/^\/zones\/[^/]+\/bot_management/, "Bot Management: Edit"],
  [/^\/accounts\/[^/]+\/d1\/database/, "D1: Edit"],
];

test("the rights the page asks a token for are the rights a repair's calls need, no more and no fewer: a call added without its right is refused on every real install", async () => {
  await withAccount(emptyAccount(), async (plug, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    const needed = asked.map((entry) => RIGHT_OF.find(([path]) => path.test(entry.path))?.[1] ?? `no right is known for ${entry.method} ${entry.path}`);

    expect([...new Set(needed)].sort()).toEqual([...plug.tokenRights].sort());
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
  const steps = [{ text: "Open Zero Trust and pick a plan (Free works): that switches Access on.", address: `https://one.dash.cloudflare.com/${ACCOUNT}` }];

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
      "Public word | present | page (public sites answer at <name>-page.example.com)",
      "DNS record | created | *.example.com",
      "DNS record | created | poplin.example.com",
      "Worker route | not-run | *-page.example.com/*",
      `Worker route | failed | *-poplin.example.com/*: refused with status 403: 10000 Authentication error for Bearer ${TOKEN}`,
      "Worker route | not-run | poplin.example.com/*",
      "Access application | not-run | ",
      "Worker variable | not-run | ",
      "Redirect rule | not-run | ",
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
  const account = { ...emptyAccount(), refuse: `POST /accounts/${ACCOUNT}/access/apps`, refuseMessage: "access.api.error.not_enabled" };

  await withAccount(account, async (plug) => {
    const rows = shown(await plug.repair(TOKEN, SETTINGS));

    expect(rows.slice(6, 10)).toEqual([
      "Access policy | created | poplin logins",
      "Access application | failed | poplin: refused with status 403: 10000 access.api.error.not_enabled",
      "Worker variable | not-run | ",
      "Redirect rule | not-run | ",
    ]);
    expect(account.policies).toHaveLength(1);
  });
});

test("the bots setting's note names the switch that can lock the owner's own tools out, in Cloudflare's words: the page has no other place that warns of it", () => {
  const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT });

  expect(plug.guardNotes.block_bots).toContain("Bot Fight Mode, which can block the command line from cloud hosts");
});
