import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DomainReading, DomainSettings } from "@poplin/app/src/console/domain/records";
import type { Login } from "@poplin/core/src/auth/logins";
import type { HeldKey } from "../../src/zone/key/key-state";
import { createDomainPlug, giveKey } from "../../src/zone/zone-plug";
import { withFake } from "./support/fake-cloudflare";
import type { Asked } from "./support/replies";
import { ACCOUNT, type Account, answer, emptyAccount, KEY_VALUE_START, OTHER_TOKEN, TEAM, TOKEN } from "./support/fake-install";
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
    `Access application | ${state("access", usual)} | poplin: poplin.example.com, *-p-poplin.example.com`,
    `Access policy | ${state("access", usual)} | poplin logins`,
    `Access open paths | ${state("access", usual)} | poplin open paths: poplin.example.com/api, poplin.example.com/setup`,
    `Access open paths | ${state("access", usual)} | poplin open paths policy`,
    `Worker variable | ${variable} | ${variable === "missing" ? "ACCESS: written once the Access application exists" : "ACCESS"}`,
    `Key | ${state("key", usual)} | poplin kept key`,
    `Redirect rule | ${state("https", usual)} | https redirect`,
    `WAF rule | ${state("guards", usual)} | bots rule: also stops every method but GET and HEAD, and the paths *.php, /.env, /.env.*, /.git/, /wp-admin/, /cgi-bin/, /phpmyadmin`,
    `WAF rule | ${state("guards", usual)} | outside pages rule`,
    `Rate rule | ${state("rate", usual)} | rate rule`,
    `Bot settings | ${state("bots", usual)} | zone bot switches`,
    `D1 database | ${state("database", usual)} | poplin`,
    `Budget alert | ${state("alert", usual)} | poplin: usage charges reached 1 dollar`,
    `Workflow | ${state("jobs", usual)} | poplin-jobs`,
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

// Drift: a domain with a proxied wildcard of its own needs none of poplin's, and its sites answer. Shown as left out, that healthy record read as one poplin could not make.
test("a domain whose own proxied wildcard carries the site hostnames: the wildcard's row stands as present and says whose record it is", async () => {
  const account = emptyAccount();
  account.records.push({ id: "theirs", name: "*.example.com", type: "A", content: "192.0.2.1", proxied: true });

  await withAccount(account, async (plug) => {
    await plug.repair(TOKEN, SETTINGS);
    const rows = shown(await plug.check(TOKEN, SETTINGS));

    expect(rows.filter((row) => row.startsWith("DNS record"))).toEqual([
      "DNS record | present | *.example.com: the zone's own proxied wildcard record already carries the site hostnames to Cloudflare",
      "DNS record | present | poplin.example.com",
    ]);
  });
});

test("a repair makes every object, a check then finds all present, and a second repair sends no change", async () => {
  const account = emptyAccount();

  await withAccount(account, async (plug, asked) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({ all: "created", bots: "changed" }));
    expect(writes(asked)).toHaveLength(18);

    const sent = asked.length;

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(table({}));
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({}));
    expect(writes(asked.slice(sent))).toEqual([]);
  });
});

test("a repair makes the open paths, then the Access application over the whole admin hostname and the private sites, and the https rule only where the zone does not redirect by itself", async () => {
  const [plain, redirecting] = [emptyAccount(), { ...emptyAccount(), zoneRedirects: true }];

  await withAccount(plain, async (plug) => void (await plug.repair(TOKEN, SETTINGS)));
  await withAccount(redirecting, async (plug) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(table({ all: "created", bots: "changed", https: "present" }));
  });

  expect(plain.applications.map((application) => (application.destinations as { uri: string }[]).map((place) => place.uri))).toEqual([
    ["poplin.example.com/api", "poplin.example.com/setup"],
    ["poplin.example.com", "*-p-poplin.example.com"],
  ]);
  expect([Object.keys(plain.rulesets).includes("http_request_dynamic_redirect"), Object.keys(redirecting.rulesets).includes("http_request_dynamic_redirect")]).toEqual([true, false]);
});

test("a repair writes the application's audience tag and the team's domain onto the Worker and keeps every other binding: a Worker with no ACCESS lets nobody log in, and one that lost its bucket serves nothing", async () => {
  const account = emptyAccount();
  const ready = [{ text: "The login is ready. Open your dashboard and log in:", address: "https://poplin.example.com" }];

  await withAccount(account, async (plug) => {
    expect(await plug.repair(TOKEN, SETTINGS)).toMatchObject({ steps: ready });
    expect(account.bindings.map((binding) => binding.name)).toEqual(["SITES", "DB", "ZONE", "ACCESS", "KEPT_KEY"]);
    expect(account.bindings.at(-2)).toEqual({ name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications.find((application) => application.name === "poplin")?.aud } });
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
    const differs = table({}).map((row) => row.replace("Access policy | present | poplin logins", "Access policy | differs | poplin logins: emails that are not your users"));

    expect(shown(await plug.check(TOKEN, async () => added))).toEqual(differs);
    expect(writes(asked.slice(sent))).toEqual([]);

    await plug.repair(TOKEN, async () => added);

    expect(account.policies.map((policy) => policy.include)).toEqual([[{ everyone: {} }], [{ email: { email: "owner@example.com" } }, { email: { email: "second@example.com" } }]]);
  });
});

