// A whole removal against an account at the fake API, after a real install of each kind made it.
// Without these a removal could take an object that is not poplin's, leave one that is, remove the files while the Worker still stands, or run on a typed name that is another install's.

import { describe, expect, test } from "bun:test";
import { parseLogin } from "@poplin/core/src/auth/logins";
import type { Found, Removable, Removal, Removed, Token } from "@poplin/core/src/install/installer";
import type { Place, Where } from "../../../../../src/shared/install/first/find";
import { installer } from "../../../../../src/shared/install/first/installer";
import { ACCOUNT, type Account, emptyAccount, TOKEN } from "../../support/fake-install";
import { worldOf } from "../../support/fake-reach";

/** The token, in the form the provider takes. */
const KEY = installer.token(TOKEN) as Token;

/** The two kinds of install: where each is, and what a person types to remove it. */
const KINDS = {
  domain: { where: placeOf("domain", "example.com"), confirm: "poplin.example.com" },
  "no-domain": { where: placeOf("no-domain", true), confirm: "poplin.example.workers.dev" },
} as const;

/** A dry run, and a run that removes everything once the install's address was typed. */
const DRY: Removal = { run: "dry-run", data: "remove" };

/** What both kinds end with: the login, the alert, the keys, the Workflow, the Worker, and the data, then the token, which stays. */
const SHARED = [
  "Access application | remove | poplin open paths, poplin",
  "Access policy | remove | poplin open paths policy, poplin logins",
  "Budget alert | remove | poplin: usage charges reached 1 dollar",
  "Key | remove | poplin kept key",
  "Upload key | remove | poplin upload key",
  "Workflow | remove | poplin-jobs",
  "Worker | remove | poplin",
  "Sites' files | remove | poplin-sites (files: 2, 15 B) | 2 | 15",
  "Database | remove | poplin (sites: 3) | 3",
  "Account token | stay | delete it at Cloudflare: https://dash.cloudflare.com/profile/api-tokens",
];

/** Every row of a removal of each kind, in the order removed, with what each holds where that is counted. */
const ROWS: Readonly<Record<Kind, readonly string[]>> = {
  domain: [
    "Worker route | remove | *-poplin.example.com/*, *-page.example.com/*, poplin.example.com/*",
    "DNS record | remove | *.example.com, poplin.example.com",
    "Redirect rule | remove | poplin_https",
    "Redirect ruleset | remove | poplin redirect rule",
    "WAF rule | remove | poplin_outside_pages, poplin_bots",
    "WAF ruleset | remove | poplin guard rules",
    "Rate rule | remove | poplin_rate",
    "Rate ruleset | remove | poplin rate rule",
    ...SHARED.slice(0, 3),
    "Certificate alert | remove | poplin: certificates of every domain of the account",
    ...SHARED.slice(3, -1),
    "Bot settings | stay | the domain's AI crawler block and Bot Fight Mode are settings of the domain, and stay as they are set",
    ...SHARED.slice(-1),
  ],
  "no-domain": ["Forwarder | remove | poplin-sites, poplin-private", ...SHARED],
};

/** The calls each kind sends, pinned: for a dry run, and for a run, with how many of the run's remove something. */
const CALLS: Readonly<Record<Kind, { readonly dry: number; readonly run: number; readonly removals: number }>> = {
  domain: { dry: 23, run: 49, removals: 26 },
  "no-domain": { dry: 16, run: 31, removals: 15 },
};

/** The calls a dry run sends over data that was left behind, before the count of the sites a database of poplin's holds. */
const LEFT_CALLS: Readonly<Record<Kind, number>> = { domain: 18, "no-domain": 12 };

/** An account that holds nothing. */
const NOTHING = { records: 0, routes: 0, rules: 0, rulesets: 0, applications: 0, policies: 0, alerts: 0, tokens: 0, workflows: 0, workers: 0, worker: false, buckets: 0, objects: 0, databases: 0 };

/** A kind of install. */
type Kind = keyof typeof KINDS;

