// A repair with an account token against a whole install at the fake API, whose database is asked through the API's query route.
// Without these a repair from a terminal could change what stands, leave one kind of install behind, or let a token that may only read add a user.

import { describe, expect, test } from "bun:test";
import { type Login, parseLogin } from "@poplin/core/src/auth/logins";
import type { Mend, Repaired, Run, Token, Whole } from "@poplin/core/src/install/installer";
import type { Place, Where } from "../../../../../src/shared/install/first/find";
import { installer } from "../../../../../src/shared/install/first/installer";
import { ACCOUNT, type Account, emptyAccount, KEY_VALUE_START, TOKEN } from "../../support/fake-install";
import { type Store, storeOf } from "../../support/fake-store";
import { worldOf } from "../../support/fake-reach";
import type { Asked } from "../../support/replies";

/** The first login of every install here, and the email a repair is asked to add. */
const [OWNER, LOST] = [loginOf("owner@example.com"), loginOf("lost@example.com")];

/** The token, in the form the provider takes. */
const KEY = tokenOf(TOKEN);

/** The two kinds of install: where each goes, the other kind's place, and the dashboard's address. */
const KINDS = {
  domain: { where: placeOf([["domain", "example.com"]]), other: placeOf([["no-domain", true]]), address: "https://poplin.example.com", elsewhere: "The install here is under the domain example.com: give --domain example.com." },
  "no-domain": { where: placeOf([["no-domain", true]]), other: placeOf([["domain", "example.com"]]), address: "https://poplin.example.workers.dev", elsewhere: "The install here has no domain: give --no-domain." },
} as const;

/** A dry run, and a run. */
const [DRY, APPLY]: readonly [Run, Run] = ["dry-run", "apply"];

/** The calls a repair that changes nothing sends, pinned for each kind: all of them read. */
const CALLS: Readonly<Record<keyof typeof KINDS, number>> = { domain: 30, "no-domain": 26 };

/** The alerts of each kind that are mailed to the first user, each with the call that changes it once that user is another: a row, then a call. */
const FOLLOWS: Readonly<Record<keyof typeof KINDS, readonly (readonly [string, string])[]>> = {
  domain: [
    ["Budget alert | change | poplin: usage charges reached 1 dollar", `PUT /accounts/${ACCOUNT}/alerting/v3/policies/made-0`],
    ["Certificate alert | change | poplin: certificates of every domain of the account", `PUT /accounts/${ACCOUNT}/alerting/v3/policies/made-1`],
  ],
  "no-domain": [["Budget alert | change | poplin: usage charges reached 1 dollar", `PUT /accounts/${ACCOUNT}/alerting/v3/policies/made-0`]],
};

/** The calls that add one user, in order: the policy is found, written, and only then is the user stored. */
const ADD_CALLS = [`GET /accounts/${ACCOUNT}/access/policies`, `PUT /accounts/${ACCOUNT}/access/policies/made-1`, `POST /accounts/${ACCOUNT}/d1/database/made-0/query`];

/** What the row of a user says where the token may not write the login. */
const LACKS_ACCESS = "User | block | lost@example.com: The token lacks a permission. Add this one: Access: Apps and Policies: Edit";

/** The kinds, for a test of each. */
const BOTH = Object.keys(KINDS) as (keyof typeof KINDS)[];

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

/** Read a place from options a test wrote by hand; a refusal is a mistake in the test. */
function placeOf(flags: readonly (readonly [string, string | true])[]): Where {
  const read = installer.read({ flags: new Map(flags), env: {} });
  if (!read.ok) throw new Error(`the test's place was refused: ${JSON.stringify(read)}`);

  return read.where;
}

/** Whether a call changes anything: any call but a read, and a call of the query route only where a statement of it writes. */
function writes(entry: Asked): boolean {
  if (entry.method === "GET") return false;

  const { sql } = (entry.body ?? {}) as { readonly sql?: string };

  return !entry.path.endsWith("/query") || /\b(insert|update|delete)\b/i.test(sql ?? "");
}

function shown(done: Repaired): string[] {
  if (!done.ok) return [`not mended: ${done.why}: ${done.words}`];

  return done.rows.map((row) => `${row.object} | ${row.state} | ${row.detail}`);
}

/** The emails the login's policy lets through at the fake API. */
function letThrough(account: Account): string[] {
  const policy = account.policies.find((candidate) => candidate.name === "poplin logins") as { readonly include?: readonly { readonly email: { readonly email: string } }[] } | undefined;

  return (policy?.include ?? []).map((rule) => rule.email.email);
}

/**
 * Make a whole install of a kind in a new account, as `poplin install` makes it, with its first login stored.
 *
 * @param changes - how the account differs while the install is made, such as Access switched off
 * @param stored - what the install's database holds: the settings of an install whose first login is this one, or `nothing` for an install that never answered a request
 */
