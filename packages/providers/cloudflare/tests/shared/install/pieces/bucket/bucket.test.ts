// The account's bucket against the fake API.
// Without these an install could make a second bucket beside poplin's, take a bucket of a longer name for it, change something in a run that was only to read, or fail on a name Cloudflare frees a minute later.

import { expect, test } from "bun:test";
import { planBucket, syncBucket } from "../../../../../src/shared/install/pieces/bucket/bucket";
import { withFake } from "../../support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, TOKEN } from "../../support/fake-install";

/** The call that makes a bucket. */
const CREATE = `POST /accounts/${ACCOUNT}/r2/buckets`;

/** The create as a run sends it. */
const CREATED = `${CREATE} {"name":"poplin-sites"}`;

/** What Cloudflare refuses a create with while it still holds the name of a bucket that went. */
const NAME_HELD = { status: 409, code: 10073 };

/** The line a person is shown at each wait for a held name. */
const WAITING = "Cloudflare still holds the bucket name poplin-sites after a removal. Retrying in 15 s";

/** That wait, as the order of a run's changes and waits tells it. */
const WAITED = `wait 15000: ${WAITING}`;

/** What one sync left behind: what it came to, and every change it sent and every wait it asked for, in the order they came. A wait is told with its milliseconds and its line. */
interface Outcome {
  readonly synced: Awaited<ReturnType<typeof syncBucket>>;
  readonly trace: string[];
}

/** Run a sync against an account at the fake API, on a clock that takes no time. */
async function synced(account: Account, mode: "plan" | "apply"): Promise<Outcome> {
  let result: Awaited<ReturnType<typeof syncBucket>> | undefined;
  const trace: string[] = [];
  const sleep = async (milliseconds: number, why?: string): Promise<void> => void trace.push(`wait ${milliseconds}: ${why}`);

  await withFake(
    (asked) => {
      if (asked.method !== "GET") trace.push(`${asked.method} ${asked.path} ${JSON.stringify(asked.body)}`);

      return answer(account, asked);
    },
    async (connection) => {
      result = await syncBucket({ ...connection, key: TOKEN, sleep }, ACCOUNT, mode);
    },
  );
  if (result === undefined) throw new Error("the sync did not run");

  return { synced: result, trace };
}

// Drift: the list's filter is a search, so a bucket whose name only holds poplin's would be taken for it without the full comparison.
test("the plan leaves a bucket of poplin's exact name and makes one beside any other, whatever those are named", () => {
  expect([planBucket([]), planBucket([{ name: "poplin-sites-old" }, {}]), planBucket([{ name: "other" }, { name: "poplin-sites" }])]).toEqual([
    [{ kind: "create", subject: "poplin-sites" }],
    [{ kind: "create", subject: "poplin-sites" }],
    [{ kind: "leave", subject: "poplin-sites" }],
  ]);
});

test("a plan sends no change, a run makes the bucket once, and the run after it leaves it", async () => {
  const account = emptyAccount();
  const planned = await synced(account, "plan");
  const made = await synced(account, "apply");
  const again = await synced(account, "apply");

  expect([planned.synced.ok && planned.synced.report.created, planned.trace, made.trace, again.trace]).toEqual([["poplin-sites"], [], [CREATED], []]);
  expect([made.synced.ok && made.synced.report.created, again.synced.ok && again.synced.report.left, account.buckets]).toEqual([["poplin-sites"], ["poplin-sites"], [{ name: "poplin-sites" }]]);
});

// Drift: a refusal is how a token without the storage permission, and an account whose storage is off, are told. One that threw, or read as an empty list, would hide both.
test("a list Cloudflare refuses is a failure with its status and its code, and nothing is made", async () => {
  const account = { ...emptyAccount(), refuse: `GET /accounts/${ACCOUNT}/r2/buckets`, refuseMessage: "Authentication error" };
  const refused = await synced(account, "apply");

  expect([refused.synced, refused.trace]).toMatchObject([{ ok: false, failure: "refused", status: 403, errors: [{ code: 10000 }] }, []]);
});

// Incident: right after a removal the list held no bucket of the name, and the create was refused with 409 and code 10073 until Cloudflare freed the name.
test.each([
  ["three creates", 3, { ok: true, report: { created: ["poplin-sites"] } }, [{ name: "poplin-sites" }]],
  ["twelve creates, the last a run sends again", 12, { ok: true, report: { created: ["poplin-sites"] } }, [{ name: "poplin-sites" }]],
  ["every create of a run", undefined, { ok: false, failure: "refused", status: 409, errors: [{ code: 10073 }], failed: "poplin-sites" }, []],
] as const)("a name Cloudflare holds for %s: a wait of 15 s, with the line that says why, lies between two creates, 12 times at most, and the last answer stands", async (_what, refuseTimes, outcome, buckets) => {
  const account: Account = { ...emptyAccount(), refuse: CREATE, refuseAs: NAME_HELD, ...(refuseTimes === undefined ? {} : { refuseTimes }) };
  const { synced: done, trace } = await synced(account, "apply");
  const refused = Array.from({ length: refuseTimes ?? 12 }, () => [CREATED, WAITED]).flat();

  expect(trace).toEqual([...refused, CREATED]);
  expect([done, account.buckets]).toMatchObject([outcome, [...buckets]]);
});

// Drift: a wait is for the one refusal that passes. Any other refusal waited for three minutes would keep a person from the row that says what to mend.
test.each([
  ["the status and another code", { status: 409, code: 10004 }],
  ["the code under another status", { status: 400, code: 10073 }],
])("a create refused with %s is never waited for: it is sent once, and its refusal stands", async (_what, refuseAs) => {
  const { synced: done, trace } = await synced({ ...emptyAccount(), refuse: CREATE, refuseAs }, "apply");

  expect([trace, done]).toMatchObject([[CREATED], { ok: false, status: refuseAs.status, errors: [{ code: refuseAs.code }] }]);
});