/** What one find and one removal left behind: what it came to and told on the way, what was found, and every call the removal sent, with the ones that are no read. */
interface Outcome {
  readonly done: Removed;
  readonly found: Found<Where, Place>["state"];
  readonly calls: number;
  readonly writes: string[];
  readonly said: string[];
}

/** Read a place from one option a test wrote by hand. */
function placeOf(flag: string, value: string | true): Where {
  const read = installer.read({ flags: new Map([[flag, value]]), env: {} });
  if (!read.ok) throw new Error(`the test's place was refused: ${JSON.stringify(read)}`);

  return read.where;
}

/** A run that removes, with what was typed and whether the data goes too. */
function applyOf(confirmed: string, data: "remove" | "keep" = "remove"): Removal {
  return { run: "apply", confirmed, data };
}

/** An account an install of the kind was made in, whose bucket holds two files and whose database three sites. */
async function installedAccount(kind: Kind, changes: Partial<Account> = {}): Promise<Account> {
  const account: Account = { ...emptyAccount(), bindings: [], noWorker: true };
  const world = await worldOf(account);
  const login = parseLogin("owner@example.com");
  const found = await installer.find(KEY, KINDS[kind].where, world.reach, "install");
  if (!login.ok || found.state !== "none") throw new Error(`the test's install could not start: ${found.state}`);

  const made = await installer.install(found, KINDS[kind].where, login.value, "apply", world.reach, () => undefined);
  if (!made.ok || !made.ready) throw new Error(`the test's install was not made: ${JSON.stringify(made)}`);

  return Object.assign(account, { objects: [{ key: "a/index.html", size: 10 }, { key: "b.css", size: 5 }], sites: 3 }, changes);
}

/** What a removal can start from; a test that finds anything else has made a mistake. */
function removable(found: Found<Where, Place>): Removable<Place> {
  if (found.state !== "whole" && found.state !== "started" && found.state !== "leftover" && found.state !== "none") throw new Error(`nothing to remove: ${found.state}`);

  return found;
}

function shown(done: Removed): string[] {
  if (!done.ok) return [`not run: ${done.why}`];

  return done.rows.map((row) => {
    const held = [row.count, row.bytes].filter((amount) => amount !== undefined);

    return [row.object, row.state, row.detail, ...held].join(" | ");
  });
}

/** Find, then remove, in one stand-in world. A question to the database is a read sent as a POST. */
async function removed(account: Account, kind: Kind, removal: Removal, where: Where = KINDS[kind].where): Promise<Outcome> {
  const world = await worldOf(account);
  const found = await installer.find(KEY, where, world.reach, "remove");
  const sought = world.asked.length;
  const said: string[] = [];
  const done = await installer.remove(removable(found), where, removal, world.reach, (row) => said.push(`${row.object} | ${row.state}`));
  const sent = world.asked.slice(sought);
  const writes = sent.filter((entry) => entry.method !== "GET" && !entry.path.endsWith("/query")).map((entry) => `${entry.method} ${entry.path}`);

  return { done, found: found.state, calls: sent.length, writes, said };
}

/** What of poplin's an account still holds, by kind of object. */
function left(account: Account): Record<string, number | boolean> {
  return {
    records: account.records.length,
    routes: account.routes.length,
    rules: Object.values(account.rulesets).reduce((sum, ruleset) => sum + (ruleset?.rules.length ?? 0), 0),
    rulesets: Object.values(account.rulesets).filter((ruleset) => ruleset !== undefined).length,
    applications: account.applications.length,
    policies: account.policies.length,
    alerts: account.alerts.length,
    tokens: account.tokens.length,
    workflows: account.workflows.length,
    workers: account.workers.length,
    worker: account.noWorker !== true,
    buckets: account.buckets.length,
    objects: account.objects.length,
    databases: account.databases.length,
  };
}

/** Answer one call as Cloudflare does for an object that is no longer there. */
function gone(account: Account, call: string): void {
  Object.assign(account, { refuse: call, refuseAs: { status: 404, code: 10007 } });
}

/** Bind the install's Worker to another object under one of its names. */
function rebound(account: Account, name: string, to: Record<string, string>): void {
  Object.assign(account.bindings.find((binding) => binding.name === name) ?? {}, to);
}

