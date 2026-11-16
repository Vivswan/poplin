// The account's bucket against the fake API.
// Without these an install could make a second bucket beside poplin's, take a bucket of a longer name for it, or change something in a run that was only to read.

import { expect, test } from "bun:test";
import { planBucket, syncBucket } from "../../../../../src/shared/install/pieces/bucket/bucket";
import { withFake } from "../../support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, TOKEN } from "../../support/fake-install";

/** Run a sync against an account at the fake API, and say what it sent that changes something. */
async function synced(account: Account, mode: "plan" | "apply"): Promise<{ readonly synced: Awaited<ReturnType<typeof syncBucket>>; readonly writes: string[] }> {
  let result: Awaited<ReturnType<typeof syncBucket>> | undefined;
  const writes: string[] = [];

  await withFake(
    (asked) => answer(account, asked),
    async (connection, asked) => {
      result = await syncBucket({ ...connection, key: TOKEN }, ACCOUNT, mode);
      writes.push(...asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path} ${JSON.stringify(entry.body)}`));
    },
  );
  if (result === undefined) throw new Error("the sync did not run");

  return { synced: result, writes };
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

  expect([planned.synced.ok && planned.synced.report.created, planned.writes, made.writes, again.writes]).toEqual([["poplin-sites"], [], [`POST /accounts/${ACCOUNT}/r2/buckets {"name":"poplin-sites"}`], []]);
  expect([made.synced.ok && made.synced.report.created, again.synced.ok && again.synced.report.left, account.buckets]).toEqual([["poplin-sites"], ["poplin-sites"], [{ name: "poplin-sites" }]]);
});

// Drift: a refusal is how a token without the storage permission, and an account whose storage is off, are told. One that threw, or read as an empty list, would hide both.
test("a list Cloudflare refuses is a failure with its status and its code, and nothing is made", async () => {
  const account = { ...emptyAccount(), refuse: `GET /accounts/${ACCOUNT}/r2/buckets`, refuseMessage: "Authentication error" };
  const refused = await synced(account, "apply");

  expect([refused.synced, refused.writes]).toMatchObject([{ ok: false, failure: "refused", status: 403, errors: [{ code: 10000 }] }, []]);
});
