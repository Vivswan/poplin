// The scheduled run, driven as Cloudflare's cron trigger drives it. Nothing else ever moves an expired site to the trash or empties the trash.

import { reset } from "cloudflare:test";
import { noteProblem } from "@poplin/core/src/actions/install/problems";
import { publishSite } from "@poplin/core/src/actions/publish/publish";
import { SWEEP_SPARE_WRITES } from "@poplin/core/src/actions/install/sweep";
import { parseUserCode } from "@poplin/core/src/auth/computer-logins";
import type { Login } from "@poplin/core/src/auth/logins";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { dayOf } from "@poplin/core/src/records/views";
import { sha256Of } from "@poplin/core/src/storage/storage";
import { beforeEach, describe, expect, test, vi } from "vitest";
import manifest from "../../../../../cli/package.json?raw";
import { INSTALL_OBJECTS } from "../../../src/shared/install/install-objects";
import { BUDGET_ALERT } from "../../../src/shared/install/pieces/alerts/budget-alert";
import { CERTIFICATE_ALERT } from "../../../src/with-domain/pieces/alerts/certificate-alert";
import type { Bindings } from "../../../src/shared/worker/bindings";
import { runSweep } from "../../../src/shared/worker/sweep";
import { ACCOUNT, emptyAccount, TEAM, TOKEN } from "../install/support/fake-install";
import type { Asked } from "../install/support/replies";
import { ADMIN, api, ask, BINDINGS, cloudflareOf, countedBindings, done, freePlanBindings, installOf, instance, logIn, OWNER, page, problemsOf } from "./support/install";
import { publish, refusingDatabase, send, sendFile, shortPages, sweep, tokenOf, type World, wait, world } from "./support/install";
import { OWN_KEY, ownRelease } from "./support/own-release";

/** The most database and bucket calls one scheduled invocation may make, the start of its instance included: 50 to the database, which is all D1 answers on the Free plan, and 250 to the bucket. */
const INVOCATION_CALLS = 300;

/** The milliseconds of one UTC day. */
const DAY_MS = 86_400_000;

/** The files one removal takes from a folder whose list pages hold one object each. */
const WHOLE_REMOVAL = 15;

/** What a step over five sat-out sites costs when each takes a whole removal: the listing of the due ones, the day's count of writes to the bucket, the five removed in one call, 30 bucket calls for each, and their folders forgotten in one. */
const MOST_STEP_CALLS = 154;

/** The requests the run's table says a repair of the login sends at the most with the two alerts kept and the carry of the users after it, where each list of the account fits one page. */
const MOST_REPAIR_CALLS = 29;

/** The names of the two alerts an install with a domain keeps, in the order they are kept. */
const ALERTS = [BUDGET_ALERT.name, CERTIFICATE_ALERT.name];

/** The two kinds of install, each with the key it keeps: the bindings its Worker carries, where its dashboard answers, and the alerts it keeps. */
const KEYED = [
  { kind: "a domain", bindings: { ...BINDINGS, KEPT_KEY: TOKEN }, admin: ADMIN, alerts: ALERTS },
  { kind: "an account address", bindings: { ...BINDINGS, KEPT_KEY: TOKEN, ZONE: { account_address: "example" } } as Bindings, admin: "https://poplin.example.workers.dev", alerts: [BUDGET_ALERT.name] },
] as const;

/** Where Cloudflare answers the guard rules of the install's zone, and the account's alerts. */
const READS = { rules: "/zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint", alerts: `/accounts/${ACCOUNT}/alerting/v3/policies` } as const;

/** The version the Worker under test runs: the one the released package's manifest states, which a release moves. */
const OWN_VERSION = (JSON.parse(manifest) as { version: string }).version;

/** The one file of a site made only to be swept. */
const HTML = new TextEncoder().encode("<p>short-lived</p>");

let w: World;

async function keysUnder(prefix: string): Promise<string[]> {
  return (await BINDINGS.SITES.list({ prefix })).objects.map((object) => object.key);
}

