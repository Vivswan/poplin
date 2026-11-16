// The install going back by itself after a schema step failed, against the answers Cloudflare documents for a Worker's deployments and versions.
// Without these a failed step could deploy the failing code again, go back over a deploy made by hand, or leave the install on code that cannot start with nobody told.

import { describe, expect, test } from "bun:test";
import type { Database } from "@poplin/core/src/database/database";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { readKeptKey } from "../../../../src/shared/install/key/kept-key";
import { goBack } from "../../../../src/shared/release/update/go-back";
import { withFake } from "../../install/support/fake-cloudflare";
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
  worker: typeof WORKER | undefined;
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
      calls: [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${NEW}`, `POST ${DEPLOYMENTS}`],
      posted: [{ strategy: "percentage", versions: [{ version_id: OLD, percentage: 100 }], annotations: { "workers/message": "poplin 0.2.0 again: 0.3.0 could not change the database" } }],
      notes: [["update_went_back", { from: "0.3.0", to: "0.2.0" }, "sweep@poplin.invalid"], ["update_went_back"]],
      keys: [`Bearer ${KEY}`],
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
    { name: "a Worker whose variables do not say its place", given: (given) => { given.worker = undefined; }, calls: [] },
    { name: "a key without the right", held: (held) => { held.instead[`GET ${DEPLOYMENTS}`] = () => refusal(403, 10_000, `Authentication error ${KEY}`); }, calls: LISTED },
    { name: "an answer that lists no deployments", held: (held) => { held.instead[`GET ${DEPLOYMENTS}`] = () => reply({}); }, calls: LISTED },
    { name: "a deployment that splits its requests over two versions", held: (held) => { held.deployments[0] = { versions: [{ version_id: NEW, percentage: 50 }, { version_id: OLD, percentage: 50 }] }; }, calls: LISTED },
    { name: "another instance that went back first, so the version before runs already", held: (held) => { held.deployments.unshift(whole(OLD)); }, calls: [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${OLD}`] },
    { name: "a running version no update tagged", held: (held) => { held.tags[NEW] = undefined; }, calls: READ },
    { name: "an update that was the Worker's first deployment", held: (held) => { held.deployments = [whole(NEW)]; }, calls: READ },
    { name: "deployments that all run the same version", held: (held) => { held.deployments = [whole(NEW), whole(NEW)]; }, calls: READ },
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

    expect<unknown>({ went: outcome.went, calls: outcome.calls, notes: outcome.notes }).toEqual({ went: undefined, calls: [`GET ${DEPLOYMENTS}`, `GET ${VERSIONS}/${NEW}`, `POST ${DEPLOYMENTS}`], notes: [] });
  });
});
