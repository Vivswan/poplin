// The setup client's copy of each shared value against the OpenTofu module's text, and a zone the module set up run through the setup client with the same inputs.
// Without this either side could change a mark or a name alone, and one tool would refuse, repoint, or remove what the other made.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { syncAccess } from "../../src/zone/access/access";
import { syncZoneBots } from "../../src/zone/bots/bots";
import type { Connection } from "../../src/zone/client";
import { syncDatabase } from "../../src/zone/database/database";
import { syncDns } from "../../src/zone/dns/dns";
import { syncGuards } from "../../src/zone/rules/guards";
import { INSTALL_OBJECTS } from "../../src/zone/install-objects";
import { syncRoutes } from "../../src/zone/routes/routes";
import type { Report } from "../../src/zone/sync";
import { syncWaf } from "../../src/zone/rules/waf";
import { type Asked, page, refusal, reply, withFake } from "./support/fake-cloudflare";
import { hostOf, SUFFIXED } from "./support/layouts";

const MODULE = join(import.meta.dir, "..", "..", "tofu");
const ZONE = "zone-1";
const ACCOUNT = "account-a";
const SITES = 'ends_with(http.host, "-page.example.com")';
const LIMIT = { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 300, mitigation_timeout: 10 };

type SharedKey = keyof typeof INSTALL_OBJECTS;

/** Where the module writes each shared value: the file, and the text around it. `%v` stands for the value as HCL writes it, `%i` for the value inside a longer HCL text. */
const WRITTEN: Readonly<Record<SharedKey, readonly [file: string, around: string]>> = {
  recordMark: ["main.tf", 'startswith(coalesce(record.comment, "none"), %v)'],
  wildcardComment: ["main.tf", "(local.wildcard_host) = %v"],
  adminComment: ["main.tf", "(local.admin_host) = %v"],
  recordType: ["dns.tf", "type = %v"],
  recordContent: ["dns.tf", "content = %v"],
  accessApplication: ["access.tf", "name = %v"],
  accessPolicy: ["access.tf", "name = %v"],
  loginPath: ["access.tf", `destinations = [{ type = "public", uri = "\${local.admin_host}%i" }]`],
  database: ["database.tf", "name = %v"],
  rateRuleset: ["waf.tf", "name = %v"],
  rateRef: ["waf.tf", "ref = %v"],
  rateDescription: ["waf.tf", "description = %v"],
  rateWholeZone: ["main.tf", '? "%i" : local.served_expression'],
  rateCounts: ["waf.tf", "characteristics = %v"],
  ratePeriod: ["waf.tf", " period = %v"],
  rateRequests: ["waf.tf", "requests_per_period = %v"],
  rateBlockSeconds: ["waf.tf", "mitigation_timeout = %v"],
  guardRuleset: ["waf.tf", "name = %v"],
  outsideRef: ["main.tf", "ref = %v"],
  outsideDescription: ["main.tf", "description = %v"],
  outsideCondition: ["main.tf", 'format("ends_with(http.host, %q) and %i", local.site_host_ending)'],
  botsRef: ["main.tf", "ref = %v"],
  botsDescription: ["main.tf", "description = %v"],
  botsCondition: ["main.tf", 'format("ends_with(http.host, %q) and %i%s"'],
  searchEnginesPass: ["main.tf", '? " and %i" : ""'],
  aiBots: ["waf.tf", "ai_bots_protection = %v"],
  minuteLimitsBinding: ["worker.tf", "name = %v\n type = \"ratelimit\""],
  minuteLimitsNamespace: ["worker.tf", "namespace_id = %v"],
  minuteLimitsLimit: ["worker.tf", "simple = { limit = %v, "],
  minuteLimitsSeconds: ["worker.tf", ", period = %v }"],
  accessBinding: ["worker.tf", 'name = %v\n type = "json"\n json = jsonencode({'],
  sweepCron: ["worker.tf", "schedules = [{ cron = %v }]"],
};

/** One file of the module with runs of spaces made one, so the alignment `tofu fmt` chooses does not matter. */
function moduleText(file: string): string {
  return readFileSync(join(MODULE, file), "utf8").replaceAll(/ +/g, " ");
}

/** A value as HCL writes it: a text in double quotes with its own quotes escaped, a number bare, a list in brackets. */
function hcl(value: string | number | readonly string[]): string {
  if (typeof value === "number") return String(value);

  if (typeof value === "string") return JSON.stringify(value);

  return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
}

