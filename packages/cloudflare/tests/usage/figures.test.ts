import { describe, expect, test } from "bun:test";

import { readFigures } from "../../src/usage/figures";
import { withFake } from "../zone/support/fake-cloudflare";
import { type Asked, refusal } from "../zone/support/replies";

/** A made-up account id. */
const ACCOUNT = "0123456789abcdef0123456789abcdef";

/** Half past two on the fifteenth of November 2026, UTC. */
const NOW = Date.UTC(2026, 10, 15, 14, 30);

/** The right the figures need, as a refusal names it and as Cloudflare lists the group a key is made with. */
const RIGHT = "Account Analytics Read";

/** The groups Cloudflare answers for each dataset: two Workers, two databases, two buckets, and the bucket operations of each kind of billing. */
const GROUPS: Readonly<Record<string, readonly unknown[]>> = {
  workersInvocationsAdaptive: [{ sum: { requests: 1300 } }, { sum: { requests: 18 } }],
  d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 13_000, rowsWritten: 300 } }, { sum: { rowsRead: 902, rowsWritten: 42 } }],
  r2StorageAdaptiveGroups: [
    { max: { payloadSize: 4_000_000, metadataSize: 500 }, dimensions: { bucketName: "sites" } },
    { max: { payloadSize: 999_000, metadataSize: 500 }, dimensions: { bucketName: "other" } },
  ],
  r2OperationsAdaptiveGroups: [
    { sum: { requests: 40_000 }, dimensions: { actionType: "PutObject" } },
    { sum: { requests: 1200 }, dimensions: { actionType: "ListObjects" } },
    { sum: { requests: 300_000 }, dimensions: { actionType: "GetObject" } },
    { sum: { requests: 10_000 }, dimensions: { actionType: "HeadObject" } },
    { sum: { requests: 77 }, dimensions: { actionType: "DeleteObject" } },
  ],
};

/** Every figure the groups above add up to. */
const FIGURES = { at: NOW, requests: 1318, rowsRead: 13_902, rowsWritten: 342, storedBytes: 5_000_000, storageWrites: 41_200, storageReads: 310_000 };

/** The dataset a query asks for. */
function datasetOf(asked: Asked): string {
  const { query } = asked.body as { readonly query: string };

  return Object.keys(GROUPS).find((dataset) => query.includes(dataset)) ?? "";
}

/** Cloudflare's answer to a query: the groups of its dataset under the one account, with the datasets named in `missing` answered as GraphQL answers one the key cannot read. */
function answer(asked: Asked, missing: readonly string[] = []): Response {
  const dataset = datasetOf(asked);
  if (missing.includes(dataset)) return Response.json({ data: null, errors: [{ message: "not authorized for that account", extensions: { code: "authz" } }] });

  return Response.json({ data: { viewer: { accounts: [{ groups: GROUPS[dataset] }] } }, errors: null });
}

