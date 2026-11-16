// A whole install against an account at the fake API, a release published from the repository's own Worker configuration, and an install that answers.
// Without these a dry run could promise what a run does not make, a first upload could lose a binding, a run that stopped could not be run again, or one kind of install could gain a piece the other lacks.

import { describe, expect, test } from "bun:test";
import { type Login, parseLogin } from "@poplin/core/src/auth/logins";
import type { Found, Installed, Run, Startable, Token } from "@poplin/core/src/install/installer";
import type { Place, Where } from "../../../../src/shared/install/first/find";
import { installer } from "../../../../src/shared/install/first/installer";
import { ACCOUNT, type Account, emptyAccount, KEY_VALUE_START, TOKEN } from "../support/fake-install";
import { RELEASE, worldOf } from "../support/fake-reach";

/** The first login of every install here. */
const LOGIN = loginOf("owner@example.com");

/** The token, in the form the provider takes. */
const KEY = tokenOf(TOKEN);

/** The two kinds of install: where each goes, and the dashboard's address. */
const KINDS = {
  domain: { where: placeOf({ flags: [["domain", "example.com"]] }), address: "https://poplin.example.com" },
  "no-domain": { where: placeOf({ flags: [["no-domain", true]] }), address: "https://poplin.example.workers.dev" },
} as const;

/** A dry run, and a run. */
const [DRY, APPLY]: readonly [Run, Run] = ["dry-run", "apply"];

/** The Worker's own pieces of a new install, which both kinds start with. */
const OWN = ["R2 bucket | make | poplin-sites", "D1 database | make | poplin", `Worker | make | poplin, runs ${RELEASE}`, "Sweep trigger | make | */15 * * * *"];

/** The login, the variables, and the keys, which both kinds make alike; `host` and `sites` are what the login stands in front of. */
function shared(host: string, sites: string): string[] {
  return [
    `Access application | make | poplin: ${host}, ${sites}`,
    "Access policy | make | poplin logins",
    `Access open paths | make | poplin open paths: ${host}/api, ${host}/setup`,
    "Access open paths | make | poplin open paths policy",
    "Worker variable | make | ACCESS",
    "Worker variable | make | ACCOUNT_ID",
    "Worker variable | make | FIRST_SETTINGS",
    "Worker variable | make | ZONE",
    "Key | make | poplin kept key",
    "Upload key | make | poplin upload key",
  ];
}

/** Every row of a new install of each kind, in the order of the work. */
const ROWS: Readonly<Record<keyof typeof KINDS, readonly string[]>> = {
  domain: [
    ...OWN,
    "Worker address | make | off: the install answers under its domain",
    "Public word | leave | page (public sites answer at <name>-page.example.com)",
    "DNS record | make | *.example.com",
    "DNS record | make | poplin.example.com",
    "Worker route | make | *-page.example.com/*",
    "Worker route | make | *-poplin.example.com/*",
    "Worker route | make | poplin.example.com/*",
    ...shared("poplin.example.com", "*-p-poplin.example.com"),
    "Redirect rule | make | https redirect",
    "WAF rule | make | bots rule: also stops every method but GET and HEAD, and the paths *.php, /.env, /.env.*, /.git/, /wp-admin/, /cgi-bin/, /phpmyadmin",
    "WAF rule | make | outside pages rule",
    "Rate rule | make | rate rule",
    "Bot settings | change | zone bot switches",
    "Budget alert | make | poplin: usage charges reached 1 dollar",
    "Workflow | make | poplin-jobs",
  ],
  "no-domain": [
    ...OWN,
    "Worker address | make | on: poplin.example.workers.dev",
    "Forwarder | make | poplin-private: https://poplin-private.example.workers.dev (private sites)",
    "Forwarder | make | poplin-sites: https://poplin-sites.example.workers.dev (unlisted and public sites)",
    ...shared("poplin.example.workers.dev", "poplin-private.example.workers.dev"),
    "Budget alert | make | poplin: usage charges reached 1 dollar",
    "Workflow | make | poplin-jobs",
  ],
};