// Drift: an install made while the login stood in front of `/login` alone would keep that shape, with the rest of its dashboard open at Cloudflare, until somebody made it again by hand.
test("an install whose application covers the login path alone: the check says it differs and the open paths are missing, and one repair moves it to the whole admin hostname under its own id and audience tag", async () => {
  const account = emptyAccount();
  const guarded = (): Readonly<Record<string, unknown>> | undefined => account.applications.find((application) => application.name === "poplin");
  const rows = (application: string, open: string): string[] =>
    table({}).map((row) => row.replace("Access application | present", `Access application | ${application}`).replace("Access open paths | present", `Access open paths | ${open}`));

  await withAccount(account, async (plug, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    const earlier = ["poplin.example.com/login", "*-p-poplin.example.com"].map((uri) => ({ type: "public", uri }));
    account.applications = [{ ...guarded(), id: "app-earlier", domain: "poplin.example.com/login", destinations: earlier }];
    account.policies = account.policies.filter((policy) => policy.name === "poplin logins");
    const [id, audience, sent] = [guarded()?.id, guarded()?.aud, asked.length];

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(rows("differs", "missing"));
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual(rows("changed", "created"));
    expect(writes(asked.slice(sent))).toEqual([`POST /accounts/${ACCOUNT}/access/policies`, `POST /accounts/${ACCOUNT}/access/apps`, `PUT /accounts/${ACCOUNT}/access/apps/${String(id)}`]);
    expect([guarded()?.id, guarded()?.aud, guarded()?.domain]).toEqual([id, audience, "poplin.example.com"]);
    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(table({}));
  });
});

/** Every right the plug names, the ones an install needs and the optional ones. */
function everyRight(plug: ReturnType<typeof createDomainPlug>): string[] {
  return [...plug.tokenRights, ...plug.tokenOptional.map((entry) => entry.right)].sort();
}

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
  [/^\/accounts\/[^/]+\/alerting\/v3\/policies/, "Notifications: Edit"],
  [/^\/accounts\/[^/]+\/tokens/, "Account API Tokens: Edit"],
  [/^\/accounts\/[^/]+\/workflows/, "Workers Scripts: Edit"],
];

test("the rights the page names, needed and optional, are the rights a repair's calls use, no more and no fewer: a call added without its right is refused on every real install", async () => {
  await withAccount(emptyAccount(), async (plug, asked) => {
    await plug.repair(TOKEN, SETTINGS);
    const needed = asked.map((entry) => RIGHT_OF.find(([path]) => path.test(entry.path))?.[1] ?? `no right is known for ${entry.method} ${entry.path}`);

    expect([...new Set(needed)].sort()).toEqual(everyRight(plug));
  });
});

/** The key of each permission in a link to the token form, with its level, as Cloudflare's page "Create API token templates" lists them. A permission that page names no key for is not here. */
const KEY_OF: Readonly<Record<string, readonly [key: string, type: string]>> = {
  "Zone: Read": ["zone", "read"],
  "DNS: Edit": ["dns", "edit"],
  "Workers Routes: Edit": ["workers_routes", "edit"],
  "Access: Apps and Policies: Edit": ["access", "edit"],
  "Access: Organizations, Identity Providers, and Groups: Read": ["access_acct", "read"],
  "Workers Scripts: Edit": ["workers_scripts", "edit"],
  "Zone Settings: Read": ["zone_settings", "read"],
  "D1: Edit": ["d1", "edit"],
  "Account API Tokens: Edit": ["account_api_tokens", "edit"],
};

/** The first box of Cloudflare's token form for each permission: whether it is given on the account or on a zone. */
const SCOPE_OF: Readonly<Record<string, "Account" | "Zone">> = {
  "Zone: Read": "Zone",
  "DNS: Edit": "Zone",
  "Workers Routes: Edit": "Zone",
  "Access: Apps and Policies: Edit": "Account",
  "Access: Organizations, Identity Providers, and Groups: Read": "Account",
  "Workers Scripts: Edit": "Account",
  "Single Redirect: Edit": "Zone",
  "Zone Settings: Read": "Zone",
  "Zone WAF: Edit": "Zone",
  "Bot Management: Edit": "Zone",
  "D1: Edit": "Account",
  "Notifications: Edit": "Account",
  "Account API Tokens: Edit": "Account",
};

// Drift: the form drops a key it does not know without a word, so a needed right the link does not carry is a token that fails at a repair with nothing on the page having asked for it.
test("every right an install needs is in the link to the token form under Cloudflare's own key for it, and the four the link cannot carry are optional, each with what it adds", () => {
  const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT });
  const link = new URL(plug.tokenLink);
  const chosen = JSON.parse(link.searchParams.get("permissionGroupKeys") ?? "[]") as { key: string; type: string }[];

  expect<unknown>(chosen.map(({ key, type }) => [key, type])).toEqual(plug.tokenRights.map((right) => KEY_OF[right] ?? [`no key is documented for ${right}`]));
  expect(plug.tokenOptional.map((entry) => entry.right).sort()).toEqual(["Bot Management: Edit", "Notifications: Edit", "Single Redirect: Edit", "Zone WAF: Edit"]);
  expect([`${link.origin}${link.pathname}`, link.searchParams.get("accountId"), link.searchParams.get("zoneId"), plug.tokenLink.includes(ACCOUNT)]).toEqual(["https://dash.cloudflare.com/profile/api-tokens", "*", "all", false]);
});

// Drift: the form has three boxes for a permission and the page names each, so a row whose boxes are not Cloudflare's own scope, name, and level is a permission nobody finds on the form.
// A right the plug holds optional that the steps asked for would send every reader back to the by-hand step the link spares them.
test("the install page gives the plug's own link to the token form, and names the three boxes of every right: the needed ones in the steps' table for an empty form, and the optional ones only in the part after the steps", () => {
  const page = (...path: string[]): string => readFileSync(join(import.meta.dir, "..", "..", "..", "..", "docs", ...path), "utf8");
  const steps = `${page("start", "by-hand.md")}${page("fix", "an-install-step-fails.md")}`;
  const [, optional = ""] = page("dashboard", "domain.md").split("\n## Optional: block junk traffic and crawlers\n");
  const boxes = (text: string): string[] => [...text.matchAll(/^ *\| (Account|Zone) +\| (.+?) +\| (Edit|Read) +\|/gm)].map(([, first, second, third]) => `${first} / ${second}: ${third}`).sort();
  const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT });
  const boxed = (rights: readonly string[]): string[] => rights.map((right) => `${SCOPE_OF[right] ?? "no scope is known"} / ${right}`).sort();

  expect(boxes(steps)).toEqual(boxed(plug.tokenRights));
  expect(boxes(optional)).toEqual(boxed(plug.tokenOptional.map((entry) => entry.right)));
  expect(steps.includes(`(${plug.tokenLink})`)).toBe(true);
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

