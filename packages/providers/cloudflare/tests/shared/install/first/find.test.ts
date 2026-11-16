// What a token finds of poplin in an account at the fake API, before an install makes anything.
// Without these an install could be made over one that is there, over somebody else's Worker, or with a token whose missing permission shows only after half of it is made.

import { describe, expect, test } from "bun:test";
import type { Found, Token } from "@poplin/core/src/install/installer";
import { findInstall, type Place, type Where } from "../../../../src/shared/install/first/find";
import { lacksRight, rightFor } from "../../../../src/with-domain/zone-plug";
import { ACCOUNT, type Account, emptyAccount, OTHER_TOKEN, TOKEN } from "../support/fake-install";
import { LAYOUT, layoutOf } from "../support/layouts";
import { RELEASE, worldOf } from "../support/fake-reach";

/** An install under the tests' domain, and one without a domain. */
const [DOMAIN, NONE]: readonly [Where, Where] = [
  { kind: "domain", layout: LAYOUT, account: undefined },
  { kind: "no-domain", account: undefined },
];

/** The bindings a first upload gives the Worker: poplin's marks. */
const MARKS = [
  { name: "SITES", type: "r2_bucket", bucket_name: "poplin-sites" },
  { name: "DB", type: "d1", id: "database-1" },
  { name: "JOBS", type: "workflow", workflow_name: "poplin-jobs" },
  { name: "WORKER_NAME", type: "plain_text", text: "poplin" },
];

/** Where a first upload says the install was started for: under the tests' domain, or without one. */
const STARTED_FOR = {
  domain: { name: "INSTALL_PLACE", type: "plain_text", text: "example.com" },
  none: { name: "INSTALL_PLACE", type: "plain_text", text: "none" },
} as const;

/** What a look answers for an install that was started for another place than the one named. */
const ELSEWHERE = {
  domain: { state: "refused", why: "other_place", words: "An install was started in this account under the domain example.com, and not finished: give --domain example.com." },
  none: { state: "refused", why: "other_place", words: "An install was started in this account without a domain, and not finished: give --no-domain." },
} as const;

/** The account an install that is set runs in, as its Worker holds it. */
const IN_ACCOUNT = { name: "ACCOUNT_ID", type: "plain_text", text: ACCOUNT };

/** The variables of an install that is set, on the account's free address. */
const SET = [{ name: "ZONE", type: "json", json: JSON.stringify({ account_address: "example" }) }, IN_ACCOUNT];

/** An account with nothing of poplin's in it, and no Worker. */
function fresh(changes: Partial<Account> = {}): Account {
  return { ...emptyAccount(), bindings: [], noWorker: true, ...changes };
}

/** Find with a token: what was found, the same with no place in it, and which calls were sent. */
async function found(account: Account, where: Where, token = TOKEN): Promise<{ readonly found: Found<Where, Place>; readonly shown: Readonly<Record<string, unknown>>; readonly calls: string[] }> {
  const world = await worldOf(account);
  const state = await findInstall(token as Token, where, world.reach, { lacks: lacksRight, nameOf: rightFor });
  const { place: _, ...shown } = { place: undefined, ...state };

  return { found: state, shown, calls: world.asked.map((entry) => `${entry.method} ${entry.path.split("?")[0]}`) };
}