/** The calls each kind sends, pinned: to find an install, for a dry run, and for a run, with how many of the run's change something. */
const CALLS: Readonly<Record<keyof typeof KINDS, { readonly find: number; readonly dry: number; readonly run: number; readonly writes: number }>> = {
  domain: { find: 6, dry: 19, run: 48, writes: 23 },
  "no-domain": { find: 6, dry: 13, run: 37, writes: 18 },
};

function loginOf(text: string): Login {
  const login = parseLogin(text);
  if (!login.ok) throw new Error(`the test's login was refused: ${login.refusal}`);

  return login.value;
}

function tokenOf(text: string): Token {
  const token = installer.token(text);
  if (token === undefined) throw new Error("the test's token was refused");

  return token;
}

/** Read a place from options and variables a test wrote by hand; a refusal is a mistake in the test. */
function placeOf(given: { readonly flags?: readonly (readonly [string, string | true])[]; readonly env?: Readonly<Record<string, string>> }): Where {
  const read = installer.read({ flags: new Map(given.flags ?? []), env: given.env ?? {} });
  if (!read.ok) throw new Error(`the test's place was refused: ${JSON.stringify(read)}`);

  return read.where;
}

/** An account with nothing of poplin's in it, and no Worker. */
function fresh(changes: Partial<Account> = {}): Account {
  return { ...emptyAccount(), bindings: [], noWorker: true, ...changes };
}

function shown(done: Installed): string[] {
  if (!done.ok) return [`not run: ${done.why}`];

  return done.rows.map((row) => `${row.object} | ${row.state} | ${row.detail}`);
}

/** What a run can go on from; a test that finds anything else has made a mistake. */
function startable(found: Found<Where, Place>): Startable<Place> {
  if (found.state === "leftover") return { ...found, state: "adopted" };

  if (found.state !== "none" && found.state !== "started") throw new Error(`nothing to go on from: ${found.state}`);

  return found;
}

/** What one find and one run left behind: what was found, what the run came to and told on the way, and every call of each. */
interface Outcome {
  readonly done: Installed;
  readonly found: Found<Where, Place>;
  readonly calls: { readonly find: number; readonly run: number; readonly writes: string[] };
  readonly world: Awaited<ReturnType<typeof worldOf>>;
  readonly said: string[];
}

