// A repair with an account token against a whole install at the fake API, whose database is asked through the API's query route.
// Without these a repair from a terminal could change what stands, take a release nobody asked for, leave one kind of install behind, or let a token that may only read add a user.

import { describe, expect, test } from "bun:test";
import { type Login, parseLogin } from "@poplin/core/src/auth/logins";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import type { Mend, Repaired, Run, Token, Whole } from "@poplin/core/src/install/installer";
import type { Place, Where } from "../../../../../src/shared/install/first/find";
import { installer } from "../../../../../src/shared/install/first/installer";
import { keepsLines, observabilityOf } from "../../../../../src/shared/install/pieces/worker-logs/worker-logs";
import { ACCOUNT, type Account, answer, emptyAccount, KEY_VALUE_START, TOKEN } from "../../support/fake-install";
import { type Store, storeOf } from "../../support/fake-store";
import { RELEASE, worldOf } from "../../support/fake-reach";
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

/** What a line that carries `--update` asks of a repair. */
const UPDATE = { update: true } as const;

/** What a repair says of an install of a newer release than the newest this poplin reads, before the command it names. */
const NEWER = `The install runs 0.4.0, and the newest release this poplin reads is ${RELEASE}. Nothing is put back to an older release.`;

/** The option of each kind's place, as a sentence that names a command carries it. */
const PLACED = { domain: "--domain example.com", "no-domain": "--no-domain" } as const;

/** The calls a repair that changes nothing sends, pinned for each kind: all of them read. */
const CALLS: Readonly<Record<keyof typeof KINDS, number>> = { domain: 31, "no-domain": 27 };

/** A version below the release the website names, which an install that is behind runs. */
const OLDER = "0.2.0";

/** The upload of the install's Worker, and a call of its database's query route, as a change is told. */
const [UPLOAD, QUERY] = [`PUT /accounts/${ACCOUNT}/workers/scripts/poplin`, `POST /accounts/${ACCOUNT}/d1/database/made-0/query`];

/** The calls a repair that updates sends to bring an install to the newest release, beside the ones of a repair that changes nothing, pinned: the cron list, the bindings, the upload, and how the database stands. */
const UPLOAD_CALLS = 4;

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
  const found = await installer.find(KEY, KINDS[kind].where, world.reach, "install");
  if (found.state !== "none") throw new Error(`the test's account was not empty: ${found.state}`);

  await installer.install(found, KINDS[kind].where, OWNER, APPLY, world.reach, () => undefined);

  return Object.assign(account, { store: await storeOf(stored === "nothing" ? undefined : stored) });
}

/**
 * Make a whole install whose Worker states another release than the one the website names, as one that could not take that release by itself.
 * Its latest version is the one the install's change of the settings made, as on every real install.
 *
 * @param version - the release its Worker's `RELEASE` binding names
 */
async function behindInstall(kind: keyof typeof KINDS, version: string = OLDER, stored: Login | "nothing" = OWNER): ReturnType<typeof wholeInstall> {
  const account = await wholeInstall(kind, {}, stored);
  account.bindings = account.bindings.map((binding) => (binding.name === "RELEASE" ? { ...binding, text: version } : binding));

  return account;
}

/** What one find and one repair left behind: what the repair came to and told on the way, and every call it sent. */
interface Outcome {
  readonly done: Repaired;
  readonly said: string[];
  readonly calls: readonly Asked[];
  readonly changes: string[];
  readonly slept: readonly number[];
}