async function wholeInstall(kind: keyof typeof KINDS, changes: Partial<Account> = {}, stored: Login | "nothing" = OWNER): Promise<Omit<Account, "store"> & { store: Store }> {
  const account: Account = { ...emptyAccount(), bindings: [], noWorker: true, ...changes };
  const world = await worldOf(account);
  const found = await installer.find(KEY, KINDS[kind].where, world.reach);
  if (found.state !== "none") throw new Error(`the test's account was not empty: ${found.state}`);

  await installer.install(found, KINDS[kind].where, OWNER, APPLY, world.reach, () => undefined);

  return Object.assign(account, { store: await storeOf(stored === "nothing" ? undefined : stored) });
}

/** What one find and one repair left behind: what the repair came to and told on the way, and every call it sent. */
interface Outcome {
  readonly done: Repaired;
  readonly said: string[];
  readonly calls: readonly Asked[];
  readonly changes: string[];
}

/** Find the install, then repair it, in one stand-in world. */
async function repaired(account: Account, kind: keyof typeof KINDS, mend: Partial<Mend> = {}, where: Where = KINDS[kind].where): Promise<Outcome> {
  const world = await worldOf(account);
  const found = await installer.find(KEY, where, world.reach);
  if (found.state !== "whole") throw new Error(`no whole install to repair: ${found.state}`);

  const sought = world.asked.length;
  const said: string[] = [];
  const whole: Whole<Place> = found;
  const done = await installer.repair(whole, where, { run: APPLY, addUser: undefined, ...mend }, world.reach, (row) => said.push(`${row.object} | ${row.state} | ${row.detail}`));
  const calls = world.asked.slice(sought);

  return { done, said, calls, changes: calls.filter(writes).map((entry) => `${entry.method} ${entry.path.split("?")[0]}`) };
}

describe.each(BOTH)("a repair with the token, %s", (kind) => {
  // Drift: a repair is run on installs that work. One that wrote where nothing differs would redeploy the Worker or mint keys on every run.
  test("an install with nothing broken is left as it is: every row is left, no call changes anything, and the pinned number of calls is sent", async () => {
    const account = await wholeInstall(kind);
    const before = structuredClone({ ...account, store: undefined });
    const { done, said, calls, changes } = await repaired(account, kind);

    expect([...new Set(shown(done).map((row) => row.split(" | ")[1]))]).toEqual(["leave"]);
    expect([changes, calls.length, said, { ...account, store: undefined }]).toEqual([[], CALLS[kind], shown(done), before]);
    expect(done).toMatchObject({ ok: true, ready: true, blocked: [], steps: [], address: KINDS[kind].address });
  });

  // Drift: a dry run that read a piece another way than the run mends it would promise a list no run works through.
  test("with one piece gone, a dry run names it and sends no change, and the run after it makes that piece alone and leaves the rest", async () => {
    const account = await wholeInstall(kind);
    account.workflows = [];
    const dry = await repaired(account, kind, { run: DRY });
    const run = await repaired(account, kind);
    const made = shown(run.done).filter((row) => !row.includes(" | leave | "));

    expect([dry.changes, shown(dry.done), dry.done.ok && dry.done.ready]).toEqual([[], shown(run.done), true]);
    expect([made, run.changes, run.done.ok && run.done.ready]).toEqual([["Workflow | make | poplin-jobs"], [`PUT /accounts/${ACCOUNT}/workflows/poplin-jobs`], true]);
    expect(account.workflows).toEqual([{ name: "poplin-jobs", script_name: "poplin", class_name: "PoplinJobs" }]);
  });

  // Drift: the Worker stores every setting its `FIRST_SETTINGS` names on its first start. A repair before that start that read the first login alone would mend the login to fewer users than the install is about to have.
  test("an install that never answered a request is mended to every setting its Worker starts with, each first login among them", async () => {
    const account = await wholeInstall(kind, {}, "nothing");
    account.bindings = account.bindings.map((binding) => (binding.name === "FIRST_SETTINGS" ? { ...binding, json: { logins: `${OWNER}, ${LOST}` } } : binding));
    const { done } = await repaired(account, kind);

    expect([done.ok && done.ready, letThrough(account)]).toEqual([true, [LOST, OWNER]]);
  });

  // Drift: `poplin install` calls an install whole once it wrote where it answers, so one that went on with Access off is refused by a second install: only a repair finishes it.
  test("an install that was made with Access switched off, and never answered a request, is finished with its first login once Access is on", async () => {
    const account = await wholeInstall(kind, { accessOff: true }, "nothing");
    account.accessOff = false;
    const { done } = await repaired(account, kind);
    const made = shown(done).filter((row) => row.includes(" | make | ")).map((row) => row.split(" | ")[0]);

    expect([made, done.ok && done.ready, letThrough(account)]).toEqual([["Access application", "Access policy", "Access open paths", "Access open paths", "Worker variable"], true, [OWNER]]);
    expect(account.bindings.some((binding) => binding.name === "ACCESS")).toBe(true);
    expect(shown((await repaired(account, kind)).done).filter((row) => !row.includes(" | leave | "))).toEqual([]);
  });

  // Drift: a token made for one job lacks a permission. A run that stopped at the first refusal would leave the pieces behind it unmended and unnamed.
  test("a token without one permission gets a blocked row that names it, the pieces that need other permissions are still mended, and the run is not ready", async () => {
    const account = await wholeInstall(kind);
    account.workflows = [];
    Object.assign(account, { refuse: `GET /accounts/${ACCOUNT}/access/policies`, refuseMessage: "Authentication error" });
    const { done } = await repaired(account, kind);
    const right = "Access: Apps and Policies: Edit";

    expect(shown(done).filter((row) => row.startsWith("Access application") || row.startsWith("Workflow"))).toEqual([
      `Access application | block | refused with status 403: 10000 Authentication error. Add this right to the account token: ${right}`,
      "Workflow | make | poplin-jobs",
    ]);
    expect(done).toMatchObject({ ok: true, ready: false, blocked: [{ what: "right_lacking", right }] });
  });

  // Drift: the Worker admits the stored users alone. A repair that mended the login to anything else would let through emails the install does not know, or shut out the ones it does.
  test("the login is mended to the users the install has stored, not to the first login the install was made with", async () => {
    const account = await wholeInstall(kind, {}, loginOf("adopted@example.com"));
    const { done, changes } = await repaired(account, kind);

    // Every alert of the kind is mailed to the first user, so each follows.
    expect([shown(done).filter((row) => !row.includes(" | leave | ")), changes, letThrough(account)]).toEqual([
      ["Access policy | change | poplin logins", ...FOLLOWS[kind].map(([row]) => row)],
      [`PUT /accounts/${ACCOUNT}/access/policies/made-1`, ...FOLLOWS[kind].map(([, call]) => call)],
      ["adopted@example.com"],
    ]);
  });

  // Drift: the place a person names says which account is looked in, and an install of the other kind may be there. Mended as the kind that was named, it would be given another kind's pieces.
  test("a place that is not the install's own is refused before the settings are read, and nothing changes", async () => {
    const account = await wholeInstall(kind);
    const { done, calls, changes } = await repaired(account, kind, {}, KINDS[kind].other);

    expect([done, changes, calls.some((entry) => entry.path.endsWith("/query"))]).toEqual([{ ok: false, why: "elsewhere", words: KINDS[kind].elsewhere }, [], false]);
  });
});