describe.each(Object.keys(KINDS) as Kind[])("an install is removed, %s", (kind) => {
  // Drift: a dry run that lists a kind another way than the run removes it would promise a list no run works through, and a removal that misses a kind leaves it at Cloudflare for good.
  test("a dry run lists every kind with what the data holds and removes nothing; the run after it removes the same rows in the same order, and leaves the account as it was before the install", async () => {
    const account = await installedAccount(kind);
    const before = structuredClone(account);
    const dry = await removed(account, kind, DRY);

    expect([shown(dry.done), dry.writes, account, dry.calls]).toEqual([[...ROWS[kind]], [], before, CALLS[kind].dry]);
    expect(dry.done).toMatchObject({ ok: true, ready: true, blocked: [], confirm: KINDS[kind].confirm });

    const run = await removed(account, kind, applyOf(KINDS[kind].confirm));

    expect([shown(run.done), run.said, run.done.ok && run.done.ready]).toEqual([[...ROWS[kind]], ROWS[kind].map((row) => row.split(" | ").slice(0, 2).join(" | ")), true]);
    expect([left(account), run.calls, run.writes.length, run.writes.every((call) => call.startsWith("DELETE "))]).toEqual([NOTHING, CALLS[kind].run, CALLS[kind].removals, true]);
  });

  // Drift: the files and the records are what a person cannot get back, so a run told to keep them must leave both whole, and a later run must still find and remove them.
  test("a run told to keep the data leaves the bucket with its files and the database; the run after it finds them left behind, takes the bucket's name as proof, and removes both; then nothing is found", async () => {
    const account = await installedAccount(kind);
    const kept = await removed(account, kind, applyOf(KINDS[kind].confirm, "keep"));

    expect([shown(kept.done).filter((row) => row.includes(" | keep | ")), kept.done.ok && kept.done.ready]).toEqual([["Sites' files | keep | poplin-sites", "Database | keep | poplin"], true]);
    expect(left(account)).toEqual({ ...NOTHING, buckets: 1, objects: 2, databases: 1 });

    const still = await removed(account, kind, applyOf("poplin-sites", "keep"));
    const byName = ["Sites' files | keep | poplin-sites (matched by its name alone)", "Database | keep | poplin (matched by its name alone)"];

    expect([shown(still.done).slice(0, 2), left(account)]).toEqual([byName, { ...NOTHING, buckets: 1, objects: 2, databases: 1 }]);

    const again = await removed(account, kind, applyOf("poplin-sites"));
    const data = ["Sites' files | remove | poplin-sites (files: 2, 15 B; matched by its name alone) | 2 | 15", "Database | remove | poplin (sites: 3; matched by its name alone; poplin's by its schema steps) | 3"];

    expect([again.found, shown(again.done).slice(0, 2), again.done.ok && again.done.confirm, left(account)]).toEqual(["leftover", data, "poplin-sites", NOTHING]);
    expect((await removed(account, kind, DRY)).found).toBe("none");
  });

  // Drift: a dry run once knew nothing of what a run keeps, so the list a person reads before the removal said their sites' files and records would go.
  test("a dry run told to keep the data lists the bucket and the database as kept, with what they hold, sends no change, and every other row is the row of a dry run that keeps nothing", async () => {
    const account = await installedAccount(kind);
    const dry = await removed(account, kind, { run: "dry-run", data: "keep" });
    const kept = ["Sites' files | keep | poplin-sites (files: 2, 15 B) | 2 | 15", "Database | keep | poplin (sites: 3) | 3"];

    expect([shown(dry.done), dry.writes]).toEqual([ROWS[kind].map((row) => kept.find((one) => one.split(" | ")[0] === row.split(" | ")[0]) ?? row), []]);
    expect(dry.done).toMatchObject({ ok: true, ready: true });
  });

  // Drift: a run that keeps the data never reads what the bucket holds, and its dry run does, to count it. A dry run that failed on that read said not ready of a run that goes through.
  test("a dry run told to keep the data, where what the bucket holds cannot be read, lists the bucket as kept with no count and is ready, as the run after it is", async () => {
    const account = await installedAccount(kind, { refuse: `GET /accounts/${ACCOUNT}/r2/buckets/poplin-sites/objects`, refuseAs: { status: 500, code: 10001 } });
    const dry = await removed(account, kind, { run: "dry-run", data: "keep" });
    const run = await removed(account, kind, applyOf(KINDS[kind].confirm, "keep"));
    const files = (done: Removed): string[] => shown(done).filter((row) => row.startsWith("Sites' files"));

    expect([files(dry.done), dry.done.ok && dry.done.ready, files(run.done), run.done.ok && run.done.ready]).toEqual([["Sites' files | keep | poplin-sites"], true, ["Sites' files | keep | poplin-sites"], true]);
  });

  // Drift: with no Worker, a database is poplin's by its name alone, and the name is a common one. One that holds tables and none of poplin's schema steps is somebody else's records, which no run may delete.
  test.each([
    ["tables that are not poplin's", { tables: ["invoices"] }, "Database | skip | poplin: matched by its name alone, and it holds tables that are not poplin's: it stays", { databases: 1, counted: 0, ready: true }],
    ["no table", { tables: [] }, "Database | remove | poplin (empty; matched by its name alone)", { databases: 0, counted: 0, ready: true }],
    ["poplin's schema steps", {}, "Database | remove | poplin (sites: 3; matched by its name alone; poplin's by its schema steps) | 3", { databases: 0, counted: 1, ready: true }],
    ["an answer that is no list of tables", { tables: "failed" }, "Database | fail | no answer from Cloudflare", { databases: 1, counted: 0, ready: false }],
  ] as const)("a database of poplin's name with no Worker, holding %s: the dry run and the run say which, and only poplin's or an empty one goes", async (_holds, holds, row, { databases, counted, ready }) => {
    const account = await installedAccount(kind);
    await removed(account, kind, applyOf(KINDS[kind].confirm, "keep"));
    Object.assign(account, holds);

    const dry = await removed(account, kind, DRY);
    const run = await removed(account, kind, applyOf("poplin-sites"));
    const files = "Sites' files | remove | poplin-sites (files: 2, 15 B; matched by its name alone) | 2 | 15";

    expect([dry.found, shown(dry.done).slice(0, 2), dry.writes, dry.calls]).toEqual(["leftover", [files, row], [], LEFT_CALLS[kind] + counted]);
    expect([shown(run.done).slice(0, 2), run.done.ok && run.done.ready, left(account)]).toEqual([[files, row], ready, { ...NOTHING, databases }]);
  });

  // Drift: an account holds other people's work beside poplin's. A removal that went by kind, and not by poplin's names and marks, would take it; and a ruleset poplin made goes whole only while nothing but poplin's rules is in it.
  test("an object of each kind that is not poplin's stays: a record, a route, a rule with the ruleset it is in, an application, a policy, an alert, a token, a Workflow, a Worker, a bucket, and a database", async () => {
    const account = await installedAccount(kind);
    account.records.push({ id: "record-x", name: "www.example.com", comment: "the shop" });
    account.routes.push({ id: "route-x", pattern: "example.com/*", script: "shop" });
    for (const ruleset of Object.values(account.rulesets)) ruleset?.rules.push({ id: "rule-x", ref: "shop_rule" });

    account.applications.push({ id: "application-x", name: "wiki" });
    account.policies.push({ id: "policy-x", name: "wiki logins" });
    account.alerts.push({ id: "alert-x", name: "the shop is down" });
    account.tokens.push({ id: "token-x", name: "deploy key", status: "active" });
    account.workflows.push({ name: "shop-jobs", script_name: "shop" });
    account.workers.push({ id: "shop", tags: [] });
    account.buckets.push({ name: "photos" });
    account.databases.push({ uuid: "database-x", name: "shop" });
    const strangers = { ...NOTHING, records: 1, routes: 1, rules: kind === "domain" ? 3 : 0, rulesets: kind === "domain" ? 3 : 0, applications: 1, policies: 1, alerts: 1, tokens: 1, workflows: 1, workers: 1, buckets: 1, databases: 1 };
    const kept = ["Redirect ruleset | stay | poplin redirect rule", "WAF ruleset | stay | poplin guard rules", "Rate ruleset | stay | poplin rate rule"].map((row) => `${row}: it holds rules that are not poplin's, and stays`);
    const run = await removed(account, kind, applyOf(KINDS[kind].confirm));

    expect([run.done.ok && run.done.ready, shown(run.done).filter((row) => row.includes(" | skip | ")), left(account)]).toEqual([true, [], strangers]);
    expect(shown(run.done).filter((row) => row.includes("ruleset | "))).toEqual(kind === "domain" ? kept : []);
  });

  // Drift: an install that was started and never set has no address, and one whose removal stopped half-way may have lost its Worker: each must still be removable, by a name a person can type.
  test("an install that was never finished is removed under the Worker's name with the account's; and what a removal that lost Cloudflare half-way left is removed by the run after it", async () => {
    const started = await installedAccount(kind);
    started.bindings = started.bindings.filter((binding) => binding.name !== "ZONE");
    const first = await removed(started, kind, applyOf(`poplin@${ACCOUNT}`));

    expect([first.found, first.done.ok && first.done.confirm, first.done.ok && first.done.ready, left(started)]).toEqual(["started", `poplin@${ACCOUNT}`, true, NOTHING]);

    const account = await installedAccount(kind, { refuse: `DELETE /accounts/${ACCOUNT}/workflows/poplin-jobs`, refuseAs: { status: 400, code: 7000 } });
    const stopped = await removed(account, kind, applyOf(KINDS[kind].confirm));

    expect([shown(stopped.done).filter((row) => row.includes(" | fail | ")), stopped.done.ok && stopped.done.ready, left(account)]).toEqual([["Workflow | fail | refused with status 400"], false, { ...NOTHING, workflows: 1 }]);

    delete account.refuse;
    const again = await removed(account, kind, applyOf(`poplin@${ACCOUNT}`));

    expect([again.found, shown(again.done)[0], again.done.ok && again.done.ready, left(account)]).toEqual(["none", "Workflow | remove | poplin-jobs", true, NOTHING]);
  });

  // Drift: a removal on the wrong account, or by a script gone wrong, is the worst a person can meet here. The typed name is the one proof, so it is compared where the removal is done.
  test("a run whose typed name is another install's removes nothing and sends no change; the address is taken with its scheme, a slash after it, and capitals", async () => {
    const account = await installedAccount(kind);
    const before = structuredClone(account);
    const wrong = await removed(account, kind, applyOf("poplin.example.org"));

    expect([wrong.done, wrong.writes, account]).toEqual([{ ok: false, why: "not_confirmed", words: `What was typed is not this install's: this install is ${KINDS[kind].confirm}. Nothing was removed.` }, [], before]);

    const typed = await removed(account, kind, applyOf(` HTTPS://${KINDS[kind].confirm.toUpperCase()}/ `));

    expect([typed.done.ok && typed.done.ready, left(account)]).toEqual([true, NOTHING]);
  });

  // Drift: the objects that point at the Worker differ by kind, so a removal told the other kind would leave them: it must refuse, and say which option names the install.
  test("an install of the other kind than the place names is refused whole, and nothing is removed", async () => {
    const account = await installedAccount(kind);
    const before = structuredClone(account);
    const other = kind === "domain" ? "no-domain" : "domain";
    const refused = await removed(account, kind, DRY, KINDS[other].where);

    expect([refused.done.ok, refused.done.ok ? "" : refused.done.why, refused.writes, account]).toEqual([false, "other_place", [], before]);
  });

  // Drift: a token that may not touch one kind must not stop the rest, the row must name the permission to add, and nothing Cloudflare said, which may repeat the token, may reach a row.
  test.each([
    ["the account's tokens", `GET /accounts/${ACCOUNT}/tokens`, ["Key | block", "Upload key | block"], ["Account API Tokens: Edit"], { tokens: 2 }],
    ["the Worker", `DELETE /accounts/${ACCOUNT}/workers/scripts/poplin`, ["Worker | block", "Sites' files | not-run", "Database | not-run"], ["Workers Scripts: Edit"], { worker: true, buckets: 1, objects: 2, databases: 1 }],
    ["the bucket's objects", `DELETE /accounts/${ACCOUNT}/r2/buckets/poplin-sites/objects/*`, ["Sites' files | block"], ["Workers R2 Storage: Edit"], { buckets: 1, objects: 2 }],
    ["the Access applications", `DELETE /accounts/${ACCOUNT}/access/apps/*`, ["Access application | block", "Access policy | not-run"], ["Access: Apps and Policies: Edit"], { applications: 2, policies: 2 }],
  ])("a token that may not touch %s leaves that row blocked with the permission to add, removes the rest, and no row holds the token", async (_what, refuse, undone, rights, stays) => {
    const account = await installedAccount(kind, { refuse });
    const run = await removed(account, kind, applyOf(KINDS[kind].confirm));
    const rows = run.done.ok ? run.done.rows.filter((row) => ["block", "fail", "not-run"].includes(row.state)).map((row) => `${row.object} | ${row.state}`) : [];

    expect([rows, run.done.ok && run.done.ready, run.done.ok && run.done.blocked.map((block) => (block.what === "right_lacking" ? block.right : block.what)), left(account)]).toEqual([undone, false, rights, { ...NOTHING, ...stays }]);
    expect(JSON.stringify(run.done).includes(TOKEN)).toBe(false);
  });

  // Drift: a Worker bound to another bucket or database does not own the ones of poplin's names, and an object deleted by hand while a run goes on is no failure.
  test.each([
    ["the Worker's bucket is another", (account: Account) => rebound(account, "SITES", { bucket_name: "photos" }), "Sites' files | skip | poplin-sites: not this install's: the Worker is bound to another", { buckets: 1, objects: 2 }],
    ["the Worker's database is another", (account: Account) => rebound(account, "DB", { id: "database-x" }), "Database | skip | poplin: not this install's: the Worker is bound to another", { databases: 1 }],
    ["the Workflow of the name runs another Worker", (account: Account) => Object.assign(account.workflows[0] ?? {}, { script_name: "shop" }), "Workflow | skip | poplin-jobs: it runs the Worker shop, which is not poplin's", { workflows: 1 }],
    ["the bucket is gone when the run reaches it", (account: Account) => gone(account, `GET /accounts/${ACCOUNT}/r2/buckets/poplin-sites/objects`), "Sites' files | gone | poplin-sites", { buckets: 1, objects: 2 }],
    ["the Workflow is gone when the run reaches it", (account: Account) => gone(account, `DELETE /accounts/${ACCOUNT}/workflows/poplin-jobs`), "Workflow | gone | poplin-jobs", { workflows: 1 }],
  ])("where %s, its row says so, it stays, and the run is done", async (_what, change, row, stays) => {
    const account = await installedAccount(kind);
    change(account);
    const run = await removed(account, kind, applyOf(KINDS[kind].confirm));

    expect([shown(run.done).filter((line) => line.startsWith(row.slice(0, row.indexOf(" | ")))).map((line) => line.split(" | ").slice(0, 3).join(" | ")), run.done.ok && run.done.ready, left(account)]).toEqual([[row], true, { ...NOTHING, ...stays }]);
  });

  // Drift: a Repair makes an alert only with an optional permission, so a token without it can neither list nor remove one: that is no failure of the removal. An install under a domain has two alerts, and one without has one.
  test("a token without the alerts' optional permission leaves each alert of the kind as a row that stays, names the permission, and the run is done", async () => {
    const account = await installedAccount(kind, { refuse: `GET /accounts/${ACCOUNT}/alerting/v3/policies` });
    const run = await removed(account, kind, applyOf(KINDS[kind].confirm));
    const stays = run.done.ok ? run.done.rows.filter((row) => row.right !== undefined).map((row) => `${row.object} | ${row.state} | ${row.right}`) : [];

    const alerts = kind === "domain" ? ["Budget alert", "Certificate alert"] : ["Budget alert"];

    expect([stays, run.done.ok && run.done.ready, run.done.ok && run.done.blocked, left(account)]).toEqual([alerts.map((alert) => `${alert} | stay | Notifications: Edit`), true, [], { ...NOTHING, alerts: alerts.length }]);
  });
});