describe("the states of an account", () => {
  // Drift: every name is fixed, so what a run does next hangs on which of these is found. A state read wrong makes a second copy, or writes over what is not poplin's.
  test.each([
    ["nothing", fresh(), { state: "none", notes: [] }],
    [
      "a database of the name",
      fresh({ databases: [{ uuid: "database-9", name: "poplin" }] }),
      { state: "leftover", words: "There is a database named poplin in this account, and no poplin runs. It may hold an earlier install's sites and records. It is matched by its name alone." },
    ],
    ["a bucket of the name", fresh({ buckets: [{ name: "poplin-sites" }] }), { state: "leftover", address: `https://dash.cloudflare.com/${ACCOUNT}/r2/overview` }],
    [
      "both",
      fresh({ databases: [{ uuid: "database-9", name: "poplin" }], buckets: [{ name: "poplin-sites" }] }),
      { state: "leftover", words: "There is a database named poplin and a bucket named poplin-sites in this account, and no poplin runs. They may hold an earlier install's sites and records. They are matched by their names alone." },
    ],
    ["a database and a bucket of other names", fresh({ databases: [{ uuid: "database-9", name: "poplin-old" }], buckets: [{ name: "poplin-sites-2" }] }), { state: "none" }],
    ["a Worker of the name with other bindings", fresh({ noWorker: false, bindings: [{ name: "SITES", type: "r2_bucket" }, { name: "DB", type: "d1" }] }), { state: "held", address: `https://dash.cloudflare.com/${ACCOUNT}/workers/services/view/poplin` }],
    ["a Worker of the name with no binding at all", fresh({ noWorker: false, bindings: [] }), { state: "held" }],
    ["a Worker that names itself otherwise", fresh({ noWorker: false, bindings: [...MARKS.slice(0, 3), { name: "WORKER_NAME", type: "plain_text", text: "other" }] }), { state: "held" }],
    ["Access switched off", fresh({ accessOff: true }), { state: "none", notes: [{ what: "login_off", address: `https://one.dash.cloudflare.com/${ACCOUNT}` }] }],
  ] as const)("finds %s", async (_, account, state) => {
    for (const where of [DOMAIN, NONE]) expect((await found(account, where)).found).toMatchObject(state);
  });

  // Drift: a run that stopped after its upload has made records and routes under a domain, or forwarders without one. Gone on with as the other kind, those stay in the account, and no removal has a row for them.
  test.each([
    ["under a domain, named under it", [...MARKS, STARTED_FOR.domain], DOMAIN, { state: "started", notes: [] }],
    ["under a domain, named without one", [...MARKS, STARTED_FOR.domain], NONE, ELSEWHERE.domain],
    ["without a domain, named without one", [...MARKS, STARTED_FOR.none], NONE, { state: "started", notes: [] }],
    ["without a domain, named under one", [...MARKS, STARTED_FOR.none], DOMAIN, ELSEWHERE.none],
    ["without a domain, with where it answers and no account yet", [...MARKS, STARTED_FOR.none, ...SET.slice(0, 1)], NONE, { state: "started" }],
  ] as const)("finds an install that was started %s, and refuses the place of another kind", async (_, bindings, where, state) => {
    const looked = await found(fresh({ noWorker: false, bindings: [...bindings] }), where);

    expect([looked.shown, looked.calls.filter((call) => !call.startsWith("GET "))]).toMatchObject([state, []]);
  });

  // Drift: a person or an agent does what the stop says. A real install whose Worker lost a binding, told as a stranger to delete, loses both keys and leaves everything else behind.
  test.each([
    [
      "a set install whose Worker lost its Workflow",
      [...MARKS.filter((mark) => mark.name !== "JOBS"), ...SET],
      "A Worker named poplin is in this account. It carries poplin's name and lacks JOBS (Workflow poplin-jobs, class PoplinJobs): it looks like an install that was deployed again by hand. " +
        "Keep it: it may hold the install's keys. Put the binding back on the Worker's Bindings page in your browser, then run poplin doctor --repair.",
      "repair",
    ],
    [
      "a Worker that is not set and kept its name alone",
      MARKS.slice(3),
      "A Worker named poplin is in this account. It carries poplin's name and lacks SITES (R2 bucket poplin-sites), DB (D1 database poplin), JOBS (Workflow poplin-jobs, class PoplinJobs), " +
        "and INSTALL_PLACE (plain text: the domain the install was started under, or none): it looks like an install that was deployed again by hand. " +
        "Keep it: it may hold the install's keys. Put the bindings back on the Worker's Bindings page in your browser, then run poplin install again.",
      "install",
    ],
    [
      "a Worker that is not set and does not say where it was started for",
      MARKS,
      "A Worker named poplin is in this account. It carries poplin's name and lacks INSTALL_PLACE (plain text: the domain the install was started under, or none): it looks like an install that was deployed again by hand. " +
        "Keep it: it may hold the install's keys. Put the binding back on the Worker's Bindings page in your browser, then run poplin install again.",
      "install",
    ],
    ["a Worker with none of poplin's name", MARKS.slice(0, 3), "A Worker named poplin is in this account and does not carry poplin's name, so nothing here touches it. Give it another name in your browser, then run this again.", "again"],
  ] as const)("tells %s in words that never say to delete it, and names the command its words name for a program", async (_, bindings, words, after) => {
    const address = `https://dash.cloudflare.com/${ACCOUNT}/workers/services/view/poplin`;

    for (const where of [DOMAIN, NONE]) expect((await found(fresh({ noWorker: false, bindings: [...bindings] }), where)).shown).toEqual({ state: "held", words, address, after });
  });

  // Drift: a whole install is never touched by an install. Its version and its address are what the command tells the person in place of making anything.
  test("a set install is found whole, with the version its latest upload was tagged with, its dashboard's address, and the newest release; one with no tag is whole with no version", async () => {
    const account = fresh({ noWorker: false, bindings: [...MARKS, ...SET], versions: [{ id: "version-2", number: 2, annotations: { "workers/tag": "0.2.0" } }, { id: "version-1", number: 1, annotations: { "workers/tag": "0.1.0" } }] });
    const whole = await found(account, NONE);

    expect(whole.shown).toEqual({ state: "whole", version: "0.2.0", address: "https://poplin.example.workers.dev", newest: RELEASE });
    expect(whole.calls).toEqual(["GET /accounts", "GET /accounts", `GET /accounts/${ACCOUNT}/workers/scripts/poplin/settings`, `GET /accounts/${ACCOUNT}/workers/scripts/poplin/versions`]);
    expect((await found({ ...account, versions: [{ id: "version-1", number: 1 }] }, NONE)).found).toMatchObject({ state: "whole", version: undefined });
    expect((await found({ ...account, bindings: [...MARKS, { name: "ZONE", type: "json", json: { domain: "example.com" } }, IN_ACCOUNT] }, DOMAIN)).found).toMatchObject({ state: "whole", address: "https://poplin.example.com" });
  });

  // Drift: what was found is what a command prints for a program. Its place holds the token, so it must not be a part of what is printed.
  test("what was found, written as JSON, holds no token and no place", async () => {
    const written = JSON.stringify((await found(fresh(), NONE)).found);

    expect([written.includes(TOKEN), written]).toEqual([false, '{"state":"none","notes":[]}']);
  });

  // Drift: the number of calls before anything is made is what a person waits for, and what a rate limit counts.
  test("an account with nothing in it is read in six calls, with a domain and without, none of which changes anything", async () => {
    const reads = [`GET /accounts/${ACCOUNT}/workers/scripts/poplin/settings`, `GET /accounts/${ACCOUNT}/d1/database`, `GET /accounts/${ACCOUNT}/r2/buckets`, `GET /accounts/${ACCOUNT}/access/apps`];

    expect([(await found(fresh(), NONE)).calls, (await found(fresh(), DOMAIN)).calls]).toEqual([
      ["GET /accounts", "GET /accounts", ...reads],
      ["GET /zones", "GET /zones", ...reads],
    ]);
  });
});