test("Access that was never switched on is no failure: both runs go on past it, mark its three rows, and hand over the one step with the address to open", async () => {
  const account = { ...emptyAccount(), accessOff: true };
  const said = ["Access application", "Access policy", "Access open paths"].map((object) => `${object} | missing | Access is off for the account`);
  const off = (states: Readonly<Record<string, string>>): string[] => {
    const rows = table(states);
    const first = rows.findIndex((row) => row.startsWith("Access "));

    return [...rows.slice(0, first), ...said, ...rows.slice(first).filter((row) => !row.startsWith("Access "))];
  };
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

test("a repair that fails half way, for another reason than a permission, stops: the rows say what was made, which change failed and why, and what was never reached, and the account holds exactly the part that was made", async () => {
  const account = { ...emptyAccount(), refuse: "POST /zones/zone-1/workers/routes", refuseAs: { status: 500, code: 10000 } };

  await withAccount(account, async (plug) => {
    expect(shown(await plug.repair(TOKEN, SETTINGS))).toEqual([
      "Public word | present | page (public sites answer at <name>-page.example.com)",
      "DNS record | created | *.example.com",
      "DNS record | created | poplin.example.com",
      "Worker route | not-run | *-page.example.com/*",
      `Worker route | failed | *-poplin.example.com/*: refused with status 500: 10000 Authentication error for Bearer ${TOKEN}`,
      "Worker route | not-run | poplin.example.com/*",
      "Access application | not-run | ",
      "Worker variable | not-run | ",
      "Key | not-run | ",
      "Redirect rule | not-run | ",
      "WAF rule | not-run | ",
      "Rate rule | not-run | ",
      "Bot settings | not-run | ",
      "D1 database | not-run | ",
      "Budget alert | not-run | ",
      "Workflow | not-run | ",
    ]);
    expect(account.records.map((record) => record.name)).toEqual(["*.example.com", "poplin.example.com"]);
    expect([account.routes, account.policies, account.applications, account.databases, account.rulesets]).toEqual([[], [], [], [], {}]);
  });
});

/** The calls Cloudflare refuses a token without each of the four optional permissions, and the rows those calls belong to. */
const OPTIONAL = {
  "Single Redirect: Edit": { calls: ["GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint"], rows: ["Redirect rule"] },
  "Zone WAF: Edit": { calls: ["GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint", "GET /zones/zone-1/rulesets/phases/http_ratelimit/entrypoint"], rows: ["WAF rule", "Rate rule"] },
  "Bot Management: Edit": { calls: ["GET /zones/zone-1/bot_management"], rows: ["Bot settings"] },
  "Notifications: Edit": { calls: [`GET /accounts/${ACCOUNT}/alerting/v3/policies`], rows: ["Budget alert"] },
} as const;

/** Each of those four permissions alone, and all four, which is the token the link alone makes. */
const lacking: readonly { readonly name: string; readonly rights: readonly (keyof typeof OPTIONAL)[] }[] = [
  ...Object.keys(OPTIONAL).map((right) => ({ name: right, rights: [right as keyof typeof OPTIONAL] })),
  { name: "all four", rights: ["Single Redirect: Edit", "Zone WAF: Edit", "Bot Management: Edit", "Notifications: Edit"] },
];

// Drift: the install page tells a person the link's nine rights are enough, so a piece that fails without an optional right, or stops the run, makes that page false for every reader who followed it.
test.each(lacking)("a repair with a token without $name fails nothing: every other object is made, the database among them, and each piece that needs the right is optional and names it", async ({ rights }) => {
  const account = { ...emptyAccount(), refuse: rights.flatMap((right) => OPTIONAL[right].calls) };
  const optional = rights.flatMap((right) => OPTIONAL[right].rows.map((object) => [object, right] as const));
  const made = table({ all: "created", bots: "changed" }).filter((row) => !optional.some(([object]) => row.startsWith(`${object} | `)));

  await withAccount(account, async (plug, asked) => {
    const reading = await plug.repair(TOKEN, SETTINGS);
    const rows = shown(reading);
    const calm = (row: string): boolean => row.includes(" | optional | ");
    const named = (found: readonly string[]): string[] => found.filter(calm).map((row) => `${row.split(" | ")[0]}: ${row.slice(row.indexOf("add this right"))}`).sort();
    const expected = optional.map(([object, right]) => `${object}: add this right to the account token and press Repair: ${right}`).sort();

    expect(named(rows)).toEqual(expected);
    expect(rows.filter((row) => !calm(row))).toEqual(made);
    expect(rows.join().includes(TOKEN)).toBe(false);
    expect(reading).toMatchObject({ steps: [{ address: "https://poplin.example.com" }] });
    expect(account.databases.length).toBe(1);

    // A check after it finds every made object present and the optional ones as they were, and a second repair sends no change.
    const sent = asked.length;
    const again = [...shown(await plug.check(TOKEN, SETTINGS)), ...shown(await plug.repair(TOKEN, SETTINGS))];

    expect([...new Set(again.map((row) => row.split(" | ")[1]))].sort()).toEqual(["optional", "present"]);
    expect(named(again)).toEqual([...expected, ...expected].sort());
    expect(writes(asked.slice(sent))).toEqual([]);
  });
});

// Drift: a token may read the rules and not change them, so a rule never reached behind an optional refusal used to stay not run, with no word of the right, and count as work left over.
test("a token that may read the guard rules and not make them leaves both rules optional, each naming the right, and the run goes on", async () => {
  const account = { ...emptyAccount(), refuse: "POST /zones/zone-1/rulesets" };

  await withAccount(account, async (plug) => {
    const rows = shown(await plug.repair(TOKEN, SETTINGS));
    const guards = rows.filter((row) => row.startsWith("WAF rule | ") || row.startsWith("Rate rule | ") || row.startsWith("Redirect rule | "));

    expect(guards.map((row) => row.split(" | ")[1])).toEqual(["optional", "optional", "optional", "optional"]);
    expect(guards.filter((row) => !row.includes("add this right to the account token and press Repair: "))).toEqual([]);
    expect(rows.slice(-3)).toEqual(["D1 database | created | poplin", "Budget alert | created | poplin: usage charges reached 1 dollar", "Workflow | created | poplin-jobs"]);
  });
});

// Drift: a row that is optional is a promise that nothing is wrong, so it may stand only for a refusal that is a missing permission and nothing else.
test.each([
  { name: "a failure of Cloudflare's own", refuseAs: { status: 500, code: 10000 } },
  { name: "a refusal for another reason than a permission", refuseAs: { status: 403, code: 9109 } },
])("$name on a piece that needs an optional right is a failed row, never an optional one", async ({ refuseAs }) => {
  const account = { ...emptyAccount(), refuse: OPTIONAL["Zone WAF: Edit"].calls[0], refuseAs };

  await withAccount(account, async (plug) => {
    const states = shown(await plug.repair(TOKEN, SETTINGS)).filter((row) => row.startsWith("WAF rule | ")).map((row) => row.split(" | ")[1]);

    expect(states).toEqual(["failed"]);
  });
});

/** The pieces others build on, by the call a token without their permission is refused, and what a repair still makes after each. */
const built: readonly { readonly name: string; readonly call: string; readonly failed: string; readonly made: readonly string[] }[] = [
  { name: "the records", call: "GET /zones/zone-1/dns_records", failed: "DNS record", made: [] },
  { name: "the login", call: `GET /accounts/${ACCOUNT}/access/policies`, failed: "Access application", made: ["Redirect rule", "WAF rule", "Rate rule", "Bot settings", "D1 database", "Budget alert", "Workflow"] },
];

// Drift: the records say whether a hostname is somebody else's, so nothing may follow a zone that was not read, and a Worker given its domain with no login behind it is half an install.
test.each(built)("a repair with a token that may not read $name makes nothing that builds on them: the row names the right, and every piece that needs them is not run", async ({ call, failed, made }) => {
  const account = { ...emptyAccount(), refuse: call };
  const pieces = ["DNS record", "Worker route", "Access application", "Worker variable", "Redirect rule", "WAF rule", "Rate rule", "Bot settings", "D1 database", "Budget alert", "Workflow"];

  await withAccount(account, async (plug, asked) => {
    const rows = shown(await plug.repair(TOKEN, SETTINGS));
    const stateOf = (object: string): string => [...new Set(rows.filter((row) => row.startsWith(`${object} | `)).map((row) => row.split(" | ")[1] ?? ""))].join();
    const after = pieces.slice(pieces.indexOf(failed) + 1);

    expect([stateOf(failed), rows.filter((row) => row.includes("Add this right")).length]).toEqual(["failed", 1]);
    expect(after.filter((object) => stateOf(object) !== "not-run")).toEqual([...made]);
    expect(made.map(stateOf).filter((state) => state !== "created" && state !== "changed")).toEqual([]);
    expect(writes(asked).filter((write) => write.includes("/workers/scripts/"))).toEqual([]);
  });
});

/** One call a check makes with each permission but Zone: Read, which the list of zones needs: without that one no row is read at all. */
const NEEDS: readonly (readonly [right: string, call: string])[] = [
  ["DNS: Edit", "GET /zones/zone-1/dns_records"],
  ["Workers Routes: Edit", "GET /zones/zone-1/workers/routes"],
  ["Access: Apps and Policies: Edit", `GET /accounts/${ACCOUNT}/access/policies`],
  ["Access: Organizations, Identity Providers, and Groups: Read", `GET /accounts/${ACCOUNT}/access/organizations`],
  ["Workers Scripts: Edit", `GET /accounts/${ACCOUNT}/workers/scripts/poplin/settings`],
  ["Zone Settings: Read", "GET /zones/zone-1/settings/always_use_https"],
  ["Single Redirect: Edit", "GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint"],
  ["Zone WAF: Edit", "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint"],
  ["Bot Management: Edit", "GET /zones/zone-1/bot_management"],
  ["D1: Edit", `GET /accounts/${ACCOUNT}/d1/database`],
  ["Notifications: Edit", `GET /accounts/${ACCOUNT}/alerting/v3/policies`],
  ["Account API Tokens: Edit", `GET /accounts/${ACCOUNT}/tokens`],
  ["Workers Scripts: Edit", `GET /accounts/${ACCOUNT}/workflows`],
];

// Drift: a refused row used to quote Cloudflare's status alone, and the person had to guess which of eleven rows their token lacked.
test.each(NEEDS)("a token without %s gets one row that names that right in the words of the token form: failed for a right an install needs, optional for one it works without", async (right, call) => {
  const account = emptyAccount();

  await withAccount(account, async (plug) => {
    await plug.repair(TOKEN, SETTINGS);
    account.refuse = call;
    const naming = shown(await plug.check(TOKEN, SETTINGS)).filter((row) => row.includes("dd this right"));
    const needed = plug.tokenRights.includes(right);

    expect(naming.map((row) => row.split(" | ")[1])).toEqual([needed ? "failed" : "optional"]);
    expect(naming.map((row) => row.slice(row.indexOf("dd this right")))).toEqual([needed ? `dd this right to the account token: ${right}` : `dd this right to the account token and press Repair: ${right}`]);
  });
});

test("the rows of that table and the list of zones are every right the plug names: a right with no row here is one no refusal names", () => {
  const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT });

  expect([...new Set(["Zone: Read", ...NEEDS.map(([right]) => right)])].sort()).toEqual(everyRight(plug));
});