describe("an account that changed between the look and the removal", () => {
  // Drift: a person reads the list and types the address, and that takes time. What the look found is then no proof of what stands.
  test.each<[string, Kind, (account: Account) => void]>([
    ["the install's Worker was replaced by one that is not poplin's", "domain", (account) => Object.assign(account, { bindings: [{ name: "SHOP", type: "plain_text", text: "shop" }] })],
    ["the install's Worker went", "no-domain", (account) => Object.assign(account, { noWorker: true, bindings: [] })],
  ])("where %s, nothing is removed and the run says to look again", async (_what, kind, change) => {
    const account = await installedAccount(kind);
    const world = await worldOf(account);
    const found = removable(await installer.find(KEY, KINDS[kind].where, world.reach, "remove"));
    change(account);
    const before = structuredClone(account);
    const sought = world.asked.length;
    const done = await installer.remove(found, KINDS[kind].where, applyOf(KINDS[kind].confirm), world.reach, () => undefined);

    expect([done, world.asked.slice(sought).filter((entry) => entry.method !== "GET"), account]).toEqual([{ ok: false, why: "changed", words: "The account changed since it was looked at. Run this again. Nothing was removed." }, [], before]);
  });

  test("where a Worker came to an account whose data was left behind, the data stays", async () => {
    const account = await installedAccount("no-domain");
    await removed(account, "no-domain", applyOf(KINDS["no-domain"].confirm, "keep"));
    const world = await worldOf(account);
    const found = removable(await installer.find(KEY, KINDS["no-domain"].where, world.reach, "remove"));
    Object.assign(account, { noWorker: false, bindings: [{ name: "SHOP", type: "plain_text", text: "shop" }] });
    const done = await installer.remove(found, KINDS["no-domain"].where, applyOf("poplin-sites"), world.reach, () => undefined);

    expect([found.state, done.ok ? "" : done.why, left(account)]).toEqual(["leftover", "changed", { ...NOTHING, worker: true, buckets: 1, objects: 2, databases: 1 }]);
  });
});