/** What the module's resources read back as from the API, for its default inputs on `example.com`. `rate` is the expression of its rate rule. */
function moduleZone(rate: string): Readonly<Record<string, unknown>> {
  const placeholder = { type: "AAAA", content: "100::", proxied: true, ttl: 1 };
  const login = "admin.example.com/login";
  const rateRule = { id: "r1", ref: "poplin_rate", description: "poplin: 300 requests per 10 seconds per address", expression: rate, action: "block" };
  const outside = `${SITES} and any(http.request.headers["sec-fetch-site"][*] eq "cross-site") and any(http.request.headers["sec-fetch-dest"][*] ne "document")`;

  return {
    [`/zones/${ZONE}/dns_records`]: [
      { id: "d1", name: "*.example.com", ...placeholder, comment: "poplin: every site" },
      { id: "d2", name: "admin.example.com", ...placeholder, comment: "poplin: the dashboard, the login, and the API" },
    ],
    [`/zones/${ZONE}/workers/routes`]: [
      { id: "w1", pattern: "*-page.example.com/*", script: "poplin" },
      { id: "w2", pattern: "admin.example.com/*", script: "poplin" },
    ],
    [`/accounts/${ACCOUNT}/access/policies`]: [
      { id: "pol-1", name: "poplin logins", decision: "allow", include: [{ email: { email: "owner@example.com" } }], exclude: [], require: [] },
    ],
    [`/accounts/${ACCOUNT}/access/apps`]: [
      {
        id: "app-1",
        name: "poplin",
        type: "self_hosted",
        domain: login,
        destinations: [{ type: "public", uri: login }],
        policies: [{ id: "pol-1", precedence: 1, name: "poplin logins", decision: "allow" }],
      },
    ],
    [`/zones/${ZONE}/rulesets/phases/http_ratelimit/entrypoint`]: {
      id: "set-rate",
      name: "poplin rate rule",
      kind: "zone",
      phase: "http_ratelimit",
      rules: [{ ...rateRule, enabled: true, ratelimit: LIMIT }],
    },
    [`/zones/${ZONE}/rulesets/phases/http_request_firewall_custom/entrypoint`]: {
      id: "set-guards",
      name: "poplin guard rules",
      kind: "zone",
      phase: "http_request_firewall_custom",
      rules: [
        { id: "g1", ref: "poplin_outside_pages", description: "poplin: stop pages of other domains", expression: outside, action: "block", enabled: true },
        { id: "g2", ref: "poplin_bots", description: "poplin: stop verified bots", expression: `${SITES} and cf.client.bot`, action: "block", enabled: true },
      ],
    },
    [`/zones/${ZONE}/bot_management`]: { ai_bots_protection: "block", fight_mode: false },
    [`/accounts/${ACCOUNT}/d1/database`]: [{ uuid: "3f6c0d5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", name: "poplin" }],
  };
}

function answer(zone: Readonly<Record<string, unknown>>, asked: Asked): Response {
  const held = zone[new URL(asked.path, "http://localhost").pathname];
  if (held === undefined) return refusal(404, 7003, "No route for that URI");

  return Array.isArray(held) ? page(asked, held) : reply(held);
}

function logins(): Parameters<typeof syncAccess>[2]["logins"] {
  const parsed = parseLogins(["owner@example.com"]);
  if (!parsed.ok) throw new Error(`the test's logins were refused: ${parsed.refusal}`);

  return parsed.value;
}

type Run = (connection: Connection) => Promise<{ readonly ok: boolean; readonly report: Report }>;

const FREE = { layout: SUFFIXED, plan: "free", sharesZone: false, rateRule: "zone" } as const;
const WHOLE_ZONE = 'starts_with(http.request.uri.path, "/")';
const HOSTNAMES = `${SITES} or http.host eq "admin.example.com"`;

describe("the values the setup client shares with the OpenTofu module", () => {
  const rows = Object.entries(INSTALL_OBJECTS).map(([key, value]) => ({ key: key as SharedKey, value }));

  test.each(rows)("$key is written the same in the module: an object made by one tool must be the other's own too", ({ key, value }) => {
    const [file, around] = WRITTEN[key];

    // Inside a longer HCL text the value's own quotes are escaped.
    const inner = typeof value === "string" ? value.replaceAll('"', '\\"') : hcl(value);

    expect(moduleText(file)).toContain(around.replace("%v", hcl(value)).replace("%i", inner));
  });
});

