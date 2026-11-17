// The install going back by itself after a schema step failed, against the answers Cloudflare documents for a Worker's deployments and versions.
// Without these a failed step could deploy the failing code again, go back over a deploy made by hand, or leave the install on code that cannot start with nobody told.

import { describe, expect, test } from "bun:test";
import { parseLogin } from "@poplin/core/src/auth/logins";
import type { Database } from "@poplin/core/src/database/database";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { installer } from "../../../../src/shared/install/first/installer";
import { readKeptKey } from "../../../../src/shared/install/key/kept-key";
import type { CheckedBundle } from "../../../../src/shared/release/update/bundle-files";
import { goBack } from "../../../../src/shared/release/update/go-back";
import { openUpload } from "../../../../src/shared/release/update/upload";
import { withFake } from "../../install/support/fake-cloudflare";
import { type Account as InstallAccount, answer, emptyAccount, TOKEN } from "../../install/support/fake-install";
import { RELEASE, worldOf } from "../../install/support/fake-reach";
import { type Asked, refusal, reply } from "../../install/support/replies";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** The Worker that goes back. */
const WORKER = { accountId: "0123456789abcdef0123456789abcdef", script: "poplin" };

/** The paths of the Worker's deployments and versions at the API. */
const [DEPLOYMENTS, VERSIONS] = [`/accounts/${WORKER.accountId}/workers/scripts/${WORKER.script}/deployments`, `/accounts/${WORKER.accountId}/workers/scripts/${WORKER.script}/versions`];

/** The clock of every start here. */
const NOW = Date.UTC(2026, 11, 1, 12);

/** The update the failing code came in with: from 0.2.0, with the database at this code's schema. */
const LAST = { from: "0.2.0", to: "0.3.0", schema: OWN_SCHEMA, at: NOW - 60_000 };

/** The versions of the Worker by their ids: the one the update uploaded, and the one that ran before it. */
const [NEW, OLD] = ["version-of-0.3.0", "version-of-0.2.0"];

/** The release after the one an install here is made from, as an update's checked files hold it: it keeps the Worker's name, and has the cron list the install set. */
const NEXT: CheckedBundle = {
  version: "0.4.0",
  deploy: { main_module: "worker.js", compatibility_date: "2026-11-01", compatibility_flags: [], bindings: [{ name: "WORKER_NAME", kind: "kept" }], crons: ["*/15 * * * *"] },
  module: new TextEncoder().encode("export default {};\n"),
  map: undefined,
};

/** The options that name the place of each kind of install. */
const PLACES = { domain: [["domain", "example.com"]], "no-domain": [["no-domain", true]] } as const;

/** What the Worker of a set install holds beside its code: where it answers, its account, and its two keys. */
const SET = ["ZONE", "ACCOUNT_ID", "KEPT_KEY", "UPLOAD_KEY"];

/** One deployment that runs a version whole. */
const whole = (id: string): object => ({ id: `deployment-of-${id}`, versions: [{ version_id: id, percentage: 100 }] });

/** What the account answers. Every member has the value of a Worker whose update to 0.3.0 was its last deployment, over a change of a variable on 0.2.0. */
interface Account {
  /** The deployments, the newest first. */
  deployments: object[];

  /** The tag of each version by its id. */
  tags: Record<string, string | undefined>;

  /** What answers a call in place of the account's own answer, by its method and path. */
  instead: Record<string, () => Response>;
}

/** What one start is given, with the values of code 0.3.0 whose step failed on a database still at the schema of 0.2.0. */
interface Start {
  last: unknown;
  failed: { version: string; stored: number };
  secret: unknown;
  worker: typeof WORKER;
}

function account(): Account {
  return { deployments: [whole(NEW), whole(OLD), whole(OLD)], tags: { [NEW]: "0.3.0", [OLD]: "0.2.0" }, instead: {} };
}

function start(): Start {
  return { last: LAST, failed: { version: "0.3.0", stored: OWN_SCHEMA }, secret: KEY, worker: WORKER };
}

