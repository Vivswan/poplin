import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DomainReading, DomainRow, DomainSettings } from "@poplin/app/src/console/domain/records";
import type { Login } from "@poplin/core/src/auth/logins";
import { readUploadKey } from "../../src/shared/install/key/upload-key";
import type { HeldKey } from "../../src/shared/install/key/key-state";
import { commandRows, createDomainPlug, giveKey, tokenFacts } from "../../src/with-domain/zone-plug";
import { withFake } from "../shared/install/support/fake-cloudflare";
import type { Asked } from "../shared/install/support/replies";
import { ACCOUNT, type Account, answer, emptyAccount, KEPT, KEY_VALUE_START, OTHER_TOKEN, TEAM, TOKEN } from "../shared/install/support/fake-install";
import { LAYOUT, layoutOf } from "../shared/install/support/layouts";

const STORED: DomainSettings = { users: ["owner@example.com" as Login], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto", provider_logs: true };
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
    `Access application | ${state("access", usual)} | poplin open paths: poplin.example.com/api`,
    `Access policy | ${state("access", usual)} | poplin open paths policy`,
    `Worker variable | ${variable} | ${variable === "missing" ? "ACCESS: written once the Access application exists" : "ACCESS"}`,
    `Key | ${state("key", usual)} | poplin kept key`,
    `Upload key | ${state("upload", state("key", usual))} | poplin upload key`,
    `Worker logs | ${states.logs ?? "present"} | enabled`,
    `Redirect rule | ${state("https", usual)} | https redirect`,
    `WAF rule | ${state("guards", usual)} | bots rule: also stops every method but GET and HEAD, and the paths *.php, /.env, /.env.*, /.git/, /wp-admin/, /cgi-bin/, /phpmyadmin`,
    `WAF rule | ${state("guards", usual)} | outside pages rule`,
    `Rate rule | ${state("rate", usual)} | rate rule`,
    `Bot settings | ${state("bots", usual)} | zone bot switches`,
    `D1 database | ${state("database", usual)} | poplin`,
    `Budget alert | ${state("alert", usual)} | poplin: usage charges reached 1 dollar`,
    `Certificate alert | ${state("alert", usual)} | poplin: certificates of every domain of the account`,
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
    expect(writes(asked)).toHaveLength(20);

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
    ["poplin.example.com/api"],
    ["poplin.example.com", "*-p-poplin.example.com"],
  ]);
  expect([Object.keys(plain.rulesets).includes("http_request_dynamic_redirect"), Object.keys(redirecting.rulesets).includes("http_request_dynamic_redirect")]).toEqual([true, false]);
});

test("a repair writes the application's audience tag and the team's domain onto the Worker and keeps every other binding: a Worker with no ACCESS lets nobody log in, and one that lost its bucket serves nothing", async () => {
  const account = emptyAccount();
  const ready = [{ text: "The login is ready. Open your dashboard and log in:", address: "https://poplin.example.com" }];

  await withAccount(account, async (plug) => {
    expect(await plug.repair(TOKEN, SETTINGS)).toMatchObject({ steps: ready });
    expect(account.bindings.map((binding) => binding.name)).toEqual(["WORKER_NAME", "SITES", "DB", "ZONE", "ACCESS", "KEPT_KEY", "UPLOAD_KEY"]);
    expect(account.bindings.at(-3)).toEqual({ name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications.find((application) => application.name === "poplin")?.aud } });
    expect(await plug.repair(TOKEN, SETTINGS)).toMatchObject({ steps: [] });

    account.bindings = account.bindings.map((binding) => (binding.name === "ACCESS" ? { ...binding, json: JSON.stringify({ team_domain: TEAM, audience: "f".repeat(64) }) } : binding));

    expect(shown(await plug.check(TOKEN, SETTINGS))).toEqual(table({ variable: "differs" }));
  });
});

test("a login added to the settings: the check says the Access policy lets other emails through, and the repair lets the new one in, so a person added in Settings is not stopped at Cloudflare's login", async () => {
  const account = emptyAccount();
  const added: DomainSettings = { ...STORED, users: [...STORED.users, "second@example.com" as Login] };

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
    table({}).map((row) => (row.includes("poplin open paths") ? row.replace("| present |", `| ${open} |`) : row.replace("Access application | present", `Access application | ${application}`)));

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
  "Workers R2 Storage: Edit": "Account",
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
  const page = (...path: string[]): string => readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "docs", ...path), "utf8");
  const steps = `${page("start", "install.md")}${page("fix", "an-install-step-fails.md")}`;
  const [, optional = ""] = page("dashboard", "domain.md").split("\n## Optional: block junk traffic and crawlers\n");
  const boxes = (text: string): string[] => [...text.matchAll(/^ *\| (Account|Zone) +\| (.+?) +\| (Edit|Read) +\|/gm)].map(([, first, second, third]) => `${first} / ${second}: ${third}`).sort();
  const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT });
  const boxed = (rights: readonly string[]): string[] => rights.map((right) => `${SCOPE_OF[right] ?? "no scope is known"} / ${right}`).sort();

  expect(boxes(steps)).toEqual(boxed(tokenFacts("domain", ["R2 bucket"]).tokenRights));
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
  // The open paths are named as the application they are, so their row says which one it is of.
  const said = ["Access application | missing | Access is off for the account", "Access policy | missing | Access is off for the account", "Access application | missing | poplin open paths: Access is off for the account"];
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
      "Worker route | failed | *-poplin.example.com/*: refused with status 500 and codes 10000",
      "Worker route | not-run | poplin.example.com/*",
      "Access application | not-run | ",
      "Worker variable | not-run | ",
      "Key | not-run | ",
      "Upload key | not-run | ",
      "Worker logs | not-run | ",
      "Redirect rule | not-run | ",
      "WAF rule | not-run | ",
      "Rate rule | not-run | ",
      "Bot settings | not-run | ",
      "D1 database | not-run | ",
      "Budget alert | not-run | ",
      "Certificate alert | not-run | ",
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
  "Notifications: Edit": { calls: [`GET /accounts/${ACCOUNT}/alerting/v3/policies`], rows: ["Budget alert", "Certificate alert"] },
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
    const named = (found: readonly string[]): string[] => found.filter(calm).map((row) => `${row.split(" | ")[0]}: ${row.slice(row.indexOf("add this permission"))}`).sort();
    const expected = optional.map(([object, right]) => `${object}: add this permission to the account token and press Repair: ${right}`).sort();

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
    expect(guards.filter((row) => !row.includes("add this permission to the account token and press Repair: "))).toEqual([]);
    expect(rows.slice(-4)).toEqual([
      "D1 database | created | poplin",
      "Budget alert | created | poplin: usage charges reached 1 dollar",
      "Certificate alert | created | poplin: certificates of every domain of the account",
      "Workflow | created | poplin-jobs",
    ]);
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
  { name: "the login", call: `GET /accounts/${ACCOUNT}/access/policies`, failed: "Access application", made: ["Redirect rule", "WAF rule", "Rate rule", "Bot settings", "D1 database", "Budget alert", "Certificate alert", "Workflow"] },
];