describe("what stops an install before it is begun", () => {
  // Drift: a token without a permission, and storage that is switched off, are told apart by the one code Cloudflare gives a missing permission. Read alike, a person is sent to add a permission that is there.
  test.each([
    ["the storage permission", { refuse: `GET /accounts/${ACCOUNT}/r2/buckets` }, [{ what: "right_lacking", right: "Workers R2 Storage: Edit", address: "https://dash.cloudflare.com/profile/api-tokens" }]],
    ["storage that is not switched on", { refuse: `GET /accounts/${ACCOUNT}/r2/buckets`, refuseAs: { status: 400, code: 10042 } }, [{ what: "storage_off", address: `https://dash.cloudflare.com/${ACCOUNT}/r2/overview` }]],
    ["storage refused with the status of a missing permission and another code", { refuse: `GET /accounts/${ACCOUNT}/r2/buckets`, refuseAs: { status: 403, code: 10042 } }, [{ what: "storage_off" }]],
    ["the database permission", { refuse: `GET /accounts/${ACCOUNT}/d1/database` }, [{ what: "right_lacking", right: "D1: Edit" }]],
    ["the login's permission", { refuse: `GET /accounts/${ACCOUNT}/access/apps` }, [{ what: "right_lacking", right: "Access: Apps and Policies: Edit" }]],
    ["the Worker's permission", { refuse: `GET /accounts/${ACCOUNT}/workers/scripts/poplin/settings` }, [{ what: "right_lacking", right: "Workers Scripts: Edit" }]],
    ["two permissions at once", { refuse: [`GET /accounts/${ACCOUNT}/d1/database`, `GET /accounts/${ACCOUNT}/r2/buckets`] }, [{ right: "D1: Edit" }, { right: "Workers R2 Storage: Edit" }]],
  ] as const)("a token without %s is blocked, and the block names it", async (_, refused, blocked) => {
    expect((await found(fresh(refused), NONE)).found).toMatchObject({ state: "blocked", blocked });
  });

  // Drift: a token proves itself by what it shows. One that shows nothing, or not the domain, must be told so before a read of any install.
  test.each([
    ["a token Cloudflare does not know, without a domain", NONE, "token-nobody-knows-0123456789", { state: "refused", why: "token" }, ["GET /accounts"]],
    ["a token Cloudflare does not know, with a domain", DOMAIN, "token-nobody-knows-0123456789", { state: "refused", why: "token" }, ["GET /zones"]],
    ["a token that shows no zone of the domain", { kind: "domain", layout: layoutOf({ domain: "example.org" }), account: undefined }, TOKEN, { state: "refused", why: "no_domain" }, ["GET /zones", "GET /zones"]],
    ["a token that does not show the account that was named", { kind: "no-domain", account: "f".repeat(32) }, TOKEN, { state: "refused", why: "token" }, ["GET /accounts", "GET /accounts"]],
  ] as const)("%s is refused, and nothing of an install is read", async (_, where, token, state, calls) => {
    const sought = await found(fresh(), where, token);

    expect([sought.found, sought.calls]).toMatchObject([state, calls]);
  });

  test("a token of another account finds nothing of this one: its own account is read, where it lacks every permission here", async () => {
    expect((await found(fresh(), NONE, OTHER_TOKEN)).found).toMatchObject({ state: "blocked", blocked: [{ what: "right_lacking", right: "Workers Scripts: Edit" }] });
  });

  // Drift: an account is never picked for the person. A token that shows several gets a question, whose answer is a place to find with again.
  test("a token that shows two accounts is asked which, by number or by id; the place it answers is found in that account, and text that names neither is refused", async () => {
    const other = "f".repeat(32);
    const account = fresh({ alsoShown: [{ id: other, name: "Another account" }] });
    const { found: state, calls } = await found(account, NONE);
    const question = state.state === "choice" ? state.question : undefined;

    expect([calls, question?.key, question?.give]).toEqual([["GET /accounts", "GET /accounts"], "account", "Give --account <id> (or POPLIN_ACCOUNT)."]);
    expect(question?.ask).toBe(`The token shows more than one account:\n  1) An account (${ACCOUNT})\n  2) Another account (${other})\nWhich one?`);
    expect([question?.answer("1"), question?.answer(` ${other} `), question?.answer("3"), question?.answer("mine")]).toEqual([
      { ok: true, where: { kind: "no-domain", account: ACCOUNT } },
      { ok: true, where: { kind: "no-domain", account: other } },
      { ok: false, why: "refused", refused: "that is none of the accounts the token shows" },
      { ok: false, why: "refused", refused: "that is none of the accounts the token shows" },
    ]);
    expect((await found(account, { kind: "no-domain", account: ACCOUNT })).found).toMatchObject({ state: "none" });
  });
});