describe("the Worker's rate limiting binding", () => {
  test("wrangler.jsonc declares the binding the table holds, so the module, which is pinned to the table above, binds the limiter the Worker's counters are written for", () => {
    const config = Bun.JSONC.parse(readFileSync(join(MODULE, "..", "wrangler.jsonc"), "utf8")) as { ratelimits: unknown };

    expect(config.ratelimits).toEqual([
      {
        name: INSTALL_OBJECTS.minuteLimitsBinding,
        namespace_id: INSTALL_OBJECTS.minuteLimitsNamespace,
        simple: { limit: INSTALL_OBJECTS.minuteLimitsLimit, period: INSTALL_OBJECTS.minuteLimitsSeconds },
      },
    ]);
  });
});

describe("the Worker's Access binding and sweep trigger", () => {
  test("wrangler.jsonc declares the binding name and the schedule the table holds, so a local run and a deployed Worker read the same binding and sweep as often", () => {
    const config = Bun.JSONC.parse(readFileSync(join(MODULE, "..", "wrangler.jsonc"), "utf8")) as { triggers: { crons: unknown }; vars: Record<string, unknown> };

    expect(config.triggers.crons).toEqual([INSTALL_OBJECTS.sweepCron]);
    expect(Object.keys(config.vars)).toContain(INSTALL_OBJECTS.accessBinding);
  });
});

describe("a zone the OpenTofu module set up", () => {
  const pieces: readonly { readonly name: string; readonly rate: string; readonly run: Run }[] = [
    { name: "the records", rate: WHOLE_ZONE, run: (connection) => syncDns(connection, ZONE, SUFFIXED, "apply") },
    { name: "the routes", rate: WHOLE_ZONE, run: (connection) => syncRoutes(connection, ZONE, { layout: SUFFIXED, script: "poplin" }, "apply") },
    {
      name: "the login",
      rate: WHOLE_ZONE,
      run: (connection) => syncAccess(connection, ACCOUNT, { hostname: hostOf("admin.example.com"), logins: logins() }, "apply"),
    },
    { name: "the rate rule of `rate_rule = zone`, on the Free plan", rate: WHOLE_ZONE, run: (connection) => syncWaf(connection, ZONE, FREE, "apply") },
    {
      name: "the rate rule of `rate_rule = hostnames`, on a paid plan",
      rate: HOSTNAMES,
      run: (connection) => syncWaf(connection, ZONE, { ...FREE, plan: "pro", rateRule: "hostnames" }, "apply"),
    },
    {
      name: "the rate rule of `rate_rule = zone`, the module's default, on a paid plan",
      rate: WHOLE_ZONE,
      run: (connection) => syncWaf(connection, ZONE, { ...FREE, plan: "pro" }, "apply"),
    },
    {
      name: "the guard rules",
      rate: WHOLE_ZONE,
      run: (connection) => syncGuards(connection, ZONE, { layout: SUFFIXED, plan: "free", outsidePages: "blocked", searchEnginesAllowed: false }, "apply"),
    },
    { name: "the database", rate: WHOLE_ZONE, run: (connection) => syncDatabase(connection, ACCOUNT, "apply") },
    { name: "the bot settings", rate: WHOLE_ZONE, run: (connection) => syncZoneBots(connection, ZONE, { blockBots: "auto", plan: "free", sharesZone: false }, "apply") },
  ];

  test.each(pieces)("$name: the setup client finds its own object, sends no change, and reports none", async ({ rate, run }) => {
    await withFake(
      (asked) => answer(moduleZone(rate), asked),
      async (connection, asked) => {
        const synced = await run(connection);

        expect(synced).toMatchObject({ ok: true, report: { created: [], changed: [], removed: [], skipped: [], changedNothing: true } });
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.filter((entry) => entry.method !== "GET")).toEqual([]);
      },
    );
  });

  test("the records are the install's own: the zone counts as one with no hostnames of its own, so the Free rate rule and the bot block stay", async () => {
    await withFake(
      (asked) => answer(moduleZone(WHOLE_ZONE), asked),
      async (connection) => {
        const synced = await syncDns(connection, ZONE, SUFFIXED, "apply");

        expect(synced).toMatchObject({ ok: true, sharesZone: false });
      },
    );
  });
});