describe("Cloudflare's own figures of an account", () => {
  // Drift: each figure is a sum over an account's Workers, databases, and buckets, in the UTC day or month; a sum over one group, an operation billed in the wrong class, or a local day would show a figure Cloudflare's own page does not.
  test("four queries, each with the kept key and the account, add up to the day's requests and rows, the stored bytes, and the month's storage calls by class", async () => {
    await withFake(
      (asked) => answer(asked),
      async (connection, asked) => {
        const figures = await readFigures({ key: { connection }, accountId: ACCOUNT }, NOW);
        const sent = asked.map((entry) => [entry.method, entry.path, entry.key, datasetOf(entry), (entry.body as { readonly variables: unknown }).variables]);

        expect(figures).toEqual({ ok: true, value: FIGURES });
        expect(sent.sort((one, other) => String(one[3]).localeCompare(String(other[3])))).toEqual([
          ["POST", "/graphql", "Bearer test-key", "d1AnalyticsAdaptiveGroups", { account: ACCOUNT, day: "2026-11-15" }],
          ["POST", "/graphql", "Bearer test-key", "r2OperationsAdaptiveGroups", { account: ACCOUNT, monthStart: "2026-11-01T00:00:00Z", now: "2026-11-15T14:30:00.000Z" }],
          ["POST", "/graphql", "Bearer test-key", "r2StorageAdaptiveGroups", { account: ACCOUNT, dayAgo: "2026-11-14T14:30:00.000Z", now: "2026-11-15T14:30:00.000Z" }],
          ["POST", "/graphql", "Bearer test-key", "workersInvocationsAdaptive", { account: ACCOUNT, dayStart: "2026-11-15T00:00:00Z", now: "2026-11-15T14:30:00.000Z" }],
        ]);
      },
    );
  });

  // Drift: a plan or an account that cannot read one dataset would lose every figure, or show the missing one as 0, which reads as nothing used.
  test("a dataset Cloudflare gives nothing of leaves its figures out, and the others stand", async () => {
    await withFake(
      (asked) => answer(asked, ["r2OperationsAdaptiveGroups", "workersInvocationsAdaptive"]),
      async (connection) => {
        const { requests: _requests, storageWrites: _writes, storageReads: _reads, ...rest } = FIGURES;

        expect(await readFigures({ key: { connection }, accountId: ACCOUNT }, NOW)).toEqual({ ok: true, value: rest });
      },
    );
  });

  // Drift: a right missing for one dataset is that figure's alone; taken as the key's, it would hide the three figures Cloudflare did give.
  test("a query Cloudflare refuses for a missing right leaves its figures out, and the others stand", async () => {
    await withFake(
      (asked) => (datasetOf(asked) === "r2OperationsAdaptiveGroups" ? refusal(403, 10_000, "Authentication error") : answer(asked)),
      async (connection) => {
        const { storageWrites: _writes, storageReads: _reads, ...rest } = FIGURES;

        expect(await readFigures({ key: { connection }, accountId: ACCOUNT }, NOW)).toEqual({ ok: true, value: rest });
      },
    );
  });

  // Drift: an account with nothing in it answers no groups; read as a failure, a new install would be told its key lacks a right.
  test("an account that used nothing answers every figure as none used", async () => {
    await withFake(
      () => Response.json({ data: { viewer: { accounts: [{ groups: [] }] } }, errors: null }),
      async (connection) => {
        expect(await readFigures({ key: { connection }, accountId: ACCOUNT }, NOW)).toEqual({
          ok: true,
          value: { at: NOW, requests: 0, rowsRead: 0, rowsWritten: 0, storedBytes: 0, storageWrites: 0, storageReads: 0 },
        });
      },
    );
  });

  // Drift: each way of getting no figure has its own line on the screen; a key without the right told as a broken key would send a person to make a new one for nothing.
  test.each([
    ["no dataset answers the key", (asked: Asked) => answer(asked, Object.keys(GROUPS)), { ok: false, refusal: "lacks_right", right: RIGHT }],
    ["Cloudflare refuses the key for one query", (asked: Asked) => (datasetOf(asked) === "d1AnalyticsAdaptiveGroups" ? refusal(401, 1000, "Invalid API Token") : answer(asked)), { ok: false, refusal: "key_refused" }],
    ["Cloudflare says the key lacks the right", () => refusal(403, 10_000, "Authentication error"), { ok: false, refusal: "lacks_right", right: RIGHT }],
    ["Cloudflare answers every query with a failure of its own", () => Response.json({ data: null, errors: [{ message: "Internal server error" }] }), { ok: false, refusal: "unreachable" }],
    ["nothing is where the queries go", () => undefined, { ok: false, refusal: "unreachable" }],
  ] as const)("%s", async (_what, respond, refused) => {
    await withFake(respond, async (connection) => {
      expect(await readFigures({ key: { connection }, accountId: ACCOUNT }, NOW)).toEqual(refused);
    });
  });

  // Drift: an install that keeps no key is the usual one; a call made for it would spend an outside call of every opening of the Usage screen on a certain refusal.
  test("an install that keeps no key is answered no_key with no call made", async () => {
    await withFake(
      (asked) => answer(asked),
      async (_connection, asked) => {
        expect([await readFigures({ key: undefined, accountId: ACCOUNT }, NOW), asked.length]).toEqual([{ ok: false, refusal: "no_key" }, 0]);
      },
    );
  });
});