describe.each(BOTH)("one more user, %s", (kind) => {
  // Drift: a user that is stored and not in the login gets no code, and one in the login and not stored is turned away by the Worker: both must be written, the login first.
  test("the email is written into the login with the token, then stored with an entry of the change, in three calls in that order", async () => {
    const account = await wholeInstall(kind);
    const { done, calls, changes } = await repaired(account, kind, { addUser: LOST });
    const [entry] = await account.store.database.listAudit({ limit: 1 });
    const last = calls.slice(-ADD_CALLS.length).map((asked) => `${asked.method} ${asked.path.split("?")[0]}`);

    expect([shown(done).at(-1), done.ok && done.ready, changes, last]).toEqual(["User | make | lost@example.com", true, ADD_CALLS.slice(1), ADD_CALLS]);
    expect([letThrough(account), (await account.store.database.readSettings())?.logins]).toEqual([[LOST, OWNER], [OWNER, LOST]]);
    expect(entry).toMatchObject({ action: "settings_changed", by: "doctor-repair@poplin.invalid", detail: { logins: [OWNER, LOST] } });
  });

  // Drift: this is the rule the command stands on. A token that proves only that it can see the install must add nobody: a stored user is carried to the login later by the install's own, stronger key.
  test("a token that may read everything and write nothing is refused with the permission's name: the login is unchanged, nothing is stored, and no entry is written", async () => {
    const account = await wholeInstall(kind);
    account.refuse = ["PUT *", "DELETE *", "PATCH *"];
    const { done, changes } = await repaired(account, kind, { addUser: LOST });

    expect([shown(done).at(-1), done.ok && done.ready, changes]).toEqual([LACKS_ACCESS, false, [`PUT /accounts/${ACCOUNT}/access/policies/made-1`]]);
    expect(done).toMatchObject({ blocked: [{ what: "right_lacking", right: "Access: Apps and Policies: Edit" }] });
    expect([letThrough(account), (await account.store.database.readSettings())?.logins, (await account.store.database.listAudit({ limit: 10 })).map((entry) => entry.action)]).toEqual([[OWNER], [OWNER], ["settings_set"]]);
  });

  // Drift: a policy that already holds the email proves nothing of the token: it was read. Storing on that would let a token that may only read finish what another began.
  test("where the login already lets the email in, the write is still sent, and a token it is refused for stores nothing", async () => {
    const account = await wholeInstall(kind);
    const policy = account.policies.find((candidate) => candidate.name === "poplin logins");
    if (policy !== undefined) policy.include = [OWNER, LOST].map((email) => ({ email: { email } }));

    account.refuse = `PUT /accounts/${ACCOUNT}/access/policies/*`;
    const { done } = await repaired(account, kind, { addUser: LOST });

    expect([shown(done).at(-1), (await account.store.database.readSettings())?.logins]).toEqual([LACKS_ACCESS, [OWNER]]);
  });

  // Drift: a write the provider did not take, for whatever reason, is no proof. The user must not be stored for a later run or the install's own key to carry.
  test("a write of the login that fails stores nothing, and the row says the status alone", async () => {
    const account = await wholeInstall(kind);
    Object.assign(account, { refuse: `PUT /accounts/${ACCOUNT}/access/policies/*`, refuseAs: { status: 400, code: 12130 } });
    const { done, changes } = await repaired(account, kind, { addUser: LOST });

    expect([shown(done).at(-1), changes.filter((call) => call.endsWith("/query")), (await account.store.database.readSettings())?.logins]).toEqual(["User | fail | lost@example.com: refused with status 400", [], [OWNER]]);
  });

  // Drift: the three statements of the store are one call, so a store that fails keeps nothing: no user without its entry, and no entry without its user.
  test("a store the database refuses after the login was written keeps nothing of it, and the row says to run again", async () => {
    const account = await wholeInstall(kind);
    const { call } = account.store;
    account.store = {
      ...account.store,
      call: async (sql, params) => {
        if (/\bupdate\b/i.test(sql)) throw new Error("You do not have permission to perform this operation.");

        return call(sql, params);
      },
    };
    const { done } = await repaired(account, kind, { addUser: LOST });

    expect(shown(done).at(-1)).toBe("User | fail | lost@example.com: the login lets the email in, and the install did not store it. Run this again: refused with status 400");
    expect([letThrough(account), (await account.store.database.readSettings())?.logins, (await account.store.database.listAudit({ limit: 10 })).length]).toEqual([[LOST, OWNER], [OWNER], 1]);
  });

  // Drift: a dry run is what an agent runs first. One that wrote the login or stored the user would be no dry run, and one that named another row than the run would mislead.
  test("a dry run names the user a run would add and changes nothing; an email that is a user already is left, by a run too, which stores nothing", async () => {
    const account = await wholeInstall(kind);
    const dry = await repaired(account, kind, { run: DRY, addUser: LOST });
    const known = await repaired(account, kind, { addUser: OWNER });

    expect([shown(dry.done).at(-1), dry.changes, letThrough(account)]).toEqual(["User | make | lost@example.com", [], [OWNER]]);
    expect([shown(known.done).at(-1), known.changes, (await account.store.database.listAudit({ limit: 10 })).length]).toEqual(["User | leave | owner@example.com: a user already", [`PUT /accounts/${ACCOUNT}/access/policies/made-1`], 1]);
  });

  // Drift: an install that never answered a request has stored no users, so there is no list to add to. A person who is shut out cannot open the dashboard to make it answer: the address named must be one the login lets through.
  test("an install that has stored no users yet adds none, and names an address that passes the login to ask once", async () => {
    const account = await wholeInstall(kind, {}, "nothing");
    const { done, changes } = await repaired(account, kind, { addUser: LOST });

    const ask = `${KINDS[kind].address}/api/whoami`;

    expect([shown(done).at(-1), changes]).toEqual([`User | block | lost@example.com: the install has stored no users yet. It stores them when it first answers: ask this address once, then run this again: ${ask}`, []]);
  });
});

// Drift: the token is a secret of the run, and Cloudflare may quote it in a refusal. A row, a step, or a block that held it would print it.
test("no row, step, or block of a repair holds the token or the value of a key it made, though a refusal the provider sent quotes the token", async () => {
  const account = await wholeInstall("domain");
  Object.assign(account, { tokens: [], refuse: `PUT /accounts/${ACCOUNT}/access/policies/*`, refuseQuotes: true });
  const { done } = await repaired(account, "domain", { addUser: LOST });
  const told = JSON.stringify(done);

  expect([told.includes(KEY_VALUE_START), told.includes(TOKEN), shown(done).filter((row) => row.startsWith("Key") || row.startsWith("Upload key"))]).toEqual([false, false, ["Key | change | poplin kept key", "Upload key | change | poplin upload key"]]);
});