/** Find the install, then repair it, in one stand-in world. */
async function repaired(account: Account, kind: keyof typeof KINDS, mend: Partial<Mend> = {}, where: Where = KINDS[kind].where, meets: Parameters<typeof worldOf>[1] = {}): Promise<Outcome> {
  const world = await worldOf(account, meets);
  const found = await installer.find(KEY, where, world.reach, "repair");
  if (found.state !== "whole") throw new Error(`no whole install to repair: ${found.state}`);

  const sought = world.asked.length;
  const said: string[] = [];
  const whole: Whole<Place> = found;
  const done = await installer.repair(whole, where, { run: APPLY, update: false, addUser: undefined, ...mend }, world.reach, (row) => said.push(`${row.object} | ${row.state} | ${row.detail}`));
  const calls = world.asked.slice(sought);

  return { done, said, calls, changes: calls.filter(writes).map((entry) => `${entry.method} ${entry.path.split("?")[0]}`), slept: world.slept };
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
      `Access application | block | refused with status 403 and codes 10000. Add this permission to the account token: ${right}`,
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

describe.each(BOTH)("the release an install runs, where Cloudflare tags no version it is not told to, %s", (kind) => {
  // Drift: every variable and key a person or a repair writes makes a latest version with no tag. An install read by that tag is one whose version is not read from its first repair on, so no repair ever brings it to a release.
  test("a variable and a secret written by hand each make a latest version with no tag, and the install still reads as the release it runs, and as behind one", async () => {
    const [current, behind] = [await wholeInstall(kind), await behindInstall(kind)];
    for (const account of [current, behind]) {
      const kept = account.bindings.map((binding) => ({ name: binding.name, type: "inherit" }));
      for (const written of [{ name: "BY_HAND", type: "plain_text", text: "set in the dashboard" }, { name: "A_SECRET", type: "secret_text", text: "set in the dashboard" }]) {
        answer(account, { method: "PATCH", path: `/accounts/${ACCOUNT}/workers/scripts/poplin/settings`, key: `Bearer ${TOKEN}`, body: { settings: { bindings: [...kept, written] } } });
      }
    }
    const dry = await repaired(behind, kind, { run: DRY, ...UPDATE }, KINDS[kind].where, { older: { [OLDER]: OWN_SCHEMA } });

    expect(current.versions.map((version) => (version.annotations as { readonly "workers/tag"?: string } | undefined)?.["workers/tag"])).toEqual([undefined, undefined, RELEASE, RELEASE]);
    expect([shown((await repaired(current, kind)).done)[0], shown(dry.done)[0]]).toEqual([`Worker | leave | poplin, runs ${RELEASE}`, `Worker | change | poplin: ${OLDER} to ${RELEASE}`]);
  });

  // Drift: code another tool uploads is not poplin's release. Read as the tag an older version carries, it would be told as that release, and left in place as the newest.
  test("an upload by another tool, which keeps poplin's marks and states no release, is read as no version: never as the tag of the version under it", async () => {
    const account = await wholeInstall(kind);
    const kept = account.bindings.filter((binding) => binding.name !== "RELEASE").map((binding) => ({ name: binding.name, type: "inherit" }));
    answer(account, { method: "PUT", path: `/accounts/${ACCOUNT}/workers/scripts/poplin`, key: `Bearer ${TOKEN}`, body: { metadata: { bindings: kept, observability: account.observability }, "index.js": "" } });
    const { done, changes } = await repaired(account, kind, UPDATE);

    expect(account.versions.map((version) => (version.annotations as { readonly "workers/tag"?: string } | undefined)?.["workers/tag"])).toEqual([undefined, RELEASE, RELEASE]);
    expect([shown(done)[0], changes, shown((await repaired(account, kind)).done)[0]]).toEqual([
      "Worker | leave | poplin: its version is not read, so no release is put in place",
      [],
      "Worker | leave | poplin: its version is not read",
    ]);
  });
});

describe.each(BOTH)("a release the install is behind, which the line asks for with --update, %s", (kind) => {
  // Drift: this is the one way an install takes a release it cannot take by itself. An upload that named a binding anew would drop the bucket or the key, and one with no tag or no update stated would leave no way back.
  test("a dry run names the change and sends none; the run sends one upload that keeps every binding by name, tags the version, and states the update, in the pinned calls; the run after it sends none", async () => {
    const account = await behindInstall(kind);
    const names = account.bindings.map((binding) => binding.name);
    const meets = { older: { [OLDER]: OWN_SCHEMA } };
    const dry = await repaired(account, kind, { run: DRY, ...UPDATE }, KINDS[kind].where, meets);
    const run = await repaired(account, kind, UPDATE, KINDS[kind].where, meets);
    const again = await repaired(account, kind, UPDATE, KINDS[kind].where, meets);
    const { metadata } = account.uploads.at(-1) as { readonly metadata: { readonly bindings: readonly { readonly name: string; readonly type: string; readonly json?: unknown; readonly text?: unknown }[]; readonly annotations: unknown } };
    const stated = metadata.bindings.filter((binding) => binding.type !== "inherit");

    expect([dry.changes, shown(dry.done), shown(dry.done)[0], dry.done.ok && dry.done.ready]).toEqual([[], shown(run.done), `Worker | change | poplin: ${OLDER} to ${RELEASE}`, true]);
    expect([run.changes, run.calls.length - CALLS[kind], run.done.ok && run.done.ready]).toEqual([[UPLOAD], UPLOAD_CALLS, true]);
    expect([metadata.annotations, stated.map((binding) => binding.name), stated.find((binding) => binding.name === "LAST_UPDATE")?.json]).toEqual([
      { "workers/tag": RELEASE, "workers/message": `poplin ${RELEASE}, by a repair` },
      ["MINUTE_LIMITS", "LAST_UPDATE", "RELEASE"],
      { from: OLDER, to: RELEASE, schema: OWN_SCHEMA, at: 0 },
    ]);
    expect([account.bindings.map((binding) => binding.name).filter((name) => name !== "LAST_UPDATE").sort(), account.uploads.length]).toEqual([[...names].sort(), 2]);
    // The release is stated once, by its value: named as kept beside it, Cloudflare would be told one binding twice.
    expect(metadata.bindings.filter((binding) => binding.name === "RELEASE")).toEqual([{ name: "RELEASE", type: "plain_text", text: RELEASE }]);
    expect([again.changes, shown(again.done)[0], again.calls.length]).toEqual([[], `Worker | leave | poplin, runs ${RELEASE}`, CALLS[kind]]);
  });

  // Drift: for about a second after an upload, Cloudflare lists the Worker without the bindings its new version holds. A repair reads them right after its own upload: read once, it stopped at `Worker variable` on an install with nothing wrong.
  test.each([1, 2])("settings that trail the upload for %d reads are read again after a wait each time, and the repair ends whole, with that many more calls", async (reads) => {
    const account = await behindInstall(kind);
    account.trailing = { from: "upload", answers: Array.from({ length: reads }, () => ({ bindings: [] })) };
    const { done, changes, calls, slept } = await repaired(account, kind, UPDATE);

    expect([shown(done).filter((row) => !row.includes(" | leave | ")), changes, done.ok && done.ready]).toEqual([[`Worker | change | poplin: ${OLDER} to ${RELEASE}`], [UPLOAD], true]);
    expect([slept, calls.length - CALLS[kind] - UPLOAD_CALLS]).toEqual([Array(reads).fill(1500), reads]);
  });

  // Drift: a change sent after a read in part names as kept only the bindings that read listed, and a key read as missing is made anew. Settings that never settle must stop the pieces that read them, with nothing written after the upload.
  test("settings that trail the upload at every try stop the pieces that read them with a failure, and nothing is written after the upload", async () => {
    const account = await behindInstall(kind);
    account.trailing = { from: "upload", answers: Array.from({ length: 100 }, () => ({ bindings: [] })) };
    const keys = account.tokens.length;
    const { done, changes } = await repaired(account, kind, UPDATE);
    const failed = shown(done).filter((row) => row.includes(" | fail | "));

    expect([changes, done.ok && done.ready, account.tokens.length]).toEqual([[UPLOAD], false, keys]);
    expect(failed).toEqual(["Worker variable | fail | no answer from Cloudflare", "Key | fail | poplin kept key: no answer from Cloudflare", "Upload key | fail | poplin upload key: no answer from Cloudflare"]);
  });

  // Drift: a website that does not name the version the install ran publishes no files to go back to. An update stated for it would offer a way back that every start refuses.
  test("where the website does not name the version the install ran, the upload states no update, so the release's code offers no way back", async () => {
    const account = await behindInstall(kind);
    await repaired(account, kind, UPDATE);
    const { metadata } = account.uploads.at(-1) as { readonly metadata: { readonly bindings: readonly { readonly name: string }[] } };

    expect([account.uploads.length, metadata.bindings.some((binding) => binding.name === "LAST_UPDATE")]).toEqual([2, false]);
  });

  // Drift: Cloudflare keeps no observability across an upload, and a repair sends its upload before it reads the setting. One that stated the release's would switch the logs back on, on an install whose setting keeps none.
  test.each([
    { name: "that Cloudflare already keeps none of", carried: true, uploaded: false, row: "Worker logs | leave | not kept", written: 0 },
    { name: "whose change never reached Cloudflare", carried: false, uploaded: true, row: "Worker logs | change | not kept", written: 1 },
  ])("with the setting of the logs off, on a Worker $name, the upload states the logs as the Worker has them and the run ends with none kept", async ({ carried, uploaded, row, written }) => {
    const account = await behindInstall(kind);
    await account.store.database.changeSettings({ provider_logs: false }, { as: "person", by: OWNER, at: 0 });
    if (carried) account.observability = observabilityOf(account.observability, false);

    const { done, calls } = await repaired(account, kind, UPDATE);
    const sent = account.uploads.map((upload) => keepsLines((upload.metadata as { readonly observability?: unknown }).observability));

    const patched = calls.filter((entry) => entry.method === "PATCH" && entry.path.endsWith("/script-settings"));

    expect([sent, shown(done).filter((entry) => entry.startsWith("Worker logs")), patched.length, keepsLines(account.observability)]).toEqual([[true, uploaded], [row], written, false]);
  });

  // Drift: a person runs the repair to get back in. One that stopped at an upload it could not send would leave the login unmended, and one that said nothing of the upload would leave the release untaken with no word.
  test.each([
    ["a token without the permission to upload", {}, `Worker | block | poplin: ${OLDER} to ${RELEASE}: The token lacks a permission. Add this one: Workers Scripts: Edit`],
    ["code that stops as it starts", { refuseAs: { status: 400, code: 10021 } }, `Worker | fail | poplin: ${OLDER} to ${RELEASE}: Cloudflare refused the release's code: it stops as it starts. The install runs the version it ran`],
    ["code Cloudflare refuses otherwise", { refuseAs: { status: 400, code: 10068 } }, `Worker | fail | poplin: ${OLDER} to ${RELEASE}: refused with status 400`],
  ])("an upload refused for %s gets a row that says so, the piece that was gone is still made, and the run is not ready", async (_name, refused, row) => {
    const account = await behindInstall(kind);
    account.workflows = [];
    Object.assign(account, { refuse: UPLOAD, ...refused });
    const { done } = await repaired(account, kind, UPDATE);

    expect([shown(done).filter((entry) => !entry.includes(" | leave | ")), done.ok && done.ready, account.uploads.length]).toEqual([[row, "Workflow | make | poplin-jobs"], false, 1]);
  });

  // Drift: files that are not the published ones must reach no Worker, whoever holds the token, and a person who came to get back in must still get in.
  test.each([
    ["a website that does not answer", "releases.json", new Response("down", { status: 500 }), "the project's website named no release, so nothing says whether a newer one is out. Run this again"],
    ["a manifest that is not the published one", "worker.json", new Response("{}"), "the release's files are not the ones the project published. Nothing was uploaded"],
  ])("%s uploads nothing and says why in the Worker's row, and the rest of the install is still read", async (_name, file, answer, why) => {
    const account = await behindInstall(kind);
    const { done, changes } = await repaired(account, kind, UPDATE, KINDS[kind].where, { website: (address) => (address.endsWith(file) ? answer.clone() : undefined) });

    expect([shown(done)[0], changes, done.ok && done.ready, shown(done).length > 1]).toEqual([`Worker | fail | poplin, runs ${OLDER}: ${why}`, [], false, true]);
  });

  // Drift: an older poplin mends the pieces to what it knows. Run on an install of a newer release, or on one behind a release it cannot place, it would put older keys and older variables back.
  test.each([
    ["runs a newer release than the newest this poplin reads, with no update asked", "0.4.0", {}, {}, NEWER, "npx poplin@latest doctor --repair"],
    ["runs a newer release than the newest this poplin reads", "0.4.0", UPDATE, {}, NEWER, "npx poplin@latest doctor --repair --update"],
    ["is behind a release of another schema than this poplin's", OLDER, UPDATE, { schema: OWN_SCHEMA + 1 }, "The newest release is one this poplin cannot put in place.", "npx poplin@latest doctor --repair --update"],
  ])("an install that %s is left whole: the repair stops before it reads the records, and names the newest poplin", async (_name, version, mend, meets, why, command) => {
    const account = await behindInstall(kind, version);
    const { done, calls, changes } = await repaired(account, kind, mend, KINDS[kind].where, meets);
    // The command holds the option of the install's place, so the line runs as it is written where nobody can be asked.
    const words = `${why} Run the newest poplin: ${command} ${PLACED[kind]}`;

    expect([done, changes, calls.some((entry) => entry.path.endsWith("/query"))]).toEqual([{ ok: false, why: "another", words }, [], false]);
  });

  // Drift: the release's code runs the database's steps at its first request. A repair that waited for that request could not read the settings it mends to in the same run.
  test("after the upload, a database with steps to run is brought to the release's schema by core's own runner, in a row of its own, which a dry run names and does not run", async () => {
    const account = await behindInstall(kind, OLDER, "nothing");
    const dry = await repaired(account, kind, { run: DRY, ...UPDATE });
    const run = await repaired(account, kind, UPDATE);
    const steps = `Database steps | change | poplin: schema 0 to ${OWN_SCHEMA}`;

    expect([dry.changes, shown(dry.done), shown(dry.done)[1]]).toEqual([[], shown(run.done), steps]);
    expect([run.changes.slice(0, 2), run.done.ok && run.done.ready, (await account.store.call("SELECT step FROM schema_steps", []))[0]?.results]).toEqual([[UPLOAD, QUERY], true, [{ step: OWN_SCHEMA }]]);
  });

  // Drift: records another build wrote are not this release's to change. A run that read them anyway, or that dropped the rows of an upload it made, would say nothing of where the install stands.
  test("records of another poplin are left as they are: after an upload the rows say so, and where no upload was sent the row says what waits", async () => {
    const placed = await behindInstall(kind);
    await placed.store.call("UPDATE schema_steps SET fingerprint = 'another'", []);
    const unplaced = await behindInstall(kind);
    await unplaced.store.call("UPDATE schema_steps SET fingerprint = 'another'", []);
    unplaced.refuse = UPLOAD;

    expect(shown((await repaired(placed, kind, UPDATE)).done)).toEqual([`Worker | change | poplin: ${OLDER} to ${RELEASE}`, "Database steps | block | poplin: its records are of another poplin than this release's, so no step was run"]);
    expect(shown((await repaired(unplaced, kind, UPDATE)).done)).toEqual([
      `Worker | block | poplin: ${OLDER} to ${RELEASE}: The token lacks a permission. Add this one: Workers Scripts: Edit`,
      "Database steps | not-run | poplin: its records are read once the release is in place",
    ]);
  });

  // Drift: a release in place is no mended install. A run that uploaded and then could not read the settings, and ended on the upload's row alone, would say the install is mended with its login unread.
  test("after an upload, settings this poplin cannot read end the run not ready, with the upload's row kept and a row that says the records were not read", async () => {
    const account = await behindInstall(kind);
    await account.store.call("UPDATE settings SET value = '{}' WHERE id = 1", []);
    const { done } = await repaired(account, kind, UPDATE);

    expect([shown(done).map((row) => row.split(" | ").slice(0, 2).join(" | ")), done.ok && done.ready, account.uploads.length]).toEqual([["Worker | change", "Database steps | block"], false, 2]);
  });
});

// Drift: a stop words itself as a run that changed nothing. After an upload that would be false, and the upload's row would be lost from what the command prints.
test("Cloudflare refusing the token after the upload keeps the upload's row and adds one for what was not read, without a domain, where the kind's first read can be refused", async () => {
  const account = await behindInstall("no-domain");
  const website = (address: string): undefined => {
    if (address.endsWith("worker.js")) account.refuse = `GET /accounts/${ACCOUNT}/workers/subdomain`;
  };
  const { done } = await repaired(account, "no-domain", UPDATE, KINDS["no-domain"].where, { website });

  expect([shown(done).map((row) => row.split(": ")[0]), done.ok && done.ready]).toEqual([["Worker | change | poplin", "Rest of the install | fail | Cloudflare refused the token at the install"], false]);
});
describe.each(BOTH)("a repair that was not asked to update, %s", (kind) => {
  // Drift: a repair mends, and an update is a person's own choice. One that took a release unasked would change the code of an install whose owner switched updates off.
  test("an install that is behind is mended and takes no release: one row says what is out and how to take it, in a dry run and a run, with the calls of a repair that changes nothing", async () => {
    const account = await behindInstall(kind);
    account.workflows = [];
    const fetched: string[] = [];
    const website = (address: string): undefined => void fetched.push(address);
    const dry = await repaired(account, kind, { run: DRY }, KINDS[kind].where, { website });
    const run = await repaired(account, kind, {}, KINDS[kind].where, { website });
    const again = await repaired(account, kind);
    const row = `Worker | leave | poplin, runs ${OLDER}; ${RELEASE} is out: add --update to take it`;

    expect([dry.changes, shown(dry.done), shown(run.done)[0], dry.done.ok && dry.done.ready]).toEqual([[], shown(run.done), row, true]);
    expect([run.changes, account.uploads.length, run.done.ok && run.done.ready]).toEqual([[`PUT /accounts/${ACCOUNT}/workflows/poplin-jobs`], 1, true]);
    // No file of a release is asked for: the look alone asks the website which release is the newest.
    expect(fetched.filter((address) => !address.endsWith("releases.json"))).toEqual([]);
    expect([again.changes, again.calls.length, shown(again.done).filter((entry) => !entry.includes(" | leave | ")), again.done.ok && again.done.ready]).toEqual([[], CALLS[kind], [], true]);
  });

  // Drift: a person who is shut out runs the repair to get back in. A website that is down must not stop it, and must not be told as a failure of a release nobody asked for.
  test("a website that does not answer leaves a row of the version alone, and the run is ready", async () => {
    const account = await behindInstall(kind);
    const { done, changes } = await repaired(account, kind, {}, KINDS[kind].where, { website: (address) => (address.endsWith("releases.json") ? new Response("down", { status: 500 }) : undefined) });

    expect([shown(done)[0], changes, done.ok && done.ready]).toEqual([`Worker | leave | poplin, runs ${OLDER}`, [], true]);
  });

  // Drift: this poplin reads the records of its own schema alone, and a person who came to mend a login must not be made to update. A stop that named the update alone would force it, and one that named the newest poplin would stop the same way again.
  test("an install that is behind, with records this poplin does not read, is left whole, and the stop names both ways on at the place: the poplin of the install's version, then the repair that updates", async () => {
    const account = await behindInstall(kind);
    await account.store.call("UPDATE schema_steps SET fingerprint = 'another'", []);
    const { done, changes } = await repaired(account, kind);
    const words =
      `The install runs ${OLDER}, and its records are not at the schema of this poplin. ` +
      `To mend it as it is, run the poplin of its version: npx poplin@${OLDER} doctor --repair ${PLACED[kind]}. ` +
      `To take ${RELEASE} and mend it: npx poplin doctor --repair --update ${PLACED[kind]}`;

    expect([done, changes, account.uploads.length]).toEqual([{ ok: false, why: "behind", words }, [], 1]);
  });

  // Drift: records of another poplin on an install that runs the newest release are not behind anything. Named as the update's to mend, the line would send a person to a repair that stops again.
  test("an install that runs the newest release, with records this poplin does not read, names the newest poplin's repair, which updates only where the line did", async () => {
    const account = await wholeInstall(kind);
    await account.store.call("UPDATE schema_steps SET fingerprint = 'another'", []);
    const said = "The install's records are not at the schema of this poplin. Run the poplin of the install's own version, or the newest: npx poplin@latest doctor --repair";
    const [mend, update] = [await repaired(account, kind), await repaired(account, kind, UPDATE)];

    expect([mend.done, update.done]).toEqual([
      { ok: false, why: "another", words: `${said} ${PLACED[kind]}` },
      { ok: false, why: "another", words: `${said} --update ${PLACED[kind]}` },
    ]);
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
    expect(entry).toMatchObject({ action: "settings_changed", by: "doctor-repair@poplin.invalid", detail: { added: [LOST], removed: [] } });
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
  test("a write of the login that fails stores nothing, and the row says the status and the code alone", async () => {
    const account = await wholeInstall(kind);
    Object.assign(account, { refuse: `PUT /accounts/${ACCOUNT}/access/policies/*`, refuseAs: { status: 400, code: 12130 } });
    const { done, changes } = await repaired(account, kind, { addUser: LOST });

    expect([shown(done).at(-1), changes.filter((call) => call.endsWith("/query")), (await account.store.database.readSettings())?.logins]).toEqual(["User | fail | lost@example.com: refused with status 400 and codes 12130", [], [OWNER]]);
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

    expect(shown(done).at(-1)).toBe("User | fail | lost@example.com: the login lets the email in, and the install did not store it. Run this again: refused with status 400 and codes 7500");
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