async function states(): Promise<Record<string, number>> {
  const { database } = await installOf(w);
  const [live, trash] = await Promise.all([database.listSites({ trash: false, limit: 100 }), database.listSites({ trash: true, limit: 100 })]);

  return { live: live.sites.length, trash: trash.sites.length };
}

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("the scheduled run", () => {
  // Drift: with the login in front of the whole dashboard, an application deleted at Cloudflare shuts every user out, and nothing but this run puts it back with no person.
  // A run that wrote a login that stands, or asked on each of a day's 96 runs, would spend the account's calls for nothing.
  test("the run that begins a day puts back a login that was removed at Cloudflare, for the stored users and inside its count of calls, and Activity says so; a login that stands is read and not written, and no other run of the day asks", async () => {
    const account = emptyAccount();
    const asked: Asked[] = [];
    const keyed = { ...BINDINGS, KEPT_KEY: TOKEN };
    const worker = instance(w, cloudflareOf(account, asked));
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const { database } = await installOf(w);
    const written = (): string[] => asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`);
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;

    await sweep(worker, w, keyed);
    const first = { calls: asked.length, writes: written().length };
    const made = {
      applications: account.applications.map((application) => application.name).sort(),
      users: account.policies.filter((policy) => policy.name === INSTALL_OBJECTS.accessPolicy).map((policy) => policy.include),
      variable: account.bindings.find((binding) => binding.name === "ACCESS"),
    };
    wait(w, 0.25);
    await sweep(worker, w, keyed);
    const sameDay = asked.length - first.calls;
    wait(w, 23.75);
    await sweep(worker, w, keyed);
    const nextDay = { calls: asked.length - first.calls, writes: written().length - first.writes };
    const said = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "domain_synced").map(({ by, detail }) => ({ by, detail }));

    expect(made).toEqual({
      applications: [INSTALL_OBJECTS.accessApplication, INSTALL_OBJECTS.accessOpenApplication],
      users: [[{ email: { email: OWNER } }]],
      variable: { name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications.find((application) => application.name === INSTALL_OBJECTS.accessApplication)?.aud } },
    });
    // The sixth and the seventh write are the two alerts, made for the first user before the users are carried; the eighth is the carry's own writing of the policy, which no list read just after the repair's is trusted to leave out.
    expect([first.calls <= MOST_REPAIR_CALLS, first.writes, sameDay, nextDay.calls > 0, nextDay.writes]).toEqual([true, 8, 0, true, 0]);
    expect(account.alerts.map((alert) => [alert.name, alert.mechanisms])).toEqual(ALERTS.map((name) => [name, { email: [{ id: OWNER }] }]));
    expect(said).toEqual([
      {
        by: "sweep@poplin.invalid",
        detail: { run: "repair", from: "sweep", changed: [INSTALL_OBJECTS.accessOpenPolicy, INSTALL_OBJECTS.accessOpenApplication, INSTALL_OBJECTS.accessPolicy, INSTALL_OBJECTS.accessApplication, "ACCESS", ...ALERTS] },
      },
    ]);
    expect(JSON.stringify([said, await problemsOf(w)])).not.toContain(TOKEN);
  });

  // Drift: a repair that failed and said nothing leaves the owner to learn of a broken login by being shut out; one that threw would stop the run before it removes a single expired site.
  // A key that lacks the login's right may hold the alerts': both are still kept. A key Cloudflare refuses, or no answer, is not asked a second time.
  test.each([
    ["a key Cloudflare no longer takes", { status: 401, code: 10_000 }, [["login_not_repaired", 1, "key_refused"]], []],
    ["a key that lacks the right", { status: 403, code: 10_000 }, [["login_not_repaired", 1, "lacks_right"]], [`POST /accounts/${ACCOUNT}/alerting/v3/policies`, `POST /accounts/${ACCOUNT}/alerting/v3/policies`]],
    ["a Cloudflare that gives no usable answer", { status: 503, code: 0 }, [], []],
  ] as const)("the run that begins a day, with %s, notes what a person must repair, writes nothing of the login, and still moves an expired site to the trash", async (_name, refuseAs, problems, writes) => {
    const account = emptyAccount();
    const asked: Asked[] = [];
    account.refuse = `GET /accounts/${ACCOUNT}/access/policies`;
    account.refuseAs = refuseAs;
    const worker = instance(w, cloudflareOf(account, asked));
    await publish(instance(w), await tokenOf(w, "publisher"), { name: "brief", expires: "1h" }, [page("<p>brief</p>")]);
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;

    await sweep(worker, w, { ...BINDINGS, KEPT_KEY: TOKEN });

    expect([await problemsOf(w), asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`), account.applications]).toEqual([problems, [...writes], []]);
    expect(await states()).toEqual({ live: 0, trash: 1 });
  });

  // Drift: the install's own repair keeps no run of the domain, so the problem of a day its key was refused would stay marked through the day the repair came through, with advice nobody needs to take.
  test("the run that begins a day and repairs the login ends the problem the day before's refused repair left, and one of another kind stays", async () => {
    const account = emptyAccount();
    const keyed = { ...BINDINGS, KEPT_KEY: TOKEN };
    const worker = instance(w, cloudflareOf(account, []));
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const { database } = await installOf(w);
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    account.refuse = `GET /accounts/${ACCOUNT}/access/policies`;
    account.refuseAs = { status: 403, code: 10_000 };
    await sweep(worker, w, keyed);
    await database.noteProblem({ kind: "api_failed", at: w.clock.now, count: 1, more: false, name: null, message: null });
    const [dayBefore, kinds] = [dayOf(w.clock.now), async (): Promise<string[]> => (await database.listProblems(dayBefore)).map((problem) => problem.kind).sort()];
    const refused = await kinds();

    account.refuse = [];
    wait(w, 24);
    await sweep(worker, w, keyed);

    expect([refused, await kinds()]).toEqual([["api_failed", "login_not_repaired"], ["api_failed"]]);
  });

  // Drift: a request notes a login it could not check once an hour, and remembers that it did under the install's database.
  // A run that ended the problem under another object would leave that memory, and the same problem seen again in the hour would show nowhere.
  test("a login that could not be checked, ended by the run's repair and seen again in the same hour by the same instance, is noted again at once", async () => {
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const install = await installOf(w);
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    const keyless = { holdsKey: () => false, push: async () => ({ ok: false as const, refusal: "no_key" as const }) };
    const updating = { self: { holdsKey: () => false, ready: () => Promise.reject(new Error("the test asked for an update")) }, counters: { takeMinute: async () => ({ ok: true as const }) } };
    const login = { holdsKey: () => true, repair: async () => ({ wrote: [], users: false, calls: 0, refusal: undefined }) };
    const keepAlerts = async (): Promise<{ readonly wrote: readonly string[] }> => ({ wrote: [] });
    const running = { version: "0.1.0", updating, login, keepAlerts, follow: { where: "Cloudflare", ...keyless }, rules: keyless, dailyLogs: keyless };
    const kinds = async (): Promise<string[]> => (await install.database.listProblems(dayOf(w.clock.now))).map((problem) => problem.kind);
    await noteProblem(install, "login_unchecked");
    const noted = await kinds();

    await runSweep(install, { fetch: async () => Response.json({}) }, running);
    const ended = await kinds();
    w.clock.now += 60_000;
    await noteProblem(install, "login_unchecked");

    expect([noted, ended, await kinds()]).toEqual([["login_unchecked"], [], ["login_unchecked"]]);
  });

  // Drift: the key holds the right to make the alert, and no token is pasted after install. With no run that makes it, an install set up with the needed rights alone would have no alert until a user changed.
  // An alert the key may not make is the Domain screen's to say: a problem noted here would stand beside a row that already names the right.
  test("the run that begins a day makes the alerts an account lacks, with the key and for the first user, and Activity says so; alerts that stand are read alone; and a key that may not make them is asked once and notes no problem", async () => {
    const account = emptyAccount();
    const asked: Asked[] = [];
    const keyed = { ...BINDINGS, KEPT_KEY: TOKEN };
    const worker = instance(w, cloudflareOf(account, asked));
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const { database } = await installOf(w);
    const alertCalls = (from: number, to?: number): string[] => asked.slice(from, to).filter((entry) => entry.path.includes("/alerting/")).map((entry) => entry.method);
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    await sweep(worker, w, keyed);
    account.alerts.splice(0);

    const second = asked.length;
    wait(w, 24);
    await sweep(worker, w, keyed);
    const third = asked.length;
    wait(w, 24);
    await sweep(worker, w, keyed);
    account.alerts.splice(0);
    account.refuse = `GET /accounts/${ACCOUNT}/alerting/v3/policies`;
    const fourth = asked.length;
    wait(w, 24);
    await sweep(worker, w, keyed);
    const said = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "domain_synced").map((entry) => entry.detail.changed);

    expect([alertCalls(second, third), alertCalls(third, fourth), alertCalls(fourth), account.alerts]).toEqual([["GET", "POST", "POST"], ["GET"], ["GET"], []]);
    // Newest first: the day the alerts alone were made names them alone, and the first day names them after the login it put back.
    expect(said.map((changed) => (Array.isArray(changed) ? changed.slice(-3) : changed))).toEqual([ALERTS, ["ACCESS", ...ALERTS]]);
    expect(await problemsOf(w)).toEqual([]);
  });

  // Drift: a repair that stopped half way wrote four objects at Cloudflare; left out of Activity, nothing in the install would say they were made.
  // And a policy it wrote from users read before a change of them would shut the newest user out until the next day, on an install that keeps no run of its domain too.
  test("the run that begins a day, refused the write of the Worker's variable, says in Activity what it wrote before and notes the problem; a user added while it wrote the policy is in the policy when the run ends", async () => {
    const account = emptyAccount();
    const asked: Asked[] = [];
    const keyed = { ...BINDINGS, KEPT_KEY: TOKEN };
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const { database } = await installOf(w);
    const answers = cloudflareOf(account, asked);
    const logins = (): unknown => account.policies.filter((policy) => policy.name === INSTALL_OBJECTS.accessPolicy).map((policy) => policy.include);
    // The moment Cloudflare holds the policy the repair wrote, another user is stored, as an admin's add in another request stores one.
    const worker = instance(w, async (input, init) => {
      const before = account.policies.length;
      const answered = await answers(input, init);
      if (before === 1 && account.policies.length === 2) await database.addLogin("bo@example.com" as Login, { as: "person", by: OWNER, at: w.clock.now });

      return answered;
    });
    account.refuse = `PATCH /accounts/${ACCOUNT}/workers/scripts/poplin/settings`;
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;

    await sweep(worker, w, keyed);
    const said = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "domain_synced" && entry.detail.from === "sweep").map((entry) => entry.detail.changed);

    expect(said).toEqual([[INSTALL_OBJECTS.accessOpenPolicy, INSTALL_OBJECTS.accessOpenApplication, INSTALL_OBJECTS.accessPolicy, INSTALL_OBJECTS.accessApplication, ...ALERTS]]);
    expect(await problemsOf(w)).toEqual([["login_not_repaired", 1, "lacks_right"]]);
    expect([await database.readDomainCheck(), logins()]).toEqual([undefined, [[{ email: { email: "bo@example.com" } }, { email: { email: OWNER } }]]]);
  });

  // Drift: a user added while Cloudflare refused the list can log in only once the list is carried. Without the run nothing carries it but a person's repair, and a run that carried with nothing waiting would call Cloudflare every 15 minutes for nothing.
  // The alerts that carry made are read once more by a later run, which writes nothing and ends the waiting: a run that never ended it would list the alerts 96 times a day.
  test("a change of the users that Cloudflare did not take is carried by the next run, which settles it; a later run confirms the alerts with reads alone, and a run with nothing waiting asks Cloudflare nothing", async () => {
    const account = emptyAccount();
    account.policies.push({ id: "policy-1", name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include: [{ email: { email: OWNER } }] });
    const asked: Asked[] = [];
    const keyed = { ...BINDINGS, KEPT_KEY: TOKEN };
    const worker = instance(w, cloudflareOf(account, asked));
    const session = await logIn(worker, w, keyed);
    const { database } = await installOf(w);
    await database.keepDomainCheck({ ran_at: w.clock.now, by: OWNER, run: "repair", pieces: [] }, {});
    const waits = async (): Promise<boolean | undefined> => database.readDomainCheck().then((kept) => (kept === undefined ? undefined : kept.users_changed_at !== null));
    const emails = (): unknown => account.policies.map((policy) => (policy.include as { email: { email: string } }[]).map((rule) => rule.email.email));

    account.refuse = `GET /accounts/${ACCOUNT}/access/policies`;
    account.refuseAs = { status: 401, code: 10_000 };
    const added = await (await send(worker, `${ADMIN}/data/people/add`, { login: "bo@example.com" }, session, keyed)).json<{ note: string }>();
    const refused = [added.note, await waits(), emails(), await problemsOf(w)];
    account.refuse = [];
    await sweep(worker, w, keyed);
    const carried = [await waits(), emails()];
    const calls = asked.length;
    await sweep(worker, w, keyed);
    const tooSoon = asked.length - calls;
    wait(w, 0.25);
    await sweep(worker, w, keyed);
    const confirmed = [asked.slice(calls).filter((entry) => entry.path.includes("/alerting/")).map((entry) => entry.method), (await database.readDomainCheck())?.alerts_changed_at];
    const after = asked.length;
    wait(w, 0.25);
    await sweep(worker, w, keyed);

    expect(refused).toEqual(["Cloudflare refused the install's key, so the user list there is as it was. Open Domain and press Repair.", true, [[OWNER]], [["users_not_carried", 1, null]]]);
    expect([carried, tooSoon, confirmed, asked.length - after]).toEqual([[false, [["bo@example.com", OWNER]]], 0, [["GET"], null], 0]);
    expect(JSON.stringify(added)).not.toContain(TOKEN);
  });

  // Drift: a saved setting whose rule Cloudflare did not take is in force at the edge only once the rule is written. Without the run nothing writes it but a person's repair, and the save itself must be answered as saved whatever Cloudflare said.
  test("a changed setting of the guard rules that Cloudflare did not take is carried by a run a quarter of an hour later and no sooner; the run after it writes nothing and ends the waiting, and a run with nothing waiting asks nothing", async () => {
    const account = emptyAccount();
    const asked: Asked[] = [];
    const keyed = { ...BINDINGS, KEPT_KEY: TOKEN };
    const worker = instance(w, cloudflareOf(account, asked));
    const session = await logIn(worker, w, keyed);
    const { database } = await installOf(w);
    await database.keepDomainCheck({ ran_at: w.clock.now, by: OWNER, run: "repair", pieces: [] }, {});
    const waits = async (): Promise<boolean | undefined> => database.readDomainCheck().then((kept) => (kept === undefined ? undefined : kept.rules_changed_at !== null));
    const refs = (): unknown => (account.rulesets.http_request_firewall_custom?.rules ?? []).map((rule) => rule.ref);

    account.refuse = "GET /zones/zone-1/rulesets/*";
    account.refuseAs = { status: 401, code: 10_000 };
    const other = await send(worker, `${ADMIN}/data/settings`, { texts: { trash_days: "9", block_bots: "on" } }, session, keyed);
    const unasked = asked.length;
    const saved = await send(worker, `${ADMIN}/data/settings`, { texts: { outside_pages: "allowed" } }, session, keyed);
    const refused = [other.status, unasked, saved.status, await saved.json(), await waits(), refs(), await problemsOf(w)];
    account.refuse = [];
    const before = asked.length;
    await sweep(worker, w, keyed);
    const tooSoon = [asked.length - before, await waits()];
    wait(w, 0.25);
    await sweep(worker, w, keyed);
    const carried = [await waits(), refs()];
    const written = asked.filter((entry) => entry.method !== "GET").length;
    wait(w, 0.25);
    await sweep(worker, w, keyed);
    const confirmed = [await waits(), asked.filter((entry) => entry.method !== "GET").length - written];
    const calls = asked.length;
    wait(w, 0.25);
    await sweep(worker, w, keyed);

    expect(refused).toEqual([200, 0, 200, { ok: true, waits: { repair: [], update: [] }, carried: true }, true, [], [["rules_not_carried", 1, null]]]);
    expect([tooSoon, carried, confirmed, asked.length - calls]).toEqual([[0, true], [true, [INSTALL_OBJECTS.botsRef]], [false, 0], 0]);
  });

  // Drift: a setting changed and put back within seconds. The carry of the put-back reads the rules as they were before the first carry's write, finds its rule standing, and writes nothing, so the rule stays removed while the setting says blocked.
  // A carry that ended the waiting there would leave it so until the next change or a repair: the next run, a quarter of an hour later, must read the rules anew and write the rule.
  test("outside_pages allowed and blocked again at once, where the read of the rules trails the first write, leaves the rule removed and the change waiting; the next run writes the rule, and the run after it ends the waiting", async () => {
    const account = emptyAccount();
    const asked: Asked[] = [];
    const keyed = { ...BINDINGS, KEPT_KEY: TOKEN };
    const worker = instance(w, cloudflareOf(account, asked));
    const session = await logIn(worker, w, keyed);
    const { database } = await installOf(w);
    await database.keepDomainCheck({ ran_at: w.clock.now, by: OWNER, run: "repair", pieces: [] }, {});
    const waits = async (): Promise<boolean> => database.readDomainCheck().then((kept) => (kept?.rules_changed_at ?? null) !== null);
    const refs = (): unknown => (account.rulesets.http_request_firewall_custom?.rules ?? []).map((rule) => rule.ref).sort();
    const save = async (value: string): Promise<number> => (await send(worker, `${ADMIN}/data/settings`, { texts: { outside_pages: value } }, session, keyed)).status;
    const both = [INSTALL_OBJECTS.botsRef, INSTALL_OBJECTS.outsideRef].sort();

    // The rules as a repair leaves them for the first settings: both stand.
    await save("allowed");
    await save("blocked");
    const stood = structuredClone(account.rulesets.http_request_firewall_custom);
    wait(w, 0.25);
    await sweep(worker, w, keyed);
    const start = [refs(), await waits()];

    await save("allowed");
    account.trails = { [READS.rules]: [stood] };
    const saved = await save("blocked");
    const lost = [saved, (await database.readSettings())?.outside_pages, refs(), await waits()];
    wait(w, 0.25);
    await sweep(worker, w, keyed);
    const written = [refs(), await waits()];
    wait(w, 0.25);
    await sweep(worker, w, keyed);
    const calls = asked.length;
    wait(w, 0.25);
    await sweep(worker, w, keyed);

    expect([start, lost]).toEqual([[both, false], [200, "blocked", [INSTALL_OBJECTS.botsRef], true]]);
    expect([written, await waits(), asked.length - calls, await problemsOf(w)]).toEqual([[both, true], false, 0, []]);
  });

  // Drift: the first user changed to another person and back within seconds. The carry of the put-back reads the alerts as they were before the first carry's write and writes nothing, so they go on to the other person.
  // The run that begins a day would correct that a day later at the worst: the next run, a quarter of an hour later, must read the alerts anew and write them, on an install of either kind.
  test.each(KEYED)("with $kind, a first user changed and put back at once, where the list of the alerts trails the first write: the next run mails the first user, and the run after it ends the waiting", async ({ bindings, admin, alerts }) => {
    const account = emptyAccount();
    account.policies.push({ id: "policy-1", name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include: [{ email: { email: OWNER } }] });
    const asked: Asked[] = [];
    const worker = instance(w, cloudflareOf(account, asked));
    const calls = api(worker, await tokenOf(w, "admin"), (input, init) => ask(worker, input, init, bindings), admin);
    const { database } = await installOf(w);
    await database.keepDomainCheck({ ran_at: w.clock.now, by: OWNER, run: "repair", pieces: [] }, {});
    const mailed = (): unknown => account.alerts.map((alert) => [alert.name, alert.mechanisms]);
    const to = (email: string): unknown => alerts.map((name) => [name, { email: [{ id: email }] }]);
    const users = async (emails: string[]): Promise<unknown> => done(await calls.config.$patch({ query: {}, json: { users: emails as Login[] } }));
    const marks = async (): Promise<unknown> => database.readDomainCheck().then((kept) => [kept?.users_changed_at ?? null, (kept?.alerts_changed_at ?? null) !== null]);

    await users([OWNER, "bo@example.com"]);
    const first = structuredClone(account.alerts);
    await users(["bo@example.com", OWNER]);
    account.trails = { [READS.alerts]: [first] };
    await users([OWNER, "bo@example.com"]);
    const lost = [mailed(), await marks()];
    wait(w, 0.25);
    await sweep(worker, w, bindings);
    const written = [mailed(), await marks()];
    wait(w, 0.25);
    await sweep(worker, w, bindings);
    const confirmed = await marks();
    const before = asked.length;
    wait(w, 0.25);
    await sweep(worker, w, bindings);

    expect(lost).toEqual([to("bo@example.com"), [null, true]]);
    expect([written, confirmed, asked.length - before, await problemsOf(w)]).toEqual([[to(OWNER), [null, true]], [null, false], 0, []]);
  });

  // Drift: who gets the alerts is a setting of its own. A change of it that was carried nowhere would leave Cloudflare mailing the users chosen before, and one no later run compared again would be trusted on a read that may trail its write.
  // The run that begins a day keeps the alerts too: one that read the first user alone would undo the choice once a day, on an install of either kind.
  test.each(KEYED)("with $kind, users chosen for the alerts get every alert of the install at once, the next runs confirm them with reads alone, and the run that begins a day leaves them chosen", async ({ bindings, admin, alerts }) => {
    const account = emptyAccount();
    account.policies.push({ id: "policy-1", name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include: [{ email: { email: OWNER } }] });
    const asked: Asked[] = [];
    const worker = instance(w, cloudflareOf(account, asked));
    const calls = api(worker, await tokenOf(w, "admin"), (input, init) => ask(worker, input, init, bindings), admin);
    const { database } = await installOf(w);
    await database.keepDomainCheck({ ran_at: w.clock.now, by: OWNER, run: "repair", pieces: [] }, {});
    const mailed = (): unknown => account.alerts.map((alert) => [alert.name, alert.mechanisms]);
    const to = (emails: readonly string[]): unknown => alerts.map((name) => [name, { email: emails.map((id) => ({ id })) }]);
    const marks = async (): Promise<unknown> => database.readDomainCheck().then((kept) => [kept?.users_changed_at ?? null, (kept?.alerts_changed_at ?? null) !== null]);
    const chosen = ["bo@example.com", OWNER];

    await done(await calls.config.$patch({ query: {}, json: { users: [OWNER, "bo@example.com"] as Login[] } }));
    const first = mailed();
    await done(await calls.config.$patch({ query: {}, json: { alert_users: chosen as Login[] } }));
    const carried = [mailed(), await marks()];
    wait(w, 0.25);
    await sweep(worker, w, bindings);
    const confirmed = await marks();
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    await sweep(worker, w, bindings);

    expect([first, carried, confirmed]).toEqual([to([OWNER]), [to(chosen), [null, true]], [null, false]]);
    expect([mailed(), await problemsOf(w)]).toEqual([to(chosen), []]);
  });

  // Drift: without the handler, or with one that never reaches the later parts of the walk, expired sites stay live in the listing and the bucket fills with files nothing serves.
  test("an expired site reaches the trash, then leaves it with its files after trash_days, and an upload nobody finished is removed with its files", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "publisher");
    const kept = await publish(worker, token, { name: "kept" }, [page("<p>kept</p>")]);
    const brief = await publish(worker, token, { name: "brief", expires: "1h" }, [page("<p>brief</p>")]);
    const manifest = [{ path: "index.html", size: HTML.byteLength, content_type: "text/html", sha256: await sha256Of(HTML) }];
    const begun = await done<{ upload: { id: string } }>(await api(worker, token).uploads.$post({ query: {}, json: { name: "unfinished", files: manifest } }));
    await done(await sendFile(api(worker, token), begun.upload.id, { path: "index.html", body: HTML }));
    const stored = await keysUnder("");

    wait(w, 2);
    await sweep(worker, w);
    const afterExpiry = await states();

    wait(w, 8 * 24);
    await sweep(worker, w);
    const { database } = await installOf(w);
    const left = await keysUnder("");
    const activity = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "trash" || entry.action === "delete");

    expect(stored).toHaveLength(3);
    expect(afterExpiry).toEqual({ live: 1, trash: 1 });
    expect(await states()).toEqual({ live: 1, trash: 0 });
    expect(left).toHaveLength(1);
    expect((await ask(worker, `${ADMIN}/api/sites/${kept.label}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(activity.map((entry) => `${entry.action} ${entry.site?.id === brief.id} by ${entry.by}`)).toEqual(["delete true by sweep@poplin.invalid", "trash true by sweep@poplin.invalid"]);
    expect(await database.listUploads({ before: w.clock.now, limit: 100 })).toEqual({ uploads: [] });
  });

  // Drift: the run comes 96 times a day whether anything is due or not. One that walked every site to find the due ones, and read the settings at each step, asked more of the database the more sites an install held, for nothing.
  test("a run with nothing due asks the database six questions on an instance that runs, and one more on a day's first run to keep what the website said, however many sites the install holds", async () => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    const install = await installOf(w);
    const file = { path: "index.html", size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() };
    for (let made = 0; made < 12; made += 1) await publishSite(install, { scope: "admin", holder: OWNER }, { name: `lasting-${made}`, files: [file] });
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    const run = async (): Promise<number> => {
      tally.calls = 0;
      await sweep(worker, w);

      return tally.calls;
    };

    const first = await run();
    wait(w, 0.25);
    const later = [await run()];
    wait(w, 0.25);
    later.push(await run());

    expect([first, later, await states()]).toEqual([7, [6, 6], { live: 12, trash: 0 }]);
  });

  // Drift: the same run on an install that holds a key, which also confirms what a change carried to Cloudflare. A run that read the marks in a call of its own, or asked Cloudflare with no mark set, would spend a call 96 times a day for nothing;
  // one that confirms must stay at the two calls its table counts, whether it finds Cloudflare as the settings ask or writes there.
  test("on an install that holds a key, a run with no mark set asks the database the same six questions and Cloudflare nothing; a run that confirms the rules or the alerts asks two more, whether it writes or finds them standing", async () => {
    const tally = { calls: 0 };
    const account = emptyAccount();
    account.policies.push({ id: "policy-1", name: INSTALL_OBJECTS.accessPolicy, decision: "allow", include: [{ email: { email: OWNER } }] });
    const asked: Asked[] = [];
    const keyed = { ...countedBindings(tally), KEPT_KEY: TOKEN };
    const worker = instance(w, cloudflareOf(account, asked));
    const session = await logIn(worker, w, keyed);
    const { database } = await installOf(w);
    await database.keepDomainCheck({ ran_at: w.clock.now, by: OWNER, run: "repair", pieces: [] }, {});
    // One run a quarter of an hour on: its calls to the database, and to Cloudflare.
    const run = async (): Promise<readonly [number, number]> => {
      wait(w, 0.25);
      tally.calls = 0;
      const before = asked.length;
      await sweep(worker, w, keyed);

      return [tally.calls, asked.length - before];
    };

    // The first run an install makes also keeps what the website said of the newest version.
    await run();
    const quiet = await run();
    await send(worker, `${ADMIN}/data/settings`, { texts: { outside_pages: "allowed" } }, session, keyed);
    // The rule the save wrote is gone again, as after a write that never landed.
    account.rulesets.http_request_firewall_custom?.rules.splice(0);
    const rulesWritten = await run();
    const rulesStand = await run();
    await send(worker, `${ADMIN}/data/people/add`, { login: "bo@example.com" }, session, keyed);
    account.alerts.splice(0);
    const alertsWritten = await run();
    const alertsStand = await run();

    expect([quiet, await run()]).toEqual([[6, 0], [6, 0]]);
    expect([rulesWritten, rulesStand, alertsWritten, alertsStand]).toEqual([[8, 4], [8, 3], [8, 6], [8, 4]]);
  });

  // Drift: R2 bills every listing past a month's free million writes, and the sweep lists a folder to empty it. A run that listed uncounted would have no bound; one that shared the day's bound with every publish could be kept from removing files for good.
  test("a run's listings are counted against the day; a day used up to the sweep's own share keeps the files of a removed site, and a day used up by everything else still lets the sweep remove them", async () => {
    const worker = instance(w);
    const { database } = await installOf(w);
    await publish(worker, await tokenOf(w, "publisher"), { name: "brief", expires: "1h" }, [page("<p>brief</p>")]);
    const most = (await database.readSettings())?.max_storage_writes_per_day ?? 0;
    const seen = async (): Promise<unknown> => [await states(), (await keysUnder("")).length, (await database.listLeftovers({ limit: 10 })).folders.length, (await database.readStorageWrites(dayOf(w.clock.now)))?.writes];

    wait(w, 2);
    await sweep(worker, w);
    wait(w, 8 * 24);
    await database.addStorageWrites(dayOf(w.clock.now), most + SWEEP_SPARE_WRITES);
    await sweep(worker, w);
    const usedUp = await seen();

    wait(w, 24);
    await database.addStorageWrites(dayOf(w.clock.now), most);
    await sweep(worker, w);

    expect([usedUp, await seen()]).toEqual([
      [{ live: 0, trash: 0 }, 1, 1, most + SWEEP_SPARE_WRITES],
      [{ live: 0, trash: 0 }, 0, 0, most + 1],
    ]);
  });

  // Drift: a run that failed was thrown into the provider's log of the schedule, which nobody opens, so sites stayed past their expiry with no word to the owner.
  test("a run the database fails is thrown on in fixed words, and noted as a clean-up that did not finish", async () => {
    const locked = { ...BINDINGS, DB: refusingDatabase(/sweep_place/i) };
    await ask(instance(w), `${ADMIN}/api/whoami`);

    const run = await sweep(instance(w), w, locked).then(() => "ran", String);

    expect(run).toBe("Error: poplin: the sweep failed (Error)");
    expect(await problemsOf(w)).toEqual([["sweep_failed", 1, "the table is locked"]]);
  });

  // Drift: nothing but the scheduled run ever asks which version is the newest. An entry that did not hand it the fetch, or a run that asked every time, would leave the install silent or have it ask the website 96 times a day.
  test("the runs of one day ask the website once, the API then names the newer version to a token, and the next day's first run asks again", async () => {
    const asked: string[] = [];
    const release = { version: "999.0.0", released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases/tag/v999.0.0", schema: OWN_SCHEMA + 1 };
    const latest = {
      fetch: async (address: string): Promise<Response> => {
        asked.push(new URL(address).pathname.split("/").at(-1) ?? "");

        return Response.json(release);
      },
    };
    const token = await tokenOf(w, "publisher");
    const whoami = async (): Promise<unknown> => (await done<{ update?: unknown }>(await api(instance(w, undefined, latest), token).whoami.$get({ query: {} }))).update;
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    const before = await whoami();

    for (let run = 0; run < 3; run += 1) {
      await sweep(instance(w, undefined, latest), w);
      wait(w, 0.25);
    }

    const sameDay = asked.length;
    const after = await whoami();
    wait(w, 24);
    await sweep(instance(w, undefined, latest), w);

    expect([before, sameDay, asked]).toEqual([undefined, 1, ["latest.json", "latest.json"]]);
    expect(after).toMatchObject({ newest: "999.0.0", released: "2026-12-01", notes: release.notes, database: true });
  });

  // Drift: an install has no build between a release and its running code: the scheduled run is the whole of it.
  // A run that read no key, sent the form another way than workerd does, or cost more queries than counted here would leave the switch dead or pass what D1 answers one invocation.
  test("with auto_update on and a kept key, the run three days after a release was first seen uploads it once inside a Free invocation, three database calls above a day's first run and one more for the logs stated, and no later run does", async () => {
    const release = await ownRelease("999.0.0");
    const tally = { calls: 0 };
    const run = async (): Promise<number> => {
      tally.calls = 0;
      await sweep(instance(w, release.cloudflare, release.latest), w, { ...freePlanBindings(tally), KEPT_KEY: OWN_KEY });

      return tally.calls;
    };
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const { database } = await installOf(w);
    await database.changeSettings({ auto_update: true }, { as: "person", by: OWNER, at: w.clock.now });
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;

    await run();
    wait(w, 3 * 24 - 0.25);
    await run();
    const early = release.uploads.length;
    wait(w, 0.25);
    const taking = await run();
    wait(w, 0.25);
    await run();
    wait(w, 24);
    const dayAfter = await run();
    const started = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "update_started").map(({ by, detail }) => ({ by, detail }));

    expect([early, taking - dayAfter]).toEqual([0, 4]);
    expect(release.uploads).toEqual([release.upload]);
    expect(started).toEqual([{ by: "sweep@poplin.invalid", detail: { from: OWN_VERSION, to: "999.0.0", automatic: true } }]);
    expect(await problemsOf(w)).toEqual([]);
  });

  // Drift: Cloudflare keeps no observability across an upload, and the release states its own. An update that read no setting would switch the logs back on, on an install that keeps none.
  test("with provider_logs off and a kept key, the run that begins a day switches the Worker's logs off, and the update the install takes by itself uploads with them off", async () => {
    const release = await ownRelease("999.0.0");
    const off = { enabled: false, head_sampling_rate: 1, logs: { enabled: false, invocation_logs: false } };
    const run = (): Promise<void> => sweep(instance(w, release.cloudflare, release.latest), w, { ...freePlanBindings({ calls: 0 }), KEPT_KEY: OWN_KEY });
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const { database } = await installOf(w);
    await database.changeSettings({ auto_update: true, provider_logs: false }, { as: "person", by: OWNER, at: w.clock.now });
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    const made = release.observability();

    await run();
    const stated = release.observability();
    wait(w, 3 * 24);
    await run();

    expect([made, stated, release.uploads, release.observability()]).toEqual([release.upload.observability, off, [{ ...release.upload, observability: off }], off]);
  });

  // Drift: a login nobody allowed or collected leaves the table by the sweep alone; a run that never reached the end of the walk would keep every one for good.
  test("a login that ran out is removed by the run that ends the walk, and one still waiting stays", async () => {
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`);
    const begin = async (): Promise<string> => (await done<{ code: string }>(await api(worker, null).logins.$post({ query: {}, json: { scope: "publisher", computer: "laptop" } }))).code;
    const { database } = await installOf(w);
    const stored = async (shown: string): Promise<boolean> => {
      const code = parseUserCode(shown);

      return code !== undefined && (await database.findComputerLogin(code)) !== undefined;
    };
    const old = await begin();

    wait(w, 1);
    const waiting = await begin();
    await sweep(worker, w);

    expect([await stored(old), await stored(waiting)]).toEqual([false, true]);
  });

  // Drift: a site's row can go while its files stay, when the removal is cut off; nothing but the scheduled run ever comes back for them, and it must do so inside its budget.
  test("files a removed site left in the bucket are gone after the next scheduled runs, each inside its call budget, and the files of other sites stay", async () => {
    const tally = { calls: 0 };
    const token = await tokenOf(w, "publisher");
    await publish(instance(w), token, { name: "kept" }, [page("<p>kept</p>")]);
    const cut = await publish(instance(w), token, { name: "cut-off" }, [page("<p>cut off</p>")]);
    const { database } = await installOf(w);
    const row = (await database.listSites({ trash: false, limit: 10 })).sites.find((site) => site.id === cut.id);
    if (row === undefined) throw new Error("the test's site is not there");

    await database.deleteSite(row.id, { as: "person", by: OWNER, at: w.clock.now });
    const before = [(await keysUnder("")).length, (await database.listLeftovers({ limit: 10 })).folders.length];
    const runs: number[] = [];

    for (let run = 0; run < 4; run += 1) {
      wait(w, 0.25);
      tally.calls = 0;
      await sweep(instance(w), w, freePlanBindings(tally));
      runs.push(tally.calls);
    }

    expect(before).toEqual([2, 1]);
    expect([(await keysUnder("")).length, await database.listLeftovers({ limit: 10 }), await states()]).toEqual([1, { folders: [] }, { live: 1, trash: 0 }]);
    expect([Math.min(...runs) > 0, Math.max(...runs) <= INVOCATION_CALLS]).toEqual([true, true]);
  });

  // Drift: a run starts a step only while the most a step can cost still fits; a step that cost more than the run allows for would pass the invocation's budget unseen.
  test("a run whose first step is as costly as a step gets, five sat-out sites that each take a whole removal, stays inside one invocation's calls", async () => {
    const tally = { calls: 0 };
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const install = await installOf(w);
    const files = Array.from({ length: WHOLE_REMOVAL }, (_, at) => ({ path: at === 0 ? "index.html" : `page-${at}.html`, size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() }));

    for (let made = 0; made < 5; made += 1) {
      const site = await publishSite(install, { scope: "admin", holder: OWNER }, { name: `large-${made}`, files });
      if (!site.ok) throw new Error(`the test's site was refused: ${site.code}`);

      await install.database.trashSite(site.site.id, { as: "person", by: OWNER, at: w.clock.now });
    }

    wait(w, 8 * 24);
    const counted = freePlanBindings(tally);
    await sweep(instance(w), w, { ...counted, SITES: shortPages(counted.SITES) });

    expect([await states(), (await keysUnder("")).length]).toEqual([{ live: 0, trash: 0 }, 0]);
    expect(tally.calls).toBeGreaterThanOrEqual(MOST_STEP_CALLS);
    expect(tally.calls).toBeLessThanOrEqual(INVOCATION_CALLS);
  });

  // Drift: Cloudflare may start a new instance for every cron run, and D1 answers a Free invocation 50 queries. A run that walked the sites to find the due ones spent them on the rest, and an expired site waited a run for every fifty live ones before it.
  // A run takes fifteen due sites, and the next one, whatever instance makes it, finds the rest as the first ones still due.
  test("thirty expired sites behind sixty newer live ones reach the trash in two runs, fifteen in the first, each run a new instance that D1 refuses a fifty-first query", async () => {
    const tally = { calls: 0 };
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const install = await installOf(w);
    const file = { path: "index.html", size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() };

    for (const [count, name, expires] of [[30, "brief", "1h"], [60, "lasting", "never"]] as const) {
      for (let made = 0; made < count; made += 1) {
        const site = await publishSite(install, { scope: "admin", holder: OWNER }, { name: `${name}-${made}`, expires, files: [file] });
        if (!site.ok) throw new Error(`the test's site was refused: ${site.code}`);
      }

      wait(w, 2);
    }

    const runs = [];
    for (let run = 0; run < 3; run += 1) {
      wait(w, 0.25);
      tally.calls = 0;
      await sweep(instance(w), w, freePlanBindings(tally));
      runs.push({ calls: tally.calls, trash: (await states()).trash });
    }

    expect(runs.map((run) => run.trash)).toEqual([15, 30, 30]);
    expect(Math.max(...runs.map((run) => run.calls))).toBeLessThanOrEqual(INVOCATION_CALLS);
  });

  // Drift: a run's rows written are bounded by the items it changes; a last step that took a whole page past the bound would let a run write more than its day's share allows for.
  test("a run that meets four expired sites and twenty past their days in the trash changes fifteen: the four, and eleven of the twenty", async () => {
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const install = await installOf(w);
    const file = { path: "index.html", size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() };
    const published = async (name: string, expires: "1h" | "never") => {
      const site = await publishSite(install, { scope: "admin", holder: OWNER }, { name, expires, files: [file] });
      if (!site.ok) throw new Error(`the test's site was refused: ${site.code}`);

      return site.site.id;
    };

    for (let made = 0; made < 20; made += 1) await install.database.trashSite(await published(`old-${made}`, "never"), { as: "person", by: OWNER, at: w.clock.now });
    wait(w, 8 * 24);
    for (let made = 0; made < 4; made += 1) await published(`brief-${made}`, "1h");
    wait(w, 2);
    await sweep(instance(w), w);

    expect(await states()).toEqual({ live: 0, trash: 13 });
  });

  // Drift: Cloudflare writes what a run throws into its log, message and all, and an error's message may repeat a stored value. A run that threw its own error would put that value in the log; one that swallowed it would look like a run that worked.
  test("a run on a Worker with a wrong variable fails in fixed words, and the log names the variable, never its value, and where the run stopped", async () => {
    using failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...BINDINGS, ZONE: { public_word: "wiki" } } as unknown as typeof BINDINGS;

    const thrown = await sweep(instance(w), w, broken).catch((error: unknown) => error);
    const lines = failed.mock.calls.map(([line]) => String(line));

    expect(String(thrown)).toBe("Error: poplin: the sweep failed (Error)");
    expect(lines.map((line) => line.split("\n")[0])).toEqual(["poplin: the sweep did not run. This poplin install cannot start. These variables of its Worker are missing or wrong:"]);
    expect([lines[0]?.includes("  ZONE: bad-shape"), `${lines.join("\n")}${(thrown as Error).stack}`.includes("wiki")]).toEqual([true, false]);
  });
});