describe("what one kind alone has", () => {
  // Drift: a rule is made only by a token with an optional permission, so a token without it can neither list nor remove it: that is no failure of the removal.
  test("with a domain, a token without a rule's optional permission leaves that row as one that stays, names the permission, and the run is done", async () => {
    const account = await installedAccount("domain", { refuse: "GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint" });
    const run = await removed(account, "domain", applyOf(KINDS.domain.confirm));
    const stays = run.done.ok ? run.done.rows.filter((row) => row.right !== undefined).map((row) => `${row.object} | ${row.state} | ${row.right}`) : [];

    expect([stays, run.done.ok && run.done.ready, run.done.ok && run.done.blocked, left(account)]).toEqual([["WAF rule | stay | Zone WAF: Edit"], true, [], { ...NOTHING, rules: 2, rulesets: 1 }]);
  });

  // Drift: where the zone had rules of its own in a phase, poplin's rule went into the zone's ruleset. Only the name tells that ruleset from one poplin made, so one of another name must stay even when poplin's rule was the last in it.
  test("with a domain, a ruleset that is not under poplin's name is the zone's: poplin's rules go from it, and it stays with no row, empty as it then is", async () => {
    const account = await installedAccount("domain");
    for (const ruleset of Object.values(account.rulesets)) Object.assign(ruleset ?? {}, { name: "default" });

    const run = await removed(account, "domain", applyOf(KINDS.domain.confirm));

    expect([shown(run.done).filter((row) => row.includes("ruleset | ")), run.done.ok && run.done.ready, left(account)]).toEqual([[], true, { ...NOTHING, rulesets: 3 }]);
  });

  // Drift: a removal that took the rules and left their rulesets reported itself done, so an account can hold the three with no rule and no Worker: the run after must still find and take them.
  test("with a domain, the empty rulesets of poplin's names that stand with nothing else of the install are removed", async () => {
    const account = await installedAccount("domain");
    await removed(account, "domain", applyOf(KINDS.domain.confirm));
    account.rulesets = {
      http_request_dynamic_redirect: { id: "set-a", name: "poplin redirect rule", rules: [] },
      http_request_firewall_custom: { id: "set-b", name: "poplin guard rules", rules: [] },
      http_ratelimit: { id: "set-c", name: "poplin rate rule", rules: [] },
    };
    const again = await removed(account, "domain", applyOf(`poplin@${ACCOUNT}`));
    const rows = ["Redirect ruleset | remove | poplin redirect rule", "WAF ruleset | remove | poplin guard rules", "Rate ruleset | remove | poplin rate rule"];

    expect([again.found, shown(again.done).slice(0, 3), again.done.ok && again.done.ready, left(account)]).toEqual(["none", rows, true, NOTHING]);
  });

  // Drift: the ruleset goes by a call of its own after its rules, so that call can be refused or find nothing where the rules' calls did not: the row must say which, and name the permission.
  test.each([
    ["a token that may not remove it", { status: 403, code: 10000 }, "Rate ruleset | block | the token lacks a permission. Add this one: Zone WAF: Edit", false],
    ["one that went before the run reached it", { status: 404, code: 10003 }, "Rate ruleset | gone | poplin rate rule", true],
  ])("with a domain, a ruleset's removal answered as for %s leaves its row saying so, and the rest is removed", async (_what, refuseAs, row, ready) => {
    const account = await installedAccount("domain", { refuse: "DELETE /zones/zone-1/rulesets/set-http_ratelimit", refuseAs });
    const run = await removed(account, "domain", applyOf(KINDS.domain.confirm));

    expect([shown(run.done).filter((line) => line.startsWith("Rate ruleset")), run.done.ok && run.done.ready, left(account)]).toEqual([[row], ready, { ...NOTHING, rulesets: 1 }]);
  });

  // Drift: the forwarders' names hold nothing of the account, and the install says where it answers. An account whose free address was renamed or taken away must still lose its install, forwarders and all.
  test("without a domain, an install whose account no longer has the free address it was made under is removed whole", async () => {
    const account = await installedAccount("no-domain", { noFreeAddress: true });
    const run = await removed(account, "no-domain", applyOf(KINDS["no-domain"].confirm));

    expect([shown(run.done)[0], run.done.ok && run.done.ready, left(account)]).toEqual(["Forwarder | remove | poplin-sites, poplin-private", true, NOTHING]);
  });

  // Drift: a forwarder deleted by hand while the run goes on is gone, which must not keep its sibling from going.
  test("without a domain, a forwarder that went between the list and its removal is no failure, and the other goes too", async () => {
    const account = await installedAccount("no-domain");
    gone(account, `DELETE /accounts/${ACCOUNT}/workers/scripts/poplin-sites`);
    const run = await removed(account, "no-domain", applyOf(KINDS["no-domain"].confirm));

    expect([shown(run.done)[0], run.done.ok && run.done.ready, left(account)]).toEqual(["Forwarder | remove | poplin-sites, poplin-private", true, { ...NOTHING, workers: 1 }]);
  });

  // Drift: a Worker of a forwarder's name that lost poplin's tag is somebody's own by the only mark there is.
  test("without a domain, a Worker of a forwarder's name without poplin's tag stays, and its row says so", async () => {
    const account = await installedAccount("no-domain");
    Object.assign(account.workers.find((worker) => worker.id === "poplin-sites") ?? {}, { tags: [] });
    const run = await removed(account, "no-domain", applyOf(KINDS["no-domain"].confirm));

    const rows = ["Forwarder | remove | poplin-private", "Forwarder | skip | poplin-sites: a Worker of this name is not poplin's, and stays"];

    expect([shown(run.done).slice(0, 2), run.done.ok && run.done.ready, left(account)]).toEqual([rows, true, { ...NOTHING, workers: 1 }]);
  });
});