/** Answer as the account does: its deployments, one version with its tag, and a deployment that is taken. */
function answering(held: Account): (asked: Asked) => Response | undefined {
  return (asked) => {
    const call = `${asked.method} ${asked.path}`;
    const instead = held.instead[call];
    if (instead !== undefined) return instead();

    if (call === `GET ${DEPLOYMENTS}`) return reply({ deployments: held.deployments });

    if (call === `POST ${DEPLOYMENTS}`) return reply({ id: "deployment-back" });

    const id = asked.path.startsWith(`${VERSIONS}/`) ? asked.path.slice(VERSIONS.length + 1) : undefined;
    if (asked.method !== "GET" || id === undefined) return undefined;

    return reply({ id, number: 1, annotations: held.tags[id] === undefined ? {} : { "workers/tag": held.tags[id] }, resources: {} });
  };
}

/** A database that records what is noted in it. */
function noting(notes: unknown[]): Database {
  return {
    appendAudit: async (entry: { readonly action: string; readonly detail: unknown }, stamp: { readonly by: string }) => void notes.push([entry.action, entry.detail, stamp.by]),
    noteProblem: async (problem: { readonly kind: string }) => {
      notes.push([problem.kind]);

      return true;
    },
  } as unknown as Database;
}

/** Run one failed start against the account, and say what it answered, what it asked, and what it noted. */
async function gone(held: Account, given: Start): Promise<{ readonly went: unknown; readonly calls: readonly string[]; readonly posted: readonly unknown[]; readonly notes: readonly unknown[]; readonly keys: readonly (string | null)[] }> {
  const notes: unknown[] = [];
  const outcome: { went: unknown; asked: readonly Asked[] } = { went: undefined, asked: [] };

  await withFake(answering(held), async (connection, asked) => {
    const key = readKeptKey(given.secret, { baseUrl: connection.baseUrl });
    outcome.went = await goBack({ last: given.last, failed: given.failed, key, worker: given.worker, noting: { database: noting(notes), now: () => NOW } });
    outcome.asked = [...asked];
  });

  const { asked, went } = outcome;

  return { went, calls: asked.map((entry) => `${entry.method} ${entry.path}`), posted: asked.filter((entry) => entry.method === "POST").map((entry) => entry.body), notes, keys: [...new Set(asked.map((entry) => entry.key))] };
}