/** Find, then run, in one stand-in world. */
async function installed(account: Account, kind: keyof typeof KINDS, run: Run, meets: Parameters<typeof worldOf>[1] = {}): Promise<Outcome> {
  const world = await worldOf(account, meets);
  const { where } = KINDS[kind];
  const found = await installer.find(KEY, where, world.reach);
  const sought = world.asked.length;
  const said: string[] = [];
  const done = await installer.install(startable(found), where, LOGIN, run, world.reach, (row) => said.push(`${row.object} | ${row.state} | ${row.detail}`));
  const sent = world.asked.slice(sought);

  return { done, found, world, said, calls: { find: sought, run: sent.length, writes: sent.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`) } };
}

describe.each(Object.keys(KINDS) as (keyof typeof KINDS)[])("a new install, %s", (kind) => {
  // Drift: a dry run that reads a piece another way than the run makes it would promise a list no run works through.
  test("a dry run lists the rows the run after it works through, the same objects in the same order, sends no change, and both send the pinned number of calls", async () => {
    const account = fresh();
    const before = structuredClone(account);
    const dry = await installed(account, kind, DRY);

    expect([shown(dry.done), dry.calls, account]).toEqual([[...ROWS[kind]], { find: CALLS[kind].find, run: CALLS[kind].dry, writes: [] }, before]);

    const run = await installed(account, kind, APPLY);

    expect(run.done.ok && dry.done.ok ? [run.done.rows, run.said] : []).toEqual(dry.done.ok ? [dry.done.rows, [...ROWS[kind]]] : []);
    expect([run.calls.find, run.calls.run, run.calls.writes.length]).toEqual([CALLS[kind].find, CALLS[kind].run, CALLS[kind].writes]);
    expect(run.done).toMatchObject({ ok: true, ready: true, blocked: [], release: RELEASE, address: KINDS[kind].address, proof: "reads" });
    expect(dry.done).toMatchObject({ ok: true, ready: true, blocked: [], release: RELEASE, address: KINDS[kind].address });
  });

  // Drift: a first upload has nothing to inherit, so a binding left out of it is one the Worker starts without, and one named `inherit` is refused.
  test("the first upload states the bucket, the database by its id, the Workflow, the Worker's own name, and the limiter, inherits nothing, and carries the release's version; the Worker then holds every variable and both keys", async () => {
    const account = fresh();
    const { calls } = await installed(account, kind, APPLY);
    const [upload] = account.uploads as { metadata: { bindings: unknown[]; annotations: unknown; main_module: string }; files: string[] }[];

    expect(calls.writes.filter((call) => call.includes("/workers/scripts/poplin"))[0]).toBe(`PUT /accounts/${ACCOUNT}/workers/scripts/poplin`);
    expect([account.uploads.length, upload?.files, upload?.metadata.main_module, upload?.metadata.annotations]).toEqual([1, ["worker.js", "worker.js.map"], "worker.js", { "workers/tag": RELEASE, "workers/message": `poplin ${RELEASE}, by its install` }]);
    expect(upload?.metadata.bindings).toEqual([
      { type: "r2_bucket", bucket_name: "poplin-sites", name: "SITES" },
      { type: "d1", id: "made-0", name: "DB" },
      { type: "workflow", workflow_name: "poplin-jobs", class_name: "PoplinJobs", name: "JOBS" },
      { type: "plain_text", text: "poplin", name: "WORKER_NAME" },
      { type: "ratelimit", namespace_id: "1001", simple: { limit: 1_000_000, period: 60 }, name: "MINUTE_LIMITS" },
    ]);
    expect(account.bindings.map((binding) => `${binding.name}: ${binding.type}`).sort()).toEqual(
      ["ACCESS: json", "ACCOUNT_ID: plain_text", "DB: d1", "FIRST_SETTINGS: json", "JOBS: workflow", "KEPT_KEY: secret_text", "MINUTE_LIMITS: ratelimit", "SITES: r2_bucket", "UPLOAD_KEY: secret_text", "WORKER_NAME: plain_text", "ZONE: json"],
    );
    expect([account.buckets, account.databases.length, account.crons, account.address, account.workflows]).toEqual([
      [{ name: "poplin-sites" }],
      1,
      ["*/15 * * * *"],
      { enabled: kind === "no-domain", previews_enabled: false },
      [{ name: "poplin-jobs", script_name: "poplin", class_name: "PoplinJobs" }],
    ]);
  });

  // Drift: an install that could not be run twice would leave a person with half an install and no way on but to delete it by hand.
  test("a run that stops at one piece says which, and the run after it goes on from what stands: nothing is made twice, and the install is then found whole, with its version", async () => {
    const account = fresh({ refuse: `PUT /accounts/${ACCOUNT}/workers/scripts/poplin/schedules`, refuseAs: { status: 400, code: 10001 } });
    const stopped = await installed(account, kind, APPLY);

    expect([shown(stopped.done).slice(2), stopped.done.ok && stopped.done.ready]).toEqual([[`Worker | make | poplin, runs ${RELEASE}`, "Sweep trigger | fail | */15 * * * *: refused with status 400"], false]);

    delete account.refuse;
    const again = await installed(account, kind, APPLY);
    const stood = ["R2 bucket | leave | poplin-sites", "D1 database | leave | poplin", "Worker | leave | poplin", "Sweep trigger | change | */15 * * * *"];

    expect([again.found.state, shown(again.done).slice(0, 4), shown(again.done).slice(5), again.done.ok && again.done.ready]).toEqual(["started", stood, ROWS[kind].slice(5), true]);
    expect([account.uploads.length, account.buckets.length, account.databases.length]).toEqual([1, 1, 1]);

    const world = await worldOf(account);

    expect(await installer.find(KEY, KINDS[kind].where, world.reach)).toMatchObject({ state: "whole", version: RELEASE, address: KINDS[kind].address, newest: RELEASE });
    expect(world.asked.filter((entry) => entry.method !== "GET")).toEqual([]);
  });

  // Drift: no API switches Access on, so a run that called such an install done would hand over a dashboard nobody can log in to.
  test("on an account whose Access is off the login's rows are blocked, in the dry run as in the run, the rest is made, and the person is told what to switch on", async () => {
    const account = fresh({ accessOff: true });
    const dry = await installed(account, kind, DRY);
    const run = await installed(account, kind, APPLY);
    const off = "block | Access is off for the account";
    const blocked = [`Access application | ${off}`, `Access policy | ${off}`, `Access open paths | ${off}`, "Worker variable | block | ACCESS: written once the Access application exists"];

    expect(dry.found).toMatchObject({ state: "none", notes: [{ what: "login_off", address: `https://one.dash.cloudflare.com/${ACCOUNT}` }] });
    expect(shown(run.done)).toEqual(shown(dry.done));
    expect(shown(run.done).filter((row) => row.includes(" | block | "))).toEqual(blocked);
    expect(run.done).toMatchObject({ ok: true, ready: false, blocked: [{ what: "login_off" }], steps: [{ address: `https://one.dash.cloudflare.com/${ACCOUNT}` }] });
    expect(account.bindings.map((binding) => binding.name).sort()).toEqual(["ACCOUNT_ID", "DB", "FIRST_SETTINGS", "JOBS", "KEPT_KEY", "MINUTE_LIMITS", "SITES", "UPLOAD_KEY", "WORKER_NAME", "ZONE"]);
  });

  // Drift: a database of poplin's name may hold an earlier install's records, so a run takes it only once a person said to, and then leaves what it holds.
  test("data left behind is found as such, and a run that was told to use it leaves the database as it is and makes the rest", async () => {
    const account = fresh({ databases: [{ uuid: "database-9", name: "poplin" }] });
    const { found, done } = await installed(account, kind, APPLY);
    const [upload] = account.uploads as { metadata: { bindings: { name: string; id?: string }[] } }[];

    expect(found).toMatchObject({ state: "leftover", words: "There is a database named poplin in this account, and no poplin runs. It may hold an earlier install's sites and records.", address: `https://dash.cloudflare.com/${ACCOUNT}/workers/d1` });
    expect([shown(done)[1], done.ok && done.ready, account.databases, upload?.metadata.bindings.find((binding) => binding.name === "DB")?.id]).toEqual(["D1 database | leave | poplin", true, [{ uuid: "database-9", name: "poplin" }], "database-9"]);
  });

  // Drift: the key's value and the token are secrets of the run. A row, a step, or a block that held one would print it.
  test("no row, step, or block of a run holds the token or the value of a key it made", async () => {
    const { done } = await installed(fresh(), kind, APPLY);
    const told = JSON.stringify(done);

    expect([told.includes(TOKEN), told.includes(KEY_VALUE_START), done.ok]).toEqual([false, false, true]);
  });
});