// Drift: the records say whether a hostname is somebody else's, so nothing may follow a zone that was not read, and a Worker given its domain with no login behind it is half an install.
test.each(built)("a repair with a token that may not read $name makes nothing that builds on them: the row names the right, and every piece that needs them is not run", async ({ call, failed, made }) => {
  const account = { ...emptyAccount(), refuse: call };
  const pieces = ["DNS record", "Worker route", "Access application", "Worker variable", "Redirect rule", "WAF rule", "Rate rule", "Bot settings", "D1 database", "Budget alert", "Certificate alert", "Workflow"];

  await withAccount(account, async (plug, asked) => {
    const rows = shown(await plug.repair(TOKEN, SETTINGS));
    const stateOf = (object: string): string => [...new Set(rows.filter((row) => row.startsWith(`${object} | `)).map((row) => row.split(" | ")[1] ?? ""))].join();
    const after = pieces.slice(pieces.indexOf(failed) + 1);

    expect([stateOf(failed), rows.filter((row) => row.includes("Add this permission")).length]).toEqual(["failed", 1]);
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
test.each(NEEDS)("a token without %s gets a row that names that right in the words of the token form, one a key for the right both keys are read with: failed for a right an install needs, optional for one it works without", async (right, call) => {
  const account = emptyAccount();

  await withAccount(account, async (plug) => {
    await plug.repair(TOKEN, SETTINGS);
    account.refuse = call;
    const naming = shown(await plug.check(TOKEN, SETTINGS)).filter((row) => row.includes("dd this permission"));
    const needed = plug.tokenRights.includes(right);
    // Two rows are read under one right: the two keys under the tokens', the two alerts under the notifications'.
    const rows = right === "Account API Tokens: Edit" || right === "Notifications: Edit" ? 2 : 1;

    expect(naming.map((row) => row.split(" | ")[1])).toEqual(Array.from({ length: rows }, () => (needed ? "failed" : "optional")));
    expect([...new Set(naming.map((row) => row.slice(row.indexOf("dd this permission"))))]).toEqual([needed ? `dd this permission to the account token: ${right}` : `dd this permission to the account token and press Repair: ${right}`]);
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

    expect([failed.length, failed.join().includes("Add this permission")]).toEqual([1, false]);
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

    expect(rows.slice(6, 15)).toEqual([
      "Access application | not-run | poplin: poplin.example.com, *-p-poplin.example.com",
      "Access policy | not-run | poplin logins",
      "Access policy | created | poplin open paths policy",
      "Access application | failed | poplin open paths: refused with status 403 and codes 10000",
      "Worker variable | not-run | ",
      "Key | not-run | ",
      "Upload key | not-run | ",
      "Worker logs | not-run | ",
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

    // The open paths carry the names of the login's two objects: what tells them apart is what each row names.
    const named = (row: DomainRow): string => (row.detail.startsWith("poplin open paths") ? `${row.object} of the open paths` : row.object);
    const objectsOf = (part: string): string[] => [...new Set(rows.filter((row) => row.part === part).map(named))];

    expect([objectsOf("login"), objectsOf("reach")]).toEqual([
      ["Access application", "Access policy", "Worker variable"],
      ["DNS record", "Worker route", "Access application of the open paths", "Access policy of the open paths"],
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
const OWN = {
  account: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" },
  zone: { "com.cloudflare.api.account.zone.zone-1": "*" },
  bucket: { [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_poplin-sites`]: "*" },
};

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
const LACKS = "Key | differs | poplin kept key: the key the install holds lacks a permission the install uses now";

/** The one right of an upload key. */
const UPLOAD_RIGHT = "Workers R2 Storage Bucket Item Write";

/** The one policy of an upload key as Cloudflare lists it: the bucket's group of that name, allowed on `resources`. */
function uploadPolicies(right: string, resources: Record<string, unknown>): { effect: string; permission_groups: { id: unknown }[]; resources: Record<string, unknown> }[] {
  return [{ effect: "allow", permission_groups: groupsOf("com.cloudflare.edge.r2.bucket").filter(({ id }) => String(id).startsWith(right)), resources }];
}

/** The upload key a Worker holds, as Cloudflare lists it while it works, with the one group it carries on the install's bucket. */
const UPLOAD_HELD = { id: "upload-held", name: "poplin upload key", status: "active", policies: uploadPolicies(UPLOAD_RIGHT, OWN.bucket) };

/** The row of an upload key that works and lacks its right where the install's bucket is. */
const UPLOAD_LACKS = "Upload key | differs | poplin upload key: the key the install holds lacks a permission the install uses now";

/** The row of an upload key that works. */
const UPLOAD_PRESENT = "Upload key | present | poplin upload key";

/** The one call that writes the Worker's settings. */
const SETTINGS_WRITE = `PATCH /accounts/${ACCOUNT}/workers/scripts/poplin/settings`;

/** Where the account's own tokens are. */
const TOKENS = `/accounts/${ACCOUNT}/tokens`;

/** The moment the clock of every run here shows. */
const NOW = 1_700_000_000_000;

/** What a row says of a new key whose write was refused, after the key's name. */
const UNWRITTEN = "made, and deleted again when its write onto the Worker failed";

/** What a row says to a token that may not make a key. */
const NO_TOKENS_RIGHT = "refused with status 403 and codes 10000. Add this permission to the account token: Account API Tokens: Edit";

/**
 * One run that has to do with the keys: the account it meets, the keys the Worker holds, and what the two keys' rows, the steps, and the account say after it.
 *
 * `held` is the kept key as the Worker holds it; without it the run is not the Worker's own, and reads both keys with the token.
 * `upload` is the upload key of a Worker: one that `works` is held and listed by Cloudflare as whole, one that is `held` is listed only as `account` lists it, and with `none` the Worker holds none. Left out, it works.
 * `keys` is how many tokens the account holds after the run, and `secrets` the secrets the run wrote, in the order of their one change.
 */
interface KeyRun {
  readonly name: string;
  readonly run: "check" | "repair" | "give";
  readonly account?: Partial<Account>;
  readonly held?: keyof typeof HELD;
  readonly upload?: "works" | "held" | "none";
  readonly rows: readonly [kept: string, upload: string];
  readonly rights?: readonly [kept: string | undefined, upload: string | undefined];
  readonly step?: string;
  readonly keys: number;
  readonly secrets: readonly string[];
}

const keyRuns: readonly KeyRun[] = [
  { name: "a check on a Worker whose keys work", run: "check", held: "works", rows: ["Key | present | poplin kept key", UPLOAD_PRESENT], keys: 1, secrets: [] },
  { name: "a check on a Worker with no key", run: "check", held: "none", upload: "none", rows: ["Key | missing | poplin kept key", "Upload key | missing | poplin upload key"], keys: 0, secrets: [] },
  {
    name: "a check on a Worker whose key Cloudflare refuses",
    run: "check",
    held: "refused",
    account: { tokens: [OLD_KEY] },
    rows: ["Key | differs | poplin kept key: Cloudflare no longer takes the key the install holds", UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a check on a Worker whose upload key Cloudflare lists no more",
    run: "check",
    held: "works",
    upload: "held",
    rows: ["Key | present | poplin kept key", "Upload key | differs | poplin upload key: Cloudflare no longer takes the key the install holds"],
    keys: 0,
    secrets: [],
  },
  {
    name: "a check on a Worker whose upload key Cloudflare lists as ended",
    run: "check",
    held: "works",
    upload: "held",
    account: { tokens: [{ ...UPLOAD_HELD, status: "disabled" }] },
    rows: ["Key | present | poplin kept key", "Upload key | differs | poplin upload key: Cloudflare no longer takes the key the install holds"],
    keys: 1,
    secrets: [],
  },
  { name: "a check on a Worker that gets no answer about its key", run: "check", held: "silent", rows: ["Key | failed | poplin kept key: no answer from Cloudflare", UPLOAD_PRESENT], keys: 1, secrets: [] },
  {
    name: "a check with a token that may not list the account's tokens: each key's row names the right its rights are read with",
    run: "check",
    held: "works",
    account: { refuse: `GET ${TOKENS}` },
    rows: [`Key | failed | poplin kept key: ${NO_TOKENS_RIGHT}`, `Upload key | failed | poplin upload key: ${NO_TOKENS_RIGHT}`],
    rights: ["Account API Tokens: Edit", "Account API Tokens: Edit"],
    keys: 1,
    secrets: [],
  },
  { name: "a repair on a Worker whose keys work makes none", run: "repair", held: "works", rows: ["Key | present | poplin kept key", UPLOAD_PRESENT], keys: 1, secrets: [] },
  { name: "a repair on a Worker with no kept key makes one", run: "repair", held: "none", rows: ["Key | created | poplin kept key", UPLOAD_PRESENT], keys: 2, secrets: ["KEPT_KEY"] },
  { name: "a repair on a Worker with no upload key makes one", run: "repair", held: "works", upload: "none", rows: ["Key | present | poplin kept key", "Upload key | created | poplin upload key"], keys: 1, secrets: ["UPLOAD_KEY"] },
  { name: "a repair on a Worker with neither key makes both, in one change", run: "repair", held: "none", upload: "none", rows: ["Key | created | poplin kept key", "Upload key | created | poplin upload key"], keys: 2, secrets: ["KEPT_KEY", "UPLOAD_KEY"] },
  {
    name: "a repair on a Worker whose key Cloudflare refuses makes a new one and deletes the old",
    run: "repair",
    held: "refused",
    account: { tokens: [OLD_KEY] },
    rows: ["Key | changed | poplin kept key", UPLOAD_PRESENT],
    keys: 2,
    secrets: ["KEPT_KEY"],
  },
  {
    name: "a repair on a Worker whose upload key Cloudflare lists no more makes a new one and deletes an older one of the name",
    run: "repair",
    held: "works",
    upload: "held",
    account: { tokens: [{ id: "older-upload", name: "poplin upload key", status: "disabled" }] },
    rows: ["Key | present | poplin kept key", "Upload key | changed | poplin upload key"],
    keys: 1,
    secrets: ["UPLOAD_KEY"],
  },
  {
    name: "a repair on a Worker that is bound to no bucket makes no upload key: there is no bucket to make it for",
    run: "repair",
    held: "works",
    upload: "none",
    account: { bindings: emptyAccount().bindings.filter((binding) => binding.name !== "SITES") },
    rows: ["Key | present | poplin kept key", "Upload key | failed | poplin upload key: the Worker is bound to no bucket"],
    keys: 0,
    secrets: [],
  },
  {
    name: "a repair on a Worker that gets no answer about its key makes none: a key that may still work is not replaced",
    run: "repair",
    held: "silent",
    rows: ["Key | failed | poplin kept key: no answer from Cloudflare", UPLOAD_PRESENT],
    keys: 1,
    secrets: [],
  },
  {
    name: "a check on a Worker whose key works and was made before a right was added",
    run: "check",
    held: "works",
    account: { tokens: [EARLY_KEY] },
    rows: [LACKS, UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a check on a Worker whose upload key is listed with another group than the one that writes objects",
    run: "check",
    held: "works",
    upload: "held",
    account: { tokens: [{ ...UPLOAD_HELD, policies: uploadPolicies("Workers R2 Storage Bucket Item Read", OWN.bucket) }] },
    rows: ["Key | present | poplin kept key", UPLOAD_LACKS],
    keys: 1,
    secrets: [],
  },
  {
    name: "a check on a Worker whose upload key writes the objects of another bucket alone",
    run: "check",
    held: "works",
    upload: "held",
    account: { tokens: [{ ...UPLOAD_HELD, policies: uploadPolicies(UPLOAD_RIGHT, { [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_other-sites`]: "*" }) }] },
    rows: ["Key | present | poplin kept key", UPLOAD_LACKS],
    keys: 1,
    secrets: [],
  },
  {
    name: "a check on a Worker whose upload key is listed as Cloudflare lists a policy, with an id of its own and each group's name beside its id",
    run: "check",
    held: "works",
    upload: "held",
    account: {
      tokens: [
        {
          ...UPLOAD_HELD,
          policies: uploadPolicies(UPLOAD_RIGHT, OWN.bucket).map((policy) => ({ ...policy, id: "policy-1", permission_groups: policy.permission_groups.map((group) => ({ ...group, name: UPLOAD_RIGHT })) })),
        },
      ],
    },
    rows: ["Key | present | poplin kept key", UPLOAD_PRESENT],
    keys: 1,
    secrets: [],
  },
  {
    name: "a check on a Worker whose upload key writes the objects of every bucket",
    run: "check",
    held: "works",
    upload: "held",
    account: { tokens: [{ ...UPLOAD_HELD, policies: uploadPolicies(UPLOAD_RIGHT, { "com.cloudflare.edge.r2.bucket.*": "*" }) }] },
    rows: ["Key | present | poplin kept key", UPLOAD_PRESENT],
    keys: 1,
    secrets: [],
  },
  {
    name: "a repair on a Worker whose upload key writes the objects of another bucket alone makes a new one for the Worker's bucket and deletes the old",
    run: "repair",
    held: "works",
    upload: "held",
    account: { tokens: [{ ...UPLOAD_HELD, policies: uploadPolicies(UPLOAD_RIGHT, { [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_other-sites`]: "*" }) }] },
    rows: ["Key | present | poplin kept key", "Upload key | changed | poplin upload key"],
    keys: 1,
    secrets: ["UPLOAD_KEY"],
  },
  {
    name: "a check on a Worker that holds an upload key and is bound to no bucket: the key reaches nothing the install has",
    run: "check",
    held: "works",
    account: { bindings: emptyAccount().bindings.filter((binding) => binding.name !== "SITES") },
    rows: ["Key | present | poplin kept key", UPLOAD_LACKS],
    keys: 1,
    secrets: [],
  },
  {
    name: "a repair on a Worker whose upload key is whole, beside a key of the name it does not hold: that one is deleted, and no key is made",
    run: "repair",
    held: "works",
    account: { tokens: [{ ...UPLOAD_HELD, id: "spare-upload" }] },
    rows: ["Key | present | poplin kept key", "Upload key | changed | poplin upload key: a key of its name that the install does not hold was deleted"],
    keys: 1,
    secrets: [],
  },
  {
    name: "a repair on a Worker whose key works, where Cloudflare lists no group for a right: the key is not called whole, and is left",
    run: "repair",
    held: "works",
    account: { tokens: [EARLY_KEY], groups: emptyAccount().groups.filter((group) => group.name !== "Bot Management Read") },
    rows: ["Key | failed | poplin kept key: Cloudflare lists no permission group named Bot Management Read", UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a check on a Worker whose key carries the zone's rights on another zone alone",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn(OWN.account, { "com.cloudflare.api.account.zone.zone-2": "*" }) }] },
    rows: [LACKS, UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a check on a Worker whose key carries every right in policies that deny",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: WHOLE_KEY.policies.map((policy) => ({ ...policy, effect: "deny" })) }] },
    rows: [LACKS, UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a check on a Worker whose key carries the account's rights on one Worker of the account alone",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn({ [`com.cloudflare.api.account.${ACCOUNT}`]: { "com.cloudflare.edge.worker.script.poplin": "*" } }, OWN.zone) }] },
    rows: [LACKS, UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a check on a Worker whose key carries every right on every account, and on every zone of the install's account",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn({ "com.cloudflare.api.account.*": "*" }, { [`com.cloudflare.api.account.${ACCOUNT}`]: { "com.cloudflare.api.account.zone.*": "*" } }) }] },
    rows: ["Key | present | poplin kept key", UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a check on a Worker whose key carries the zone's rights on every zone",
    run: "check",
    held: "works",
    account: { tokens: [{ ...WHOLE_KEY, policies: policiesOn(OWN.account, { "com.cloudflare.api.account.zone.*": "*" }) }] },
    rows: ["Key | present | poplin kept key", UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a repair on a Worker whose key lacks a right, beside a whole key a failed write left: the Worker holds the first, so a new one is made and both go",
    run: "repair",
    held: "works",
    account: { tokens: [EARLY_KEY, SPARE_KEY] },
    rows: ["Key | changed | poplin kept key", UPLOAD_PRESENT],
    keys: 2,
    secrets: ["KEPT_KEY"],
  },
  {
    name: "a check on a Worker whose key is whole, beside a key of the name it does not hold",
    run: "check",
    held: "works",
    account: { tokens: [WHOLE_KEY, SPARE_KEY] },
    rows: ["Key | differs | poplin kept key: a key of its name that the install does not hold is at Cloudflare", UPLOAD_PRESENT],
    keys: 3,
    secrets: [],
  },
  {
    name: "a repair on a Worker whose key is whole, beside a key of the name it does not hold: that one is deleted, and no key is made",
    run: "repair",
    held: "works",
    account: { tokens: [WHOLE_KEY, SPARE_KEY] },
    rows: ["Key | changed | poplin kept key: a key of its name that the install does not hold was deleted", UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a repair on a Worker whose key is whole, beside an ended key of the name, which Cloudflare lists only when asked for the expired: that one is deleted too",
    run: "repair",
    held: "works",
    account: { tokens: [WHOLE_KEY, { ...SPARE_KEY, status: "expired" }] },
    rows: ["Key | changed | poplin kept key: a key of its name that the install does not hold was deleted", UPLOAD_PRESENT],
    keys: 2,
    secrets: [],
  },
  {
    name: "a repair that cannot delete a key the install does not hold: the key it holds stands, and a step names what is left",
    run: "repair",
    held: "works",
    account: { tokens: [WHOLE_KEY, SPARE_KEY], refuse: `DELETE ${TOKENS}/spare-key` },
    rows: ["Key | present | poplin kept key", UPLOAD_PRESENT],
    step: "A key named poplin kept key that the install does not hold could not be deleted at Cloudflare. Press Repair again. The keys are listed there:",
    keys: 3,
    secrets: [],
  },
  {
    name: "a check with a person's token alone, where one of the two active keys lacks a right: which one the Worker holds cannot be known",
    run: "check",
    account: { bindings: KEY_BOUND, tokens: [EARLY_KEY, SPARE_KEY] },
    rows: [LACKS, "Upload key | missing | poplin upload key"],
    keys: 2,
    secrets: [],
  },
  {
    name: "a repair on a Worker whose key works and was made before a right was added makes a new one and deletes the old",
    run: "repair",
    held: "works",
    account: { tokens: [EARLY_KEY] },
    rows: ["Key | changed | poplin kept key", UPLOAD_PRESENT],
    keys: 2,
    secrets: ["KEPT_KEY"],
  },
  { name: "a repair on a Worker whose key works and carries every right makes none", run: "repair", held: "works", account: { tokens: [WHOLE_KEY] }, rows: ["Key | present | poplin kept key", UPLOAD_PRESENT], keys: 2, secrets: [] },
  {
    name: "a repair with a token that may not make a token: each key's row names the right, and everything else is made",
    run: "repair",
    account: { refuse: `GET ${TOKENS}/permission_groups` },
    rows: [`Key | failed | poplin kept key: ${NO_TOKENS_RIGHT}`, `Upload key | failed | poplin upload key: ${NO_TOKENS_RIGHT}`],
    rights: ["Account API Tokens: Edit", "Account API Tokens: Edit"],
    keys: 0,
    secrets: [],
  },
  {
    name: "a repair whose list of groups lacks a right's name: the kept key's row names it, and the upload key is made all the same",
    run: "repair",
    account: { groups: emptyAccount().groups.filter((group) => group.name !== "Bot Management Read") },
    rows: ["Key | failed | poplin kept key: Cloudflare lists no permission group named Bot Management Read", "Upload key | created | poplin upload key"],
    keys: 1,
    secrets: ["UPLOAD_KEY"],
  },
  {
    name: "a repair whose write of the Worker's settings is refused, quoting what was sent: both new keys are deleted, and no row quotes one",
    run: "repair",
    account: { refuse: SETTINGS_WRITE, refuseQuotes: true, refuseAs: { status: 400, code: 10021 } },
    rows: [`Key | failed | poplin kept key, ${UNWRITTEN}: refused with status 400 and codes 10021`, `Upload key | failed | poplin upload key, ${UNWRITTEN}: refused with status 400 and codes 10021`],
    keys: 0,
    secrets: ["KEPT_KEY", "UPLOAD_KEY"],
  },
  {
    name: "a repair whose write fails and whose new keys Cloudflare will not delete: each row says its key is left",
    run: "repair",
    account: { refuse: [SETTINGS_WRITE, `DELETE ${TOKENS}/*`], refuseAs: { status: 400, code: 1 } },
    rows: [
      "Key | failed | poplin kept key, made, and left at Cloudflare for you to delete when its write onto the Worker failed: refused with status 400 and codes 1",
      "Upload key | failed | poplin upload key, made, and left at Cloudflare for you to delete when its write onto the Worker failed: refused with status 400 and codes 1",
    ],
    keys: 2,
    secrets: ["KEPT_KEY", "UPLOAD_KEY"],
  },
  {
    name: "a repair that cannot delete the older key: the new one is kept, and a step names what is left",
    run: "repair",
    held: "refused",
    account: { tokens: [OLD_KEY], refuse: `DELETE ${TOKENS}/old-key` },
    rows: ["Key | changed | poplin kept key", UPLOAD_PRESENT],
    step: "An older key named poplin kept key may still be at Cloudflare. Delete it there:",
    keys: 3,
    secrets: ["KEPT_KEY"],
  },
  { name: "giving keys to a Worker with none makes both", run: "give", held: "none", upload: "none", rows: ["Key | created | poplin kept key", "Upload key | created | poplin upload key"], keys: 2, secrets: ["KEPT_KEY", "UPLOAD_KEY"] },
  {
    name: "giving keys to a Worker that holds both replaces both, and deletes the two it held",
    run: "give",
    held: "works",
    account: { tokens: [OLD_KEY] },
    rows: ["Key | changed | poplin kept key", "Upload key | changed | poplin upload key"],
    keys: 2,
    secrets: ["KEPT_KEY", "UPLOAD_KEY"],
  },
  {
    name: "giving keys with a token that may not make one",
    run: "give",
    held: "none",
    upload: "none",
    account: { refuse: `POST ${TOKENS}` },
    rows: [`Key | failed | poplin kept key: ${NO_TOKENS_RIGHT}`, `Upload key | failed | poplin upload key: ${NO_TOKENS_RIGHT}`],
    rights: ["Account API Tokens: Edit", "Account API Tokens: Edit"],
    keys: 0,
    secrets: [],
  },
  {
    name: "giving keys with a token that may not write the Worker: the new keys are deleted, and each row names that right",
    run: "give",
    held: "none",
    upload: "none",
    account: { refuse: SETTINGS_WRITE, refuseQuotes: true },
    rows: [
      `Key | failed | poplin kept key, ${UNWRITTEN}: refused with status 403 and codes 10000. Add this permission to the account token: Workers Scripts: Edit`,
      `Upload key | failed | poplin upload key, ${UNWRITTEN}: refused with status 403 and codes 10000. Add this permission to the account token: Workers Scripts: Edit`,
    ],
    rights: ["Workers Scripts: Edit", "Workers Scripts: Edit"],
    keys: 0,
    secrets: ["KEPT_KEY", "UPLOAD_KEY"],
  },
];

/** The secrets a run wrote onto the Worker, in the order of their change, and how many changes held them. */
function secretsOf(asked: readonly Asked[]): { readonly changes: number; readonly texts: readonly { readonly name: string; readonly text?: string }[] } {
  const written = asked.filter((entry) => entry.method === "PATCH").map((entry) => (entry.body as { settings: { bindings: { name: string; type: string; text?: string }[] } }).settings.bindings);

  return { changes: written.length, texts: written.flatMap((bindings) => bindings.filter((binding) => binding.type === "secret_text")) };
}

/** The rows of the two keys as a reading holds them and the steps that name a key, with what the fake's refusal quotes of the call left out: the token it was sent with, and where it quotes them the bindings. */
function keyRowsOf(reading: DomainReading): { readonly shown: string[]; readonly rights: (string | undefined)[][]; readonly steps: readonly unknown[] } {
  const found = reading.ok ? reading.rows.filter((row) => row.object === "Key" || row.object === "Upload key") : [];
  const plain = (detail: string): string => detail.replace(/ for Bearer .*?(\. Add this permission|$)/, "$1");

  const steps = reading.ok ? reading.steps.filter((entry) => entry.text.includes("key")) : [];

  return { shown: found.map((row) => `${row.object} | ${row.state} | ${plain(row.detail)}`), rights: found.map((row) => [row.part, row.right]), steps };
}

describe("the keys an install keeps", () => {
  let logs: Mock<(...said: unknown[]) => void>[] = [];

  beforeEach(() => {
    logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => spyOn(console, level).mockImplementation(() => undefined));
  });

  afterEach(() => {
    for (const log of logs) log.mockRestore();
  });

  // Drift: the keys are the only credentials an install keeps. A run that made a second one, left one nothing holds, or said a value or the bucket's secret anywhere would do so on every install.
  test.each(keyRuns)("$name", async ({ run, account = {}, held, upload = "works", rows, rights = [undefined, undefined], step, keys, secrets }) => {
    const listed = held !== undefined && upload === "works" ? [UPLOAD_HELD] : [];
    const met = { ...emptyAccount(), ...account, tokens: [...(account.tokens ?? []), ...listed] };
    const key = held === undefined ? undefined : HELD[held];
    const uploadKeyId = held === undefined || upload === "none" ? undefined : UPLOAD_HELD.id;

    await withFake(
      (asked) => answer(met, asked),
      async (connection, asked) => {
        const parts = { accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl, key, uploadKeyId, now: () => NOW };
        const reading = run === "give" ? await giveKey(parts, TOKEN) : await createDomainPlug(parts)[run](TOKEN, SETTINGS);
        const found = keyRowsOf(reading);
        const { changes, texts } = secretsOf(asked);
        const uploads = texts.filter((binding) => binding.name === "UPLOAD_KEY").map((binding) => readUploadKey(binding.text));
        const said = [JSON.stringify(reading), Bun.inspect(reading), ...logs.flatMap((log) => log.mock.calls.map((call) => Bun.inspect(call)))].join("\n");
        const steps = step === undefined ? [] : [{ text: step, address: `https://dash.cloudflare.com/${ACCOUNT}/api-tokens` }];

        expect([found.shown, found.rights]).toEqual([[...rows], rights.map((right) => ["rest", right])]);
        expect(found.steps).toEqual(steps);
        // Every secret went onto the Worker in one change: the kept key as its value, and the upload key as the bucket's own form of it, with the moment it was made.
        expect([met.tokens.length, changes <= 1, texts.map((binding) => binding.name)]).toEqual([keys, true, [...secrets]]);
        expect(texts.filter((binding) => binding.name === "KEPT_KEY").map((binding) => binding.text?.startsWith(KEY_VALUE_START))).toEqual(secrets.includes("KEPT_KEY") ? [true] : []);
        expect(uploads.map((made) => [made?.id.startsWith("key-"), made?.secret.length, made?.bucket, made?.jurisdiction, made?.minted_at])).toEqual(secrets.includes("UPLOAD_KEY") ? [[true, 64, "poplin-sites", undefined, NOW]] : []);
        // No value is said, and no secret made of one, whatever a refusal quotes.
        expect([said.includes(KEY_VALUE_START), uploads.filter((made) => made !== undefined && said.includes(made.secret)), logs.flatMap((log) => log.mock.calls)]).toEqual([false, [], []]);
        expect(run !== "give" || (reading.ok && reading.rows.length === 2 && writes(asked).every((write) => write.includes("/tokens") || write === SETTINGS_WRITE))).toBe(true);
      },
    );
  });

  // Drift: the upload key reaches one bucket, and the Worker signs for the place the key names. A key made for one jurisdiction and kept without it would sign for a bucket that is not there.
  test("the upload key of a bucket made in a jurisdiction is made for that jurisdiction and kept with it", async () => {
    const account = emptyAccount();
    account.bindings = account.bindings.map((binding) => (binding.name === "SITES" ? { ...binding, jurisdiction: "eu" } : binding));

    await withFake(
      (asked) => answer(account, asked),
      async (connection, asked) => {
        await createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl, now: () => NOW }).repair(TOKEN, SETTINGS);
        const made = asked.filter((entry) => entry.method === "POST" && entry.path.split("?")[0] === TOKENS).map((entry) => entry.body as { name: string; policies: { resources: object }[] });
        const written = asked.filter((entry) => entry.method === "PATCH").flatMap((entry) => (entry.body as { settings: { bindings: { name: string; text?: string }[] } }).settings.bindings);

        expect(made.filter((token) => token.name === "poplin upload key").map((token) => token.policies.map((policy) => Object.keys(policy.resources)))).toEqual([[[`com.cloudflare.edge.r2.bucket.${ACCOUNT}_eu_poplin-sites`]]]);
        expect(written.filter((binding) => binding.name === "UPLOAD_KEY").map((binding) => readUploadKey(binding.text)?.jurisdiction)).toEqual(["eu"]);
      },
    );
  });

  // Drift: a token made from an older link has no right to make a key. An install whose login waited on the key would not start for it.
  test("a repair with a token that may not make a key still writes the Worker's variables, with no key among them, and goes on to every other piece", async () => {
    const account = { ...emptyAccount(), refuse: `GET ${TOKENS}/permission_groups` };
    const keyless = (rows: readonly string[]): string[] => rows.filter((row) => !row.startsWith("Key | ") && !row.startsWith("Upload key | "));

    await withAccount(account, async (plug) => {
      const rows = shown(await plug.repair(TOKEN, SETTINGS));

      expect(account.bindings.map((binding) => binding.name)).toEqual(["WORKER_NAME", "SITES", "DB", "ZONE", "ACCESS"]);
      expect(keyless(rows)).toEqual(keyless(table({ all: "created", bots: "changed" })));
    });
  });

  // Drift: a key Cloudflare never reads back cannot be compared, so a later change must name it as kept; sent again it would need a value nobody has.
  test("a later repair that changes a variable names both keys as inherited, like every other binding, and makes no new one", async () => {
    const account = emptyAccount();

    await withAccount(account, async (plug, asked) => {
      await plug.repair(TOKEN, SETTINGS);
      account.bindings = account.bindings.filter((binding) => binding.name !== "ACCESS");
      const sent = asked.length;
      const rows = shown(await plug.repair(TOKEN, SETTINGS));
      const changes = asked.slice(sent).filter((entry) => entry.method === "PATCH").map((entry) => (entry.body as { settings: { bindings: { name: string; type: string }[] } }).settings.bindings);

      expect(rows.filter((row) => row.includes("ey | ") || row.startsWith("Worker variable"))).toEqual(["Worker variable | created | ACCESS", "Key | present | poplin kept key", UPLOAD_PRESENT]);
      expect(changes.map((bindings) => bindings.map((binding) => `${binding.name} ${binding.type}`))).toEqual([["WORKER_NAME inherit", "SITES inherit", "DB inherit", "ZONE inherit", "KEPT_KEY inherit", "UPLOAD_KEY inherit", "ACCESS json"]]);
      expect([account.tokens.length, writes(asked.slice(sent))]).toEqual([2, [SETTINGS_WRITE]]);
    });
  });

  // Drift: the Worker's secret says a key was written, not that it still works. A key deleted at Cloudflare would read as present for ever.
  test("with no key in hand, each key is present only while the Worker has its secret and Cloudflare lists an active token of its name", async () => {
    const account = emptyAccount();
    const keyRows = async (plug: ReturnType<typeof createDomainPlug>): Promise<string[]> => shown(await plug.check(TOKEN, SETTINGS)).filter((row) => row.includes("ey | "));
    const refused = ["Key | differs | poplin kept key: Cloudflare no longer takes the key the install holds", "Upload key | differs | poplin upload key: Cloudflare no longer takes the key the install holds"];

    await withAccount(account, async (plug) => {
      await plug.repair(TOKEN, SETTINGS);
      const made = await keyRows(plug);
      account.tokens = account.tokens.map((token) => ({ ...token, status: "disabled" }));
      const disabled = await keyRows(plug);
      account.tokens = [];
      const deleted = await keyRows(plug);
      account.bindings = account.bindings.filter((binding) => binding.name !== "KEPT_KEY" && binding.name !== "UPLOAD_KEY");

      expect([made, disabled, deleted, await keyRows(plug)]).toEqual([["Key | present | poplin kept key", UPLOAD_PRESENT], refused, refused, ["Key | missing | poplin kept key", "Upload key | missing | poplin upload key"]]);
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

describe("a check the install makes with the key it holds", () => {
  /** How an optional piece that is not set up reads, as a token without its right reads it. */
  const OPTIONAL = {
    redirect: "Cloudflare sends http to https before poplin runs. Without it poplin sends the same redirect itself. To switch this on, add this permission to the account token and press Repair: Single Redirect: Edit",
    waf: "Cloudflare stops verified bots, scanner paths, pages of other domains, and floods before they reach poplin. To switch this on, add this permission to the account token and press Repair: Zone WAF: Edit",
    bots: "Cloudflare blocks AI crawlers on the whole domain, as the block_bots setting says. To switch this on, add this permission to the account token and press Repair: Bot Management: Edit",
    alert:
      "Cloudflare emails your first user when the account's usage charges for the billing period reach 1 US dollar. " +
      "An install whose key Cloudflare takes makes it by itself within a day. To make it now, add this permission to the account token and press Repair: Notifications: Edit",
    certificates:
      "Cloudflare emails your first user when a certificate it issues for a domain fails, is renewed, or runs out: for every domain of the account, not this one alone. " +
      "An install whose key Cloudflare takes makes it by itself within a day. To make it now, add this permission to the account token and press Repair: Notifications: Edit",
  } as const;

  /** The database's row in such a check, which no call reads. */
  const DATABASE = "D1 database | present | poplin: the install is running on it";

  /** Run a test against an account at the fake API, with the plug of an install that holds `key`. */
  async function withKey(account: Account, run: (plug: ReturnType<typeof createDomainPlug>, own: () => Promise<DomainReading>, asked: readonly Asked[]) => Promise<void>, holdsUpload = true): Promise<void> {
    await withFake(
      (asked) => answer(account, asked),
      async (connection, asked) => {
        const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl, uploadKeyId: holdsUpload ? "held-upload-key" : undefined, kept: { connection: { key: KEPT, baseUrl: connection.baseUrl } } });
        const own = plug.ownCheck;
        if (own === undefined) throw new Error("a plug with a key has no check of its own");

        await run(plug, () => own(SETTINGS), asked);
      },
    );
  }

  // Drift: the count is what one request of a Worker spends each time the Domain screen opens on a check that is old. A call to the databases or the tokens is one the key is refused, and its row would fail on every healthy install.
  test("every piece a repair made reads as present in 22 calls, each a read sent with the key, none to the databases or the tokens, and the database's row says the install runs on it", async () => {
    const account = emptyAccount();

    await withKey(account, async (plug, own, asked) => {
      await plug.repair(TOKEN, SETTINGS);
      const sent = asked.length;
      const rows = shown(await own());
      const calls = asked.slice(sent);

      expect(rows).toEqual(table({}).map((row) => (row.startsWith("D1 database") ? DATABASE : row)));
      expect([calls.length, [...new Set(calls.map((call) => `${call.method} ${call.key}`))], calls.filter((call) => /\/(d1|tokens)(\/|\?|$)/.test(call.path))]).toEqual([22, [`GET Bearer ${KEPT}`], []]);
    });
  });

  // Drift: the key can see that an optional piece is absent, and no token says the person wants it. Read as missing, every install set up with the needed rights alone would rest on a count to repair that a repair with its own token cannot clear.
  test("on an account with nothing in it the needed pieces read missing and each optional piece reads optional, in the words a token without its right is told, and nothing is sent but reads", async () => {
    const account = emptyAccount();
    const before = structuredClone(account);

    await withKey(account, async (_plug, own, asked) => {
      const reading = await own();

      expect(shown(reading)).toEqual([
        ...table({ all: "missing" }).slice(0, 11),
        "Key | present | poplin kept key",
        "Upload key | present | poplin upload key",
        "Worker logs | present | enabled",
        `Redirect rule | optional | https redirect: ${OPTIONAL.redirect}`,
        `WAF rule | optional | bots rule: ${OPTIONAL.waf}`,
        `WAF rule | optional | outside pages rule: ${OPTIONAL.waf}`,
        `Rate rule | optional | rate rule: ${OPTIONAL.waf}`,
        `Bot settings | optional | zone bot switches: ${OPTIONAL.bots}`,
        DATABASE,
        `Budget alert | optional | poplin: usage charges reached 1 dollar: ${OPTIONAL.alert}`,
        `Certificate alert | optional | poplin: certificates of every domain of the account: ${OPTIONAL.certificates}`,
        "Workflow | missing | poplin-jobs",
      ]);
      expect([writes(asked), account]).toEqual([[], before]);
    });
  });

  const lacking = [
    { name: "the records", refuse: "/zones/zone-1/dns_records", row: "DNS record | failed | the key the install holds lacks this permission: DNS Read. Press Repair.", right: "DNS Read", unread: ["Rate rule | not-run | ", "Bot settings | not-run | "] },
    { name: "the routes", refuse: "/zones/zone-1/workers/routes", row: "Worker route | failed | the key the install holds lacks this permission: Workers Routes Read. Press Repair.", right: "Workers Routes Read", unread: [] },
    {
      name: "the zone's own https switch",
      refuse: "/zones/zone-1/settings/always_use_https",
      row: "Redirect rule | failed | the zone's own https switch: the key the install holds lacks this permission: Zone Settings Read. Press Repair.",
      right: "Zone Settings Read",
      unread: [],
    },
    { name: "the bot switches", refuse: "/zones/zone-1/bot_management", row: "Bot settings | failed | the key the install holds lacks this permission: Bot Management Read. Press Repair.", right: "Bot Management Read", unread: [] },
    {
      name: "the two alerts",
      refuse: `/accounts/${ACCOUNT}/alerting/v3/policies`,
      row: "Budget alert | failed | the key the install holds lacks this permission: Notifications Write. Press Repair.",
      right: "Notifications Write",
      unread: ["Certificate alert | failed | the key the install holds lacks this permission: Notifications Write. Press Repair."],
    },
  ];

  // Drift: a key made before a right was added lacks it. A check that stopped there, or said nothing of the key, would hide every other piece behind one row and leave the person with no word that a repair makes a new key.
  test.each(lacking)("a key that lacks the right to read $name fails that row alone, names the right, and says the key is one a repair replaces: the other pieces are still read", async ({ refuse, row, right, unread }) => {
    const account = emptyAccount();
    const kindOf = (line: string): string => line.split(" | ")[0] ?? "";

    await withKey(account, async (plug, own) => {
      await plug.repair(TOKEN, SETTINGS);
      account.refuse = `GET ${refuse}`;
      const reading = await own();
      const changed = [row, ...unread, "Key", "D1 database"].map(kindOf);
      const expected = [...table({}).filter((line) => !changed.includes(kindOf(line))), DATABASE, "Key | differs | poplin kept key: the key the install holds lacks a permission the install uses now", row, ...unread];

      expect(shown(reading).sort()).toEqual(expected.sort());
      expect(reading.ok ? [...new Set(reading.rows.flatMap((found) => (found.right === undefined ? [] : [found.right])))] : []).toEqual([right]);
    });
  });

  // Drift: a key deleted at Cloudflare answers every call 401. A check that showed that as a missing right, or as an install with nothing wrong, would never send the person to the repair that makes a new key.
  test("a key Cloudflare no longer knows reads nothing: one row says the key was refused, the key's row says so too, and no setting is read", async () => {
    let read = 0;

    await withFake(
      (asked) => answer(emptyAccount(), asked),
      async (connection, asked) => {
        const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl, kept: { connection: { key: "key-nobody-has-0123456789", baseUrl: connection.baseUrl } } });
        const reading = await plug.ownCheck?.(async () => {
          read += 1;

          return STORED;
        });

        expect(reading === undefined ? [] : shown(reading)).toEqual(["Zone | failed | Cloudflare refused the key the install holds. Press Repair.", "Key | differs | poplin kept key: Cloudflare refused the key the install holds"]);
        expect([read, asked.length]).toEqual([0, 1]);
      },
    );
  });

  // Drift: no token is scrubbed from the rows of a check that was given none. A row that carried Cloudflare's own words would carry whatever those words quote, the key among them.
  test("a call Cloudflare answers with anything else fails its row in fixed words and stops the check: no row holds the key or a word of the answer", async () => {
    const account = { ...emptyAccount(), refuse: "GET /zones/zone-1/workers/routes", refuseAs: { status: 400, code: 1004 } };

    await withKey(account, async (_plug, own) => {
      const reading = await own();
      const rows = shown(reading).filter((row) => ["Worker route", "Key", "Access application"].some((kind) => row.startsWith(kind)));

      expect(rows).toEqual(["Worker route | failed | no usable answer from Cloudflare", "Access application | not-run | ", "Key | not-run | "]);
      expect([JSON.stringify(reading).includes(KEPT), JSON.stringify(reading).includes("Authentication error")]).toEqual([false, false]);
    });
  });

  // Drift: a zone that left the account, or a key made for another zone, shows no zone of the install's domain. Read on with no zone, every call would be sent to nothing.
  test("a key that shows no zone of the install's domain says the zone is missing and reads no piece", async () => {
    await withFake(
      (asked) => answer(emptyAccount(), asked),
      async (connection, asked) => {
        const plug = createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: layoutOf({ domain: "example.org" }), baseUrl: connection.baseUrl, kept: { connection: { key: KEPT, baseUrl: connection.baseUrl } } });
        const reading = await plug.ownCheck?.(SETTINGS);

        expect(reading === undefined ? [] : shown(reading)).toEqual(["Zone | missing | example.org"]);
        expect(asked.every((call) => call.path.startsWith("/zones?"))).toBe(true);
      },
    );
  });

  // Drift: the key reads no token of the account, so it cannot ask about the upload key. A row that said nothing of an install made before it had one would leave publishing without its key and no word to repair.
  test("the upload key's row says only whether the install holds one: missing on an install that holds none, with no call about it", async () => {
    const account = emptyAccount();

    await withKey(
      account,
      async (_plug, own, asked) => {
        const rows = shown(await own()).filter((row) => row.startsWith("Upload key"));

        expect([rows, asked.filter((call) => call.path.includes("/tokens"))]).toEqual([["Upload key | missing | poplin upload key"], []]);
      },
      false,
    );
  });

  // Drift: an install that is being made holds no key. A check of its own would call Cloudflare with nothing, and the screen would stop asking for the token it needs.
  test("an install that holds no key has no check of its own, which is what the console asks its token by", () => {
    expect(createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT }).ownCheck).toBeUndefined();
  });

  // Drift: a record in the install's way is found by a read Cloudflare answered. Said as no answer from Cloudflare, the row would lose the one thing the person can do about the record.
  test("a piece that stops itself over what Cloudflare answered says why in its own words, as a check with a token does", async () => {
    const account = emptyAccount();
    account.records.push({ id: "theirs", name: "*.example.com", type: "A", content: "192.0.2.1", proxied: false });
    const records = (rows: readonly string[]): string[] => rows.filter((row) => row.startsWith("DNS record"));

    await withKey(account, async (plug, own) => {
      const [byKey, byToken] = [records(shown(await own())), records(shown(await plug.check(TOKEN, SETTINGS)))];

      expect([byKey, byKey.some((row) => row.includes("failed"))]).toEqual([byToken, true]);
    });
  });

  // Drift: the login is read before its piece has rows, outside the call the key's answers are read from. An answer cut short there would end the whole check with an error and no row.
  test("an answer about the login that is cut short fails the login's row in fixed words, and the check still answers its rows", async () => {
    await withFake(
      (asked) => (asked.path.includes("/access/policies") ? new Response("{", { headers: { "Content-Type": "application/json" } }) : answer(emptyAccount(), asked)),
      async (connection) => {
        const reading = await createDomainPlug({ accountId: ACCOUNT, script: "poplin", layout: LAYOUT, baseUrl: connection.baseUrl, kept: { connection: { key: KEPT, baseUrl: connection.baseUrl } } }).ownCheck?.(SETTINGS);

        expect(reading === undefined ? [] : shown(reading).filter((row) => row.startsWith("Access"))).toEqual(["Access application | failed | no usable answer from Cloudflare"]);
      },
    );
  });
});

describe("an alert left out for its permission, as a command line words it", () => {
  const FIX = "The account token lacks Notifications: Edit. Fix: add it, then run npx poplin doctor --repair";
  const alert: DomainRow = { object: "Budget alert", state: "optional", detail: "", part: "rest" };
  const key = (state: DomainRow["state"]): DomainRow => ({ object: "Key", state, detail: "poplin kept key", part: "rest" });

  // Drift: the row promised that the install makes the alert within a day. An install with no key Cloudflare takes makes none, so a repair whose token could make neither the key nor the alert promised an alert that never comes.
  test.each<[string, readonly DomainRow[], string]>([
    ["a key that stands", [key("present"), alert], `${FIX}, or wait a day for the install to create it`],
    ["a key the run made", [alert, key("created")], `${FIX}, or wait a day for the install to create it`],
    ["a key that could not be made", [key("failed"), alert], FIX],
    ["a key Cloudflare refuses", [key("differs"), alert], FIX],
    ["no row of the key", [alert], FIX],
  ])("with %s, says that the install makes it only where the install holds a working key", (_what, rows, said) => {
    expect(commandRows(rows).find((row) => row.object === "Budget alert")?.detail).toBe(said);
  });
});

describe("a row refused for a permission, as a command line words it", () => {
  // Drift: a row worded apart from the others kept the dashboard's sentence for a missing permission, which names a button no command line has.
  test("says that the token lacks the permission, in place of the sentence that names Repair", () => {
    const detail = "enabled: refused with status 403 and codes 10000. Add this permission to the account token: Workers Scripts: Edit";

    expect(commandRows([{ object: "Worker logs", state: "present", detail, part: "rest" }])[0]?.detail).toBe("enabled: refused with status 403 and codes 10000. The account token lacks Workers Scripts: Edit");
  });
});