const otherwise: readonly { readonly name: string; readonly refused: Partial<Account> }[] = [
  { name: "a failure of Cloudflare's own", refused: { refuseAs: { status: 500, code: 10000 } } },
  { name: "a refusal for another reason than a permission", refused: { refuseAs: { status: 403, code: 9109 } } },
  { name: "an account whose Access is off, met after a step was made", refused: { refuseMessage: "access.api.error.not_enabled" } },
];

// Drift: a row that names a right for a failure no right mends sends the person to edit a token that was never the cause.
test.each(otherwise)("$name fails its row and names no right", async ({ refused }) => {
  const account = { ...emptyAccount(), refuse: `POST /accounts/${ACCOUNT}/access/apps`, ...refused };

  await withAccount(account, async (plug) => {
    const failed = shown(await plug.repair(TOKEN, SETTINGS)).filter((row) => row.includes(" | failed | "));

    expect([failed.length, failed.join().includes("Add this right")]).toEqual([1, false]);
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

test("Access refused as not switched on after the policy was already made is a stopped repair: the made row stays in the table", async () => {
  const account = { ...emptyAccount(), refuse: `POST /accounts/${ACCOUNT}/access/apps`, refuseMessage: "access.api.error.not_enabled" };

  await withAccount(account, async (plug) => {
    const rows = shown(await plug.repair(TOKEN, SETTINGS));

    expect(rows.slice(6, 13)).toEqual([
      "Access application | not-run | poplin: poplin.example.com, *-p-poplin.example.com",
      "Access policy | not-run | poplin logins",
      "Access open paths | created | poplin open paths policy",
      "Access open paths | failed | poplin open paths: refused with status 403: 10000 access.api.error.not_enabled",
      "Worker variable | not-run | ",
      "Key | not-run | ",
      "Redirect rule | not-run | ",
    ]);
    expect(account.policies).toHaveLength(1);
  });
});

// Drift: the install remembers each row by what its object is for, and raises "private sites may be locked" for the login's alone. An Access row filed under the rest would turn that alarm into "a piece is missing".
// The open paths are what the API answers through, as a route is: without them a program meets a login.
test("every row says what its object is for, and a row refused for a missing right carries the right's name beside its sentence", async () => {
  const account = emptyAccount();

  await withAccount(account, async (plug) => {
    const made = await plug.repair(TOKEN, SETTINGS);
    account.refuse = "GET /zones/zone-1/workers/routes";
    const checked = await plug.check(TOKEN, SETTINGS);
    const rows = [made, checked].flatMap((reading) => (reading.ok ? reading.rows : []));

    const objectsOf = (part: string): string[] => [...new Set(rows.filter((row) => row.part === part).map((row) => row.object))];

    expect([objectsOf("login"), objectsOf("reach")]).toEqual([
      ["Access application", "Access policy", "Worker variable"],
      ["DNS record", "Worker route", "Access open paths"],
    ]);
    expect(rows.filter((row) => row.right !== undefined).map((row) => [row.object, row.state, row.right])).toEqual([["Worker route", "failed", "Workers Routes: Edit"]]);
  });
});

/** The key as a Worker holds it, by what Cloudflare says of it. One that works names its token by id, as a token that verifies itself does. */
const HELD = {
  works: { has: () => true, verify: async () => ({ ok: true, value: { id: "held-key" } }) },
  none: { has: () => false, verify: async () => ({ ok: false, refusal: "no_key" }) },
  refused: { has: () => true, verify: async () => ({ ok: false, refusal: "key_refused" }) },
  silent: { has: () => true, verify: async () => ({ ok: false, refusal: "unreachable" }) },
} as const satisfies Readonly<Record<string, HeldKey>>;

/** An older key of the install as Cloudflare lists it. */
const OLD_KEY = { id: "old-key", name: "poplin kept key", status: "active" };

/** The install's account and its zone, as a key made for the install names them. */
const OWN = { account: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, zone: { "com.cloudflare.api.account.zone.zone-1": "*" } };

/** Every permission group of one scope that the account lists, as a token's policy names them. */
function groupsOf(scope: string): { id: unknown }[] {
  return emptyAccount().groups.flatMap((group) => ((group.scopes as string[]).includes(scope) ? [{ id: group.id }] : []));
}

/** The policies of a key that carries every right: the account's groups allowed on `account`, the zone's on `zone`, each a resource as Cloudflare lists one. */
function policiesOn(account: Record<string, unknown>, zone: Record<string, unknown>): { effect: string; permission_groups: { id: unknown }[]; resources: Record<string, unknown> }[] {
  return [
    { effect: "allow", permission_groups: groupsOf("com.cloudflare.api.account"), resources: account },
    { effect: "allow", permission_groups: groupsOf("com.cloudflare.api.account.zone"), resources: zone },
  ];
}

/** The key the Worker holds, as Cloudflare lists it with every right on the install's account and zone. */
const WHOLE_KEY = { ...OLD_KEY, id: "held-key", policies: policiesOn(OWN.account, OWN.zone) };

/** The key the Worker holds, made before poplin could update itself: it lacks the right to write a Worker. */
const EARLY_KEY = { ...WHOLE_KEY, policies: WHOLE_KEY.policies.map((policy) => ({ ...policy, permission_groups: policy.permission_groups.filter(({ id }) => !String(id).startsWith("Workers Scripts Write")) })) };

/** A whole key of the name that no Worker holds: one a failed write left at Cloudflare. */
const SPARE_KEY = { ...WHOLE_KEY, id: "spare-key" };

/** The Worker's bindings once a key was written onto it, as a person's token reads them. */
const KEY_BOUND = [...emptyAccount().bindings, { name: "KEPT_KEY", type: "secret_text" }];

/** The row of a key that works and lacks a right, in any way a key can lack one. */
const LACKS = "Key | differs | poplin kept key: the key the install holds lacks a right the install uses now";

/** The one call that writes the Worker's settings. */
const SETTINGS_WRITE = `PATCH /accounts/${ACCOUNT}/workers/scripts/poplin/settings`;

/** Where the account's own tokens are. */
const TOKENS = `/accounts/${ACCOUNT}/tokens`;

/** One run that has to do with the key: the account it meets, the key the Worker holds, and what the key's row, the steps, and the account say after it. */
interface KeyRun {
  readonly name: string;
  readonly run: "check" | "repair" | "give";
  readonly account?: Partial<Account>;
  readonly held?: keyof typeof HELD;
  readonly row: string;
  readonly right?: string;
  readonly step?: string;
  readonly keys: number;
  readonly secrets: number;
}

const keyRuns: readonly KeyRun[] = [
  { name: "a check on a Worker whose key works", run: "check", held: "works", row: "Key | present | poplin kept key", keys: 0, secrets: 0 },
  { name: "a check on a Worker with no key", run: "check", held: "none", row: "Key | missing | poplin kept key", keys: 0, secrets: 0 },
  { name: "a check on a Worker whose key Cloudflare refuses", run: "check", held: "refused", account: { tokens: [OLD_KEY] }, row: "Key | differs | poplin kept key: Cloudflare no longer takes the key the install holds", keys: 1, secrets: 0 },
  { name: "a check on a Worker that gets no answer about its key", run: "check", held: "silent", row: "Key | failed | poplin kept key: no answer from Cloudflare", keys: 0, secrets: 0 },
  { name: "a repair on a Worker whose key works makes none", run: "repair", held: "works", row: "Key | present | poplin kept key", keys: 0, secrets: 0 },
  { name: "a repair on a Worker with no key makes one", run: "repair", held: "none", row: "Key | created | poplin kept key", keys: 1, secrets: 1 },
  { name: "a repair on a Worker whose key Cloudflare refuses makes a new one and deletes the old", run: "repair", held: "refused", account: { tokens: [OLD_KEY] }, row: "Key | changed | poplin kept key", keys: 1, secrets: 1 },
  { name: "a repair on a Worker that gets no answer about its key makes none: a key that may still work is not replaced", run: "repair", held: "silent", row: "Key | failed | poplin kept key: no answer from Cloudflare", keys: 0, secrets: 0 },
  {
    name: "a check on a Worker whose key works and was made before a right was added",
    run: "check",
    held: "works",
    account: { tokens: [EARLY_KEY] },
    row: LACKS,
    keys: 1,
    secrets: 0,
  },
  {
    name: "a repair on a Worker whose key works, where Cloudflare lists no group for a right: the key is not called whole, and is left",
    run: "repair",
    held: "works",
    account: { tokens: [EARLY_KEY], groups: emptyAccount().groups.filter((group) => group.name !== "Bot Management Read") },
    row: "Key | failed | poplin kept key: Cloudflare lists no permission group named Bot Management Read",
    keys: 1,
    secrets: 0,
  },
  { name: "a repair on a Worker whose key works and was made before a right was added makes a new one and deletes the old", run: "repair", held: "works", account: { tokens: [EARLY_KEY] }, row: "Key | changed | poplin kept key", keys: 1, secrets: 1 },
  {
    name: "a check on a Worker whose key carries the zone's rights on another zone alone",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn(OWN.account, { "com.cloudflare.api.account.zone.zone-2": "*" }) }] },
    row: LACKS,
    keys: 1,
    secrets: 0,
  },
  {
    name: "a check on a Worker whose key carries every right in policies that deny",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: WHOLE_KEY.policies.map((policy) => ({ ...policy, effect: "deny" })) }] },
    row: LACKS,
    keys: 1,
    secrets: 0,
  },
  {
    name: "a check on a Worker whose key carries the account's rights on one Worker of the account alone",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn({ [`com.cloudflare.api.account.${ACCOUNT}`]: { "com.cloudflare.edge.worker.script.poplin": "*" } }, OWN.zone) }] },
    row: LACKS,
    keys: 1,
    secrets: 0,
  },
  {
    name: "a check on a Worker whose key carries every right on every account, and on every zone of the install's account",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn({ "com.cloudflare.api.account.*": "*" }, { [`com.cloudflare.api.account.${ACCOUNT}`]: { "com.cloudflare.api.account.zone.*": "*" } }) }] },
    row: "Key | present | poplin kept key",
    keys: 1,
    secrets: 0,
  },
  {
    name: "a check on a Worker whose key carries the zone's rights on every zone",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn(OWN.account, { "com.cloudflare.api.account.zone.*": "*" }) }] },
    row: "Key | present | poplin kept key",
    keys: 1,
    secrets: 0,
  },
  {
    name: "a repair on a Worker whose key lacks a right, beside a whole key a failed write left: the Worker holds the first, so a new one is made and both go",
    run: "repair",
    held: "works",
    account: { tokens: [EARLY_KEY, SPARE_KEY] },
    row: "Key | changed | poplin kept key",
    keys: 1,
    secrets: 1,
  },
  {
    name: "a check on a Worker whose key is whole, beside a key of the name it does not hold",
    run: "check",
    held: "works",
    account: { tokens: [WHOLE_KEY, SPARE_KEY] },
    row: "Key | differs | poplin kept key: a key of its name that the install does not hold is at Cloudflare",
    keys: 2,
    secrets: 0,
  },
  {
    name: "a repair on a Worker whose key is whole, beside a key of the name it does not hold: that one is deleted, and no key is made",
    run: "repair",
    held: "works",
    account: { tokens: [WHOLE_KEY, SPARE_KEY] },
    row: "Key | changed | poplin kept key: a key of its name that the install does not hold was deleted",
    keys: 1,
    secrets: 0,
  },
  {
    name: "a repair on a Worker whose key is whole, beside an ended key of the name, which Cloudflare lists only when asked for the expired: that one is deleted too",
    run: "repair",
    held: "works",
    account: { tokens: [WHOLE_KEY, { ...SPARE_KEY, status: "expired" }] },
    row: "Key | changed | poplin kept key: a key of its name that the install does not hold was deleted",
    keys: 1,
    secrets: 0,
  },
  {
    name: "a repair that cannot delete a key the install does not hold: the key it holds stands, and a step names what is left",
    run: "repair",
    held: "works",
    account: { tokens: [WHOLE_KEY, SPARE_KEY], refuse: `DELETE ${TOKENS}/spare-key` },
    row: "Key | present | poplin kept key",
    step: "A key named poplin kept key that the install does not hold could not be deleted at Cloudflare. Press Repair again. The keys are listed there:",
    keys: 2,
    secrets: 0,
  },
  {
    name: "a check with a person's token alone, where one of the two active keys lacks a right: which one the Worker holds cannot be known",
    run: "check",
    account: { bindings: KEY_BOUND, tokens: [EARLY_KEY, SPARE_KEY] },
    row: LACKS,
    keys: 2,
    secrets: 0,
  },
  { name: "a repair on a Worker whose key works and carries every right makes none", run: "repair", held: "works", account: { tokens: [WHOLE_KEY] }, row: "Key | present | poplin kept key", keys: 1, secrets: 0 },
  {
    name: "a repair with a token that may not make a token: the row names the right, and everything else is made",
    run: "repair",
    account: { refuse: `GET ${TOKENS}/permission_groups` },
    row: "Key | failed | poplin kept key: refused with status 403: 10000 Authentication error. Add this right to the account token: Account API Tokens: Edit",
    right: "Account API Tokens: Edit",
    keys: 0,
    secrets: 0,
  },
  {
    name: "a repair whose list of groups lacks a right's name: the row names it",
    run: "repair",
    account: { groups: emptyAccount().groups.filter((group) => group.name !== "Bot Management Read") },
    row: "Key | failed | poplin kept key: Cloudflare lists no permission group named Bot Management Read",
    keys: 0,
    secrets: 0,
  },
  {
    name: "a repair whose write of the Worker's settings is refused, quoting what was sent: the new key is deleted, and no row quotes it",
    run: "repair",
    account: { refuse: SETTINGS_WRITE, refuseQuotes: true, refuseAs: { status: 400, code: 10021 } },
    row: "Key | failed | poplin kept key, made, and deleted again when its write onto the Worker failed: refused with status 400: 10021 Authentication error",
    keys: 0,
    secrets: 1,
  },
  {
    name: "a repair whose write fails and whose new key Cloudflare will not delete: the row says the key is left",
    run: "repair",
    account: { refuse: [SETTINGS_WRITE, `DELETE ${TOKENS}/*`], refuseAs: { status: 400, code: 1 } },
    row: "Key | failed | poplin kept key, made, and left at Cloudflare for you to delete when its write onto the Worker failed: refused with status 400: 1 Authentication error",
    keys: 1,
    secrets: 1,
  },
  {
    name: "a repair that cannot delete the older key: the new one is kept, and a step names what is left",
    run: "repair",
    held: "refused",
    account: { tokens: [OLD_KEY], refuse: `DELETE ${TOKENS}/old-key` },
    row: "Key | changed | poplin kept key",
    step: "An older key named poplin kept key may still be at Cloudflare. Delete it there:",
    keys: 2,
    secrets: 1,
  },
  { name: "giving a key to a Worker with none", run: "give", held: "none", row: "Key | created | poplin kept key", keys: 1, secrets: 1 },
  { name: "giving a key to a Worker that holds one replaces it", run: "give", held: "works", account: { tokens: [OLD_KEY] }, row: "Key | changed | poplin kept key", keys: 1, secrets: 1 },
  {
    name: "giving a key with a token that may not make one",
    run: "give",
    held: "none",
    account: { refuse: `POST ${TOKENS}` },
    row: "Key | failed | poplin kept key: refused with status 403: 10000 Authentication error. Add this right to the account token: Account API Tokens: Edit",
    right: "Account API Tokens: Edit",
    keys: 0,
    secrets: 0,
  },
  {
    name: "giving a key with a token that may not write the Worker: the new key is deleted, and the row names that right",
    run: "give",
    held: "none",
    account: { refuse: SETTINGS_WRITE, refuseQuotes: true },
    row: "Key | failed | poplin kept key, made, and deleted again when its write onto the Worker failed: refused with status 403: 10000 Authentication error. Add this right to the account token: Workers Scripts: Edit",
    right: "Workers Scripts: Edit",
    keys: 0,
    secrets: 1,
  },
];