describe("an install that goes back by itself", () => {
  // Drift: this is the one place poplin changes which code runs with nobody asking. It must deploy exactly the version that ran before the update, whole, and say so in the log and the Problems list.
  test("a failed step after an update deploys the version before at 100%, with the kept key, and notes it", async () => {
    const outcome = await gone(account(), start());

    expect<unknown>(outcome).toEqual({
      went: { from: "0.3.0", to: "0.2.0" },
      calls: [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${NEW}`, `GET ${VERSIONS}/${OLD}`, `POST ${DEPLOYMENTS}`],
      posted: [{ strategy: "percentage", versions: [{ version_id: OLD, percentage: 100 }], annotations: { "workers/message": "poplin 0.2.0 again: 0.3.0 could not change the database" } }],
      notes: [["update_went_back", { from: "0.3.0", to: "0.2.0" }, "sweep@poplin.invalid"], ["update_went_back"]],
      keys: [`Bearer ${KEY}`],
    });
  });

  // Drift: an upload that was sent twice leaves two versions of the failing release, one under the other. Picked by "another version than the one that runs", the older of the two would be deployed: the same failing code, told as gone back.
  test("the version deployed is the newest earlier one tagged as the version before, past another upload of the failing release", async () => {
    const held = account();
    const again = "second-version-of-0.3.0";
    held.deployments = [whole(again), whole(NEW), whole(OLD)];
    held.tags[again] = "0.3.0";
    const outcome = await gone(held, start());

    expect<unknown>({ went: outcome.went, calls: outcome.calls, deployed: outcome.posted.map((body) => (body as { versions: unknown }).versions) }).toEqual({
      went: { from: "0.3.0", to: "0.2.0" },
      calls: [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${again}`, `GET ${VERSIONS}/${NEW}`, `GET ${VERSIONS}/${OLD}`, `POST ${DEPLOYMENTS}`],
      deployed: [[{ version_id: OLD, percentage: 100 }]],
    });
  });

  /** One failed start that must change nothing: what differs from the start above, and the calls it still makes. */
  interface Row {
    readonly name: string;
    readonly given?: (given: Start) => void;
    readonly held?: (held: Account) => void;
    readonly calls: readonly string[];
  }

  const [LISTED, READ] = [[`GET ${DEPLOYMENTS}`], [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${NEW}`]];

  const rows: readonly Row[] = [
    { name: "code no update of its own put in place", given: (given) => { given.last = undefined; }, calls: [] },
    { name: "a variable that is no such record", given: (given) => { given.last = "0.2.0"; }, calls: [] },
    { name: "a database an earlier step of this start already changed", given: (given) => { given.failed.stored = OWN_SCHEMA + 1; }, calls: [] },
    { name: "code a deploy put in place since the update", given: (given) => { given.failed.version = "0.4.0"; }, calls: [] },
    { name: "an install that holds no key", given: (given) => { given.secret = undefined; }, calls: [] },
    { name: "a key without the right", held: (held) => { held.instead[`GET ${DEPLOYMENTS}`] = () => refusal(403, 10_000, `Authentication error ${KEY}`); }, calls: LISTED },
    { name: "an answer that lists no deployments", held: (held) => { held.instead[`GET ${DEPLOYMENTS}`] = () => reply({}); }, calls: LISTED },
    { name: "a deployment that splits its requests over two versions", held: (held) => { held.deployments[0] = { versions: [{ version_id: NEW, percentage: 50 }, { version_id: OLD, percentage: 50 }] }; }, calls: LISTED },
    { name: "another instance that went back first, so the version before runs already", held: (held) => { held.deployments.unshift(whole(OLD)); }, calls: [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${OLD}`] },
    { name: "a running version no update tagged", held: (held) => { held.tags[NEW] = undefined; }, calls: READ },
    { name: "an update that was the Worker's first deployment", held: (held) => { held.deployments = [whole(NEW)]; }, calls: READ },
    { name: "deployments that all run the same version", held: (held) => { held.deployments = [whole(NEW), whole(NEW)]; }, calls: READ },
    {
      name: "a version with no tag that ran when the update came, over one tagged as the version before",
      held: (held) => { held.deployments = [whole(NEW), whole("version-by-hand"), whole(OLD)]; },
      calls: [...READ, `GET ${VERSIONS}/version-by-hand`],
    },
    { name: "an earlier version that no update tagged as the version before", held: (held) => { held.tags[OLD] = undefined; }, calls: [...READ, `GET ${VERSIONS}/${OLD}`] },
    { name: "an earlier version of another release than the version before", held: (held) => { held.tags[OLD] = "0.1.0"; }, calls: [...READ, `GET ${VERSIONS}/${OLD}`] },
  ];

  // Drift: each row is a start where older code must not be put in place: it would meet a database it cannot read, undo a person's deploy, or flap between two versions.
  test.each(rows)("$name: nothing is deployed and nothing is noted", async ({ given: change, held: differ, calls }) => {
    const [held, given] = [account(), start()];
    change?.(given);
    differ?.(held);
    const outcome = await gone(held, given);

    expect<unknown>({ went: outcome.went, calls: outcome.calls, notes: outcome.notes }).toEqual({ went: undefined, calls, notes: [] });
  });

  // Drift: a deployment Cloudflare did not take left the failing code running. Told as gone back, a person would wait for a version that never comes; and the SDK sends a call that failed at Cloudflare again unless told not to.
  test("a deployment Cloudflare fails is not told as a going back, is not sent twice, and nothing is noted", async () => {
    const held = account();
    held.instead[`POST ${DEPLOYMENTS}`] = () => refusal(500, 10_100, `no deployment for ${KEY}`);
    const outcome = await gone(held, start());

    expect<unknown>({ went: outcome.went, calls: outcome.calls, notes: outcome.notes }).toEqual({ went: undefined, calls: [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${NEW}`, `GET ${VERSIONS}/${OLD}`, `POST ${DEPLOYMENTS}`], notes: [] });
  });
});

/** Make a whole install of a kind at the fake API, as `poplin install` makes it from the release the website names: an upload, then the one change that writes its variables and keys. */
async function installed(kind: keyof typeof PLACES): Promise<{ readonly account: InstallAccount; readonly fetch: typeof fetch }> {
  const account: InstallAccount = { ...emptyAccount(), bindings: [], noWorker: true };
  const { reach } = await worldOf(account);
  const [token, read, owner] = [installer.token(TOKEN), installer.read({ flags: new Map<string, string | true>(PLACES[kind]), env: {} }), parseLogin("owner@example.com")];
  if (token === undefined || !read.ok || !owner.ok) throw new Error("the test's token, place, or login was refused");

  const found = await installer.find(token, read.where, reach, "install");
  if (found.state !== "none") throw new Error(`the test's account was not empty: ${found.state}`);

  await installer.install(found, read.where, owner.value, "apply", reach, () => undefined);

  return { account, fetch: reach.fetch as typeof fetch };
}

/** Send the update to the next release as the install itself does, then start its code with a schema step that fails; answer what the going back said, and the bindings of the version that runs after it. */
async function updatedThenFailed(account: InstallAccount, fetch: typeof globalThis.fetch): Promise<{ readonly went: unknown; readonly runs: unknown; readonly holds: readonly string[] }> {
  const key = readKeptKey(TOKEN, { fetch });
  const update = { from: RELEASE, to: NEXT.version, schema: OWN_SCHEMA, at: NOW - 60_000 };
  const upload = await openUpload(key, WORKER);
  if (!upload.ok || !(await upload.value.put(NEXT, update)).ok) throw new Error("the test's update was not taken");

  const went = await goBack({ last: update, failed: { version: NEXT.version, stored: OWN_SCHEMA }, key, worker: WORKER, noting: { database: noting([]), now: () => NOW } });
  const runs = account.versions.find((version) => version.id === account.deployments[0]);

  return { went, runs: runs?.id, holds: ((runs?.bindings ?? []) as { readonly name: string }[]).map((binding) => binding.name).filter((name) => SET.includes(name)) };
}

describe.each(Object.keys(PLACES) as (keyof typeof PLACES)[])("an install as `poplin install` makes it, %s, whose update fails its schema step", (kind) => {
  // Drift: an install's first upload is tagged and holds no place, no account, and no key: the change that writes them makes a later version of the same release.
  // Sent back to the tagged upload, the install would run without them, where it went back to mend itself.
  test("goes back to the version that ran when the update came, the one with its place, its account, and both keys, and never to the first upload", async () => {
    const { account, fetch } = await installed(kind);
    const outcome = await updatedThenFailed(account, fetch);

    expect<unknown>([account.deployments.slice(1), outcome]).toEqual([["version-3", "version-2", "version-1"], { went: { from: NEXT.version, to: RELEASE }, runs: "version-2", holds: SET }]);
    // What runs is what a look reads: the release of the version before, from the bindings that version was made with.
    expect(account.bindings.filter((binding) => binding.name === "RELEASE")).toEqual([{ name: "RELEASE", type: "plain_text", text: RELEASE }]);
  });

  // Drift: a variable set by hand in the dashboard makes a version with no tag. Passed over for an older tagged one, the going back would undo that variable, and every key written since that older version.
  test("stays on the failing code where the version that ran when the update came was made by hand, and deploys no older one", async () => {
    const { account, fetch } = await installed(kind);
    const kept = account.bindings.map((binding) => ({ name: binding.name, type: "inherit" }));
    answer(account, { method: "PATCH", path: `/accounts/${WORKER.accountId}/workers/scripts/poplin/settings`, key: `Bearer ${TOKEN}`, body: { settings: { bindings: [...kept, { name: "BY_HAND", type: "plain_text", text: "1" }] } } });
    const outcome = await updatedThenFailed(account, fetch);

    expect<unknown>([account.deployments, outcome.went, outcome.runs]).toEqual([["version-4", "version-3", "version-2", "version-1"], undefined, "version-4"]);
  });
});