describe("what stops a run before it changes anything", () => {
  // Drift: the release is read first, so a website that is down, or a release this code cannot place, must leave the account as it was.
  test.each([
    ["the project's website gives no answer", (address: string) => (address.endsWith("releases.json") ? new Response("down", { status: 503 }) : undefined), { ok: false, why: "unreachable" }],
    ["no release is published yet", (address: string) => (address.endsWith("releases.json") ? new Response("{}") : undefined), { ok: true, ready: false, rows: [], blocked: [{ what: "no_release" }] }],
    ["the release's module is not the one that was published", (address: string) => (address.endsWith("worker.js") ? new Response("export default 1;\n") : undefined), { ok: true, ready: false, rows: [], blocked: [{ what: "bad_release" }] }],
  ] as const)("%s: nothing is made", async (_, website, outcome) => {
    const account = fresh();
    const before = structuredClone(account);
    const { done, calls } = await installed(account, "domain", APPLY, { website });

    expect(done).toMatchObject(outcome);
    expect([calls.writes, account]).toEqual([[], before]);
  });

  // Drift: an install without a domain answers at the account's free address, which the account must have set: the three hosts are made from its name.
  test("an account with no free address is told to set it, and nothing is made", async () => {
    const account = fresh({ noFreeAddress: true });
    const { done, calls } = await installed(account, "no-domain", APPLY);

    expect(done).toMatchObject({ ok: true, ready: false, rows: [], address: undefined, blocked: [{ what: "no_address", address: `https://dash.cloudflare.com/${ACCOUNT}/workers-and-pages` }] });
    expect([calls.writes, account.uploads]).toEqual([[], []]);
  });

  // Drift: a token without a needed permission stops the pieces after the one it is refused at, and the run must name the permission, as a block too.
  test("a token that may not read the records is blocked at them: the row and the block name the permission, and nothing after the row is run", async () => {
    const { done } = await installed(fresh({ refuse: "GET /zones/zone-1/dns_records", refuseMessage: "Authentication error" }), "domain", DRY);
    const rows = shown(done).slice(6);

    expect(rows[0]).toBe("DNS record | block | refused with status 403: 10000 Authentication error. Add this right to the account token: DNS: Edit");
    expect([...new Set(rows.slice(1).map((row) => row.split(" | ")[1]))]).toEqual(["not-run"]);
    expect(done).toMatchObject({ ok: true, ready: false, blocked: [{ what: "right_lacking", right: "DNS: Edit" }] });
  });

  // Drift: an optional piece the token has no permission for is no failure: the install works without it, and the run is whole.
  test.each([
    ["domain", ["Redirect rule", "WAF rule", "Rate rule", "Bot settings", "Budget alert"]],
    ["no-domain", ["Budget alert"]],
  ] as const)("a token without the optional permissions leaves those pieces out of a new install, %s, in the dry run as in the run, and the run is ready", async (kind, optional) => {
    const refuse = ["GET /zones/zone-1/rulesets*", `GET /accounts/${ACCOUNT}/alerting*`, "GET /zones/zone-1/bot_management"];
    const account = fresh({ refuse });
    const dry = await installed(account, kind, DRY);
    const run = await installed(account, kind, APPLY);
    const left = shown(run.done).filter((row) => row.includes(" | leave-out | ")).map((row) => row.split(" | ")[0]);

    const states = (done: Installed): string[][] => shown(done).map((row) => row.split(" | ").slice(0, 2));

    expect([left, states(run.done), run.done.ok && run.done.ready]).toEqual([[...optional], states(dry.done), true]);
  });
});