describe("the key an install keeps", () => {
  let logs: Mock<(...said: unknown[]) => void>[] = [];

  beforeEach(() => {
    logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level).mockImplementation(() => undefined));
  });

  afterEach(() => {
    for (const log of logs) log.mockRestore();
  });

  // Drift: the key is the one credential an install keeps. A run that made a second one, left one nothing holds, or said its value anywhere would do so on every install.
  test.each(keyRuns)("$name", async ({ run, account = {}, held, row, right, step, keys, secrets }) => {
    const met = { ...emptyAccount(), ...account };
    const key = held === undefined ? undefined : HELD[held];

    await withFake(
      (asked) => answer(met, asked),
      async (connection, asked) => {
        const parts = { accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl, key };
        const reading = run === "give" ? await giveKey(parts, TOKEN) : await createDomainPlug(parts)[run](TOKEN, SETTINGS);
        const rows = reading.ok ? reading.rows.filter((found) => found.object === "Key") : [];
        const written = asked.filter((entry) => entry.method === "PATCH").map((entry) => (entry.body as { settings: { bindings: { name: string; type: string; text?: string }[] } }).settings.bindings);
        const secret = written.flatMap((bindings) => bindings.filter((binding) => binding.type === "secret_text").map((binding) => [binding.name, binding.text?.startsWith(KEY_VALUE_START)]));
        const said = [JSON.stringify(reading), Bun.inspect(reading), ...logs.flatMap((log) => log.mock.calls.map((call) => Bun.inspect(call)))].join("\n");
        // What the fake's refusal quotes of the call is left out of the compared row: the token it was sent with, and where it quotes them the bindings.
        const plain = (detail: string): string => detail.replace(/ for Bearer .*?(\. Add this right|$)/, "$1");

        expect(rows.map((found) => `${found.object} | ${found.state} | ${plain(found.detail)}`)).toEqual([row]);
        expect(rows.map((found) => [found.part, found.right])).toEqual([["rest", right]]);
        expect(reading.ok ? reading.steps.filter((found) => found.text.includes("key")) : []).toEqual(step === undefined ? [] : [{ text: step, address: `https://dash.cloudflare.com/${ACCOUNT}/api-tokens` }]);
        // A key that was made is the only one of its name left, and it went onto the Worker in a change that holds one secret.
        expect([met.tokens.length, secret]).toEqual([keys, Array.from({ length: secrets }, () => ["KEPT_KEY", true])]);
        expect([said.includes(KEY_VALUE_START), logs.flatMap((log) => log.mock.calls)]).toEqual([false, []]);
        expect(run !== "give" || (reading.ok && reading.rows.length === 1 && writes(asked).every((write) => write.includes("/tokens") || write === SETTINGS_WRITE))).toBe(true);
      },
    );
  });

  // Drift: a token made from an older link has no right to make a key. An install whose login waited on the key would not start for it.
  test("a repair with a token that may not make a key still writes the Worker's variables, with no key among them, and goes on to every other piece", async () => {
    const account = { ...emptyAccount(), refuse: `GET ${TOKENS}/permission_groups` };

    await withAccount(account, async (plug) => {
      const rows = shown(await plug.repair(TOKEN, SETTINGS));

      expect(account.bindings.map((binding) => binding.name)).toEqual(["SITES", "DB", "ZONE", "ACCESS"]);
      expect(rows.filter((row) => !row.startsWith("Key | "))).toEqual(table({ all: "created", bots: "changed" }).filter((row) => !row.startsWith("Key | ")));
    });
  });

  // Drift: a key Cloudflare never reads back cannot be compared, so a later change must name it as kept; sent again it would need a value nobody has.
  test("a later repair that changes a variable names the key as inherited, like every other binding, and makes no new one", async () => {
    const account = emptyAccount();

    await withAccount(account, async (plug, asked) => {
      await plug.repair(TOKEN, SETTINGS);
      account.bindings = account.bindings.filter((binding) => binding.name !== "ACCESS");
      const sent = asked.length;
      const rows = shown(await plug.repair(TOKEN, SETTINGS));
      const changes = asked.slice(sent).filter((entry) => entry.method === "PATCH").map((entry) => (entry.body as { settings: { bindings: { name: string; type: string }[] } }).settings.bindings);

      expect(rows.filter((row) => row.startsWith("Key") || row.startsWith("Worker variable"))).toEqual(["Worker variable | created | ACCESS", "Key | present | poplin kept key"]);
      expect(changes.map((bindings) => bindings.map((binding) => `${binding.name} ${binding.type}`))).toEqual([["SITES inherit", "DB inherit", "ZONE inherit", "KEPT_KEY inherit", "ACCESS json"]]);
      expect([account.tokens.length, writes(asked.slice(sent))]).toEqual([1, [SETTINGS_WRITE]]);
    });
  });

  // Drift: the Worker's secret says a key was written, not that it still works. A key deleted at Cloudflare would read as present for ever.
  test("with no key in hand, a key is present only while the Worker has the secret and Cloudflare lists an active token of its name", async () => {
    const account = emptyAccount();
    const keyRow = async (plug: ReturnType<typeof createDomainPlug>): Promise<string[]> => shown(await plug.check(TOKEN, SETTINGS)).filter((row) => row.startsWith("Key"));

    await withAccount(account, async (plug) => {
      await plug.repair(TOKEN, SETTINGS);
      const made = await keyRow(plug);
      account.tokens = account.tokens.map((token) => ({ ...token, status: "disabled" }));
      const disabled = await keyRow(plug);
      account.tokens = [];
      const deleted = await keyRow(plug);
      account.bindings = account.bindings.filter((binding) => binding.name !== "KEPT_KEY");

      expect([made, disabled, deleted, await keyRow(plug)]).toEqual([
        ["Key | present | poplin kept key"],
        ["Key | differs | poplin kept key: Cloudflare no longer takes the key the install holds"],
        ["Key | differs | poplin kept key: Cloudflare no longer takes the key the install holds"],
        ["Key | missing | poplin kept key"],
      ]);
    });
  });

  test("a token that does not prove itself is given nothing: no key is made with it, and it is refused as a check refuses it", async () => {
    await withFake(
      (asked) => answer(emptyAccount(), asked),
      async (connection, asked) => {
        const parts = { accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl, key: HELD.none };

        expect([await giveKey(parts, "short"), await giveKey(parts, OTHER_TOKEN)]).toEqual([REFUSED, REFUSED]);
        expect([...new Set(asked.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`))]).toEqual(["GET /zones"]);
      },
    );
  });
});