describe("the provider's own answers", () => {
  // Drift: each answer is read once, here. A pair of options that contradict, or text that is no domain, that passed would reach a request.
  test.each([
    ["a domain by its option", { flags: [["domain", "Example.com"]] }, { kind: "domain", domain: "example.com", account: undefined }],
    ["none by its option", { flags: [["no-domain", true]] }, { kind: "no-domain", account: undefined }],
    ["a domain by the variable", { env: { POPLIN_DOMAIN: "example.com" } }, { kind: "domain", domain: "example.com", account: undefined }],
    ["none by the variable", { env: { POPLIN_DOMAIN: "none" } }, { kind: "no-domain", account: undefined }],
    ["an option over its variable", { flags: [["no-domain", true]], env: { POPLIN_DOMAIN: "example.com" } }, { kind: "no-domain", account: undefined }],
    ["an account by its option", { flags: [["no-domain", true], ["account", ACCOUNT]] }, { kind: "no-domain", account: ACCOUNT }],
    ["an account by the variable", { flags: [["domain", "example.com"]], env: { POPLIN_ACCOUNT: ACCOUNT } }, { kind: "domain", domain: "example.com", account: ACCOUNT }],
  ] as const)("reads %s", (_, given, where) => {
    const read = placeOf(given);

    expect<unknown>(read.kind === "domain" ? { kind: read.kind, domain: read.layout.domain, account: read.account } : read).toEqual(where);
  });

  test.each([
    ["both options", { flags: [["domain", "example.com"], ["no-domain", true]] }, "give one of --domain <name> and --no-domain"],
    ["a domain option with no name", { flags: [["domain", true]] }, "--domain takes a name, such as example.com"],
    ["a domain option with an empty name, which is not the word for none", { flags: [["domain", ""]] }, "--domain takes a name, such as example.com"],
    ["text that is no domain", { flags: [["domain", "not a domain"]] }, "not a domain is no domain name"],
    ["an account that is no id", { flags: [["no-domain", true], ["account", "mine"]] }, "--account takes an account's id: 32 characters of 0-9 and a-f"],
  ] as const)("refuses %s", (_, given, refused) => {
    expect(installer.read({ flags: new Map<string, string | true>(given.flags), env: {} })).toEqual({ ok: false, why: "refused", refused });
  });

  // Drift: the provider asks nothing itself. A run that may not ask must be able to name the option, and one that may must get a place from what was typed.
  test("with neither option the one open question names its option and its variable, and takes a domain, or nothing for none", () => {
    const read = installer.read({ flags: new Map(), env: {} });
    const [question] = read.ok || read.why !== "open" ? [] : read.open;

    expect([question?.key, question?.name, question?.give]).toEqual(["where", "where it answers", "Give --domain <name> or --no-domain (or POPLIN_DOMAIN)."]);
    expect([question?.answer(""), question?.answer(" example.com ")]).toMatchObject([{ ok: true, where: { kind: "no-domain" } }, { ok: true, where: { kind: "domain", layout: { domain: "example.com" } } }]);
    expect(question?.answer("no domain")).toEqual({ ok: false, why: "refused", refused: "no domain is no domain name" });
    // A variable set to nothing must not read as the word for none: a run would then install at another kind of address than the person meant.
    expect(installer.read({ flags: new Map(), env: { POPLIN_DOMAIN: "" } })).toMatchObject({ ok: false, why: "open" });
  });

  // Drift: an install makes the bucket, which no repair does, so its token needs one permission more than the Domain screen's: ten with a domain, six without.
  test("the token of an install needs the repair's permissions and the storage one, which the form's note names since no link can choose it; text that is no token is refused", () => {
    const [domain, none] = [installer.facts(KINDS.domain.where), installer.facts(KINDS["no-domain"].where)];

    expect([domain.tokenRights.length, none.tokenRights.length]).toEqual([10, 6]);
    expect([domain.tokenRights.includes("Workers R2 Storage: Edit"), none.tokenRights.includes("Workers R2 Storage: Edit"), none.tokenRights.some((right) => right.startsWith("Zone") || right.startsWith("DNS"))]).toEqual([true, true, false]);
    expect([domain.tokenNote.endsWith("choose it on the form yourself: Workers R2 Storage: Edit."), decodeURIComponent(domain.tokenLink).includes("r2")]).toEqual([true, false]);
    expect(installer.tokenHelp.filter((line) => line.includes("permissions:")).map((line) => line.trim().split(":")[0])).toEqual(["with a domain 10 permissions", "without       6 permissions"]);
    expect([installer.token("short"), installer.token("has a space in it, so it is none"), installer.token(TOKEN)]).toEqual([undefined, undefined, KEY]);
  });
});

// Drift: the repair that finishes an install proves the token again. Left to look for the account itself, it reads only the first accounts a token shows, and would refuse an install in a later one after its Worker was uploaded.
test("an install in the account a person named is finished in that account: the repair lists no account again", async () => {
  const account = fresh({ alsoShown: [{ id: "f".repeat(32), name: "Another account" }] });
  const world = await worldOf(account);
  const where = placeOf({ flags: [["no-domain", true], ["account", ACCOUNT]] });
  const found = await installer.find(KEY, where, world.reach);
  const sought = world.asked.length;
  const done = await installer.install(startable(found), where, LOGIN, APPLY, world.reach, () => undefined);

  expect([done.ok && done.ready, world.asked.slice(sought).filter((entry) => entry.path.split("?")[0] === "/accounts")]).toEqual([true, []]);
});
