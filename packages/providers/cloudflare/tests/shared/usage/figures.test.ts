import { describe, expect, test } from "bun:test";

import { readFigures } from "../../../src/shared/usage/figures";
import { withFake } from "../install/support/fake-cloudflare";
import { type Asked, refusal } from "../install/support/replies";

/** A made-up account id. */
const ACCOUNT = "0123456789abcdef0123456789abcdef";

/** A made-up Workflow of an install. */
const WORKFLOW = "poplin-jobs";

/** Half past two on the fifteenth of November 2026, UTC. */
const NOW = Date.UTC(2026, 10, 15, 14, 30);

/** The right the figures need, as a refusal names it and as Cloudflare lists the group a key is made with. */
const RIGHT = "Account Analytics Read";

/** What stands for the list of the running jobs among the datasets, which a query names and a list does not. */
const RUNNING = "instances";

/** The groups Cloudflare answers for each dataset: requests by how they ended, two databases, two buckets, the bucket operations of each kind of billing, and the events of the jobs, a heartbeat among them. */
const GROUPS: Readonly<Record<string, readonly unknown[]>> = {
  workersInvocationsAdaptive: [
    { sum: { requests: 1300, errors: 0 }, dimensions: { status: "success" } },
    { sum: { requests: 11, errors: 11 }, dimensions: { status: "scriptThrewException" } },
    { sum: { requests: 7, errors: 7 }, dimensions: { status: "exceededResources" } },
  ],
  d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 13_000, rowsWritten: 300 } }, { sum: { rowsRead: 902, rowsWritten: 42 } }],
  d1StorageAdaptiveGroups: [
    { max: { databaseSizeBytes: 2_000_000 }, dimensions: { databaseId: "one" } },
    { max: { databaseSizeBytes: 300_000 }, dimensions: { databaseId: "other" } },
  ],
  r2StorageAdaptiveGroups: [
    { max: { payloadSize: 4_000_000, metadataSize: 500, objectCount: 200, uploadCount: 3 }, dimensions: { bucketName: "sites" } },
    { max: { payloadSize: 999_000, metadataSize: 500, objectCount: 12, uploadCount: 0 }, dimensions: { bucketName: "other" } },
  ],
  r2OperationsAdaptiveGroups: [
    { sum: { requests: 40_000 }, dimensions: { actionType: "PutObject" } },
    { sum: { requests: 1200 }, dimensions: { actionType: "ListObjects" } },
    { sum: { requests: 300_000 }, dimensions: { actionType: "GetObject" } },
    { sum: { requests: 10_000 }, dimensions: { actionType: "HeadObject" } },
    { sum: { requests: 77 }, dimensions: { actionType: "DeleteObject" } },
  ],
  workflowsAdaptiveGroups: [
    { count: 6, dimensions: { eventType: "WORKFLOW_START" } },
    { count: 40, dimensions: { eventType: "WORKFLOW_RUNNING" } },
    { count: 4, dimensions: { eventType: "WORKFLOW_SUCCESS" } },
    { count: 1, dimensions: { eventType: "WORKFLOW_FAILURE" } },
    { count: 1, dimensions: { eventType: "WORKFLOW_TERMINATED" } },
  ],
};

/** The dataset of the requests undivided, as its query asks for it beside the groups: the processing time 99 in 100 requests stayed under, in microseconds. */
const WHOLE: Readonly<Record<string, readonly unknown[]>> = { workersInvocationsAdaptive: [{ quantiles: { cpuTimeP99: 27_949 } }] };

/** Every figure the answers above come to. */
const FIGURES = {
  at: NOW,
  requests: 1318,
  errors: 18,
  stopped: 7,
  slowestMs: 27.9,
  rowsRead: 13_902,
  rowsWritten: 342,
  databaseBytes: 2_300_000,
  storedBytes: 5_000_000,
  files: 212,
  unfinishedUploads: 3,
  storageWrites: 41_200,
  storageReads: 310_000,
  jobsStarted: 6,
  jobsDone: 4,
  jobsFailed: 1,
  jobsRunning: 2,
};

/** The figures each question gives, by the dataset it asks for. */
const FIGURES_OF: Readonly<Record<string, readonly (keyof typeof FIGURES)[]>> = {
  workersInvocationsAdaptive: ["requests", "errors", "stopped", "slowestMs"],
  d1AnalyticsAdaptiveGroups: ["rowsRead", "rowsWritten"],
  d1StorageAdaptiveGroups: ["databaseBytes"],
  r2StorageAdaptiveGroups: ["storedBytes", "files", "unfinishedUploads"],
  r2OperationsAdaptiveGroups: ["storageWrites", "storageReads"],
  workflowsAdaptiveGroups: ["jobsStarted", "jobsDone", "jobsFailed"],
  [RUNNING]: ["jobsRunning"],
};

/** What every reading is made with. */
function asking(connection: Parameters<Parameters<typeof withFake>[1]>[0]): Parameters<typeof readFigures>[0] {
  return { key: { connection }, accountId: ACCOUNT, workflow: WORKFLOW };
}

/** The dataset a question asks for: the one its query names, or the list of the running jobs. */
function datasetOf(asked: Asked): string {
  if (asked.method === "GET") return RUNNING;

  const { query } = asked.body as { readonly query: string };

  return Object.keys(GROUPS).find((dataset) => query.includes(dataset)) ?? "";
}

/** The figures without those of the datasets named. */
function without(datasets: readonly string[]): { readonly at: number } & Readonly<Record<string, number>> {
  const gone = new Set(datasets.flatMap((dataset) => FIGURES_OF[dataset] ?? []));

  return { at: NOW, ...Object.fromEntries(Object.entries(FIGURES).filter(([figure]) => !gone.has(figure as keyof typeof FIGURES))) };
}

/** The list of the running jobs as Cloudflare answers it: two of them. */
const TWO_RUNNING = { success: true, errors: [], messages: [], result: [{ id: "one", status: "running" }, { id: "other", status: "running" }], result_info: { count: 2, per_page: 100 } };

/** A failure of Cloudflare's own, as each kind of question is answered one: the list with a refusal, a query with errors and no data. */
function ownFailure(asked: Asked): Response {
  return datasetOf(asked) === RUNNING ? refusal(400, 1001, "Bad request") : Response.json({ data: null, errors: [{ message: "Internal server error" }] });
}

/** Cloudflare's answer to a question: two running jobs, or the groups of a query's dataset under the one account, with the datasets named in `missing` answered as GraphQL answers one the key cannot read. */
function answer(asked: Asked, missing: readonly string[] = []): Response {
  const dataset = datasetOf(asked);
  if (dataset === RUNNING) return Response.json(TWO_RUNNING);

  if (missing.includes(dataset)) return Response.json({ data: null, errors: [{ message: "not authorized for that account", extensions: { code: "authz" } }] });

  return Response.json({ data: { viewer: { accounts: [{ groups: GROUPS[dataset], ...(dataset in WHOLE ? { whole: WHOLE[dataset] } : {}) }] } }, errors: null });
}

describe("Cloudflare's own figures of an account", () => {
  // Drift: each figure is a sum over an account's Workers, databases, and buckets, in the UTC day or month.
  // A sum over one group, an operation billed in the wrong class, a heartbeat counted as a job, microseconds shown as milliseconds, or a local day would show a figure Cloudflare's own page does not.
  test("seven questions, each with the kept key and the account, come to the day's requests, errors, rows and jobs, the sizes, the month's storage calls by class, and the jobs running", async () => {
    await withFake(
      (asked) => answer(asked),
      async (connection, asked) => {
        const figures = await readFigures(asking(connection), NOW);
        const sent = asked.map((entry) => [entry.method, entry.path, entry.key, datasetOf(entry), (entry.body as { readonly variables?: unknown } | undefined)?.variables]);

        expect(figures).toEqual({ ok: true, value: FIGURES });
        expect(sent.sort((one, other) => String(one[3]).localeCompare(String(other[3])))).toEqual([
          ["POST", "/graphql", "Bearer test-key", "d1AnalyticsAdaptiveGroups", { account: ACCOUNT, day: "2026-11-15" }],
          ["POST", "/graphql", "Bearer test-key", "d1StorageAdaptiveGroups", { account: ACCOUNT, dayBefore: "2026-11-14" }],
          ["GET", `/accounts/${ACCOUNT}/workflows/${WORKFLOW}/instances?status=running&per_page=100`, "Bearer test-key", RUNNING, undefined],
          ["POST", "/graphql", "Bearer test-key", "r2OperationsAdaptiveGroups", { account: ACCOUNT, monthStart: "2026-11-01T00:00:00Z", now: "2026-11-15T14:30:00.000Z" }],
          ["POST", "/graphql", "Bearer test-key", "r2StorageAdaptiveGroups", { account: ACCOUNT, dayAgo: "2026-11-14T14:30:00.000Z", now: "2026-11-15T14:30:00.000Z" }],
          ["POST", "/graphql", "Bearer test-key", "workersInvocationsAdaptive", { account: ACCOUNT, dayStart: "2026-11-15T00:00:00Z", now: "2026-11-15T14:30:00.000Z" }],
          ["POST", "/graphql", "Bearer test-key", "workflowsAdaptiveGroups", { account: ACCOUNT, dayStart: "2026-11-15T00:00:00Z" }],
        ]);
      },
    );
  });

  // Drift: Cloudflare answers nothing of a query when one dataset in it fails; two datasets in one query would lose each other's figures, and a missing one shown as 0 reads as nothing used.
  test.each(Object.keys(GROUPS).map((dataset) => [dataset]))("the dataset %s giving nothing leaves its own figures out, and every other stands", async (dataset) => {
    await withFake(
      (asked) => answer(asked, [dataset]),
      async (connection) => {
        expect(await readFigures(asking(connection), NOW)).toEqual({ ok: true, value: without([dataset]) });
      },
    );
  });

  // Drift: a right missing for one question is that figure's alone; taken as the key's, it would hide the figures Cloudflare did give.
  test.each([["r2OperationsAdaptiveGroups"], [RUNNING]])("the question for %s refused for a missing right leaves its figures out, and the others stand", async (dataset) => {
    await withFake(
      (asked) => (datasetOf(asked) === dataset ? refusal(403, 10_000, "Authentication error") : answer(asked)),
      async (connection) => {
        expect(await readFigures(asking(connection), NOW)).toEqual({ ok: true, value: without([dataset]) });
      },
    );
  });

  // Drift: an account with nothing in it answers no groups; read as a failure, a new install would be told its key lacks a right, and a day without a request would show a processing time of 0.
  test("an account that used nothing answers every figure as none used, and no processing time", async () => {
    await withFake(
      (asked) => (datasetOf(asked) === RUNNING ? Response.json({ success: true, result: [] }) : Response.json({ data: { viewer: { accounts: [{ groups: [] }] } }, errors: null })),
      async (connection) => {
        const { at: _at, slowestMs: _slowest, ...counted } = FIGURES;

        expect(await readFigures(asking(connection), NOW)).toEqual({ ok: true, value: { at: NOW, ...Object.fromEntries(Object.keys(counted).map((figure) => [figure, 0])) } });
      },
    );
  });

  // Drift: each way of getting no figure has its own line on the screen; a key without the right told as a broken key would send a person to make a new one for nothing.
  test.each([
    ["no question is answered the key", (asked: Asked) => (datasetOf(asked) === RUNNING ? refusal(403, 10_000, "Authentication error") : answer(asked, Object.keys(GROUPS))), { ok: false, refusal: "lacks_right", right: RIGHT }],
    ["Cloudflare refuses the key for one query", (asked: Asked) => (datasetOf(asked) === "d1AnalyticsAdaptiveGroups" ? refusal(401, 1000, "Invalid API Token") : answer(asked)), { ok: false, refusal: "key_refused" }],
    ["Cloudflare says the key lacks the right", () => refusal(403, 10_000, "Authentication error"), { ok: false, refusal: "lacks_right", right: RIGHT }],
    ["Cloudflare answers every question with a failure of its own", ownFailure, { ok: false, refusal: "unreachable" }],
    ["nothing is where the questions go", () => undefined, { ok: false, refusal: "unreachable" }],
  ] as const)("%s", async (_what, respond, refused) => {
    await withFake(respond, async (connection) => {
      expect(await readFigures(asking(connection), NOW)).toEqual(refused);
    });
  });

  // Drift: an install that keeps no key is the usual one; a call made for it would spend an outside call of every opening of the Usage screen on a certain refusal.
  test("an install that keeps no key is answered no_key with no call made", async () => {
    await withFake(
      (asked) => answer(asked),
      async (_connection, asked) => {
        expect([await readFigures({ key: undefined, accountId: ACCOUNT, workflow: WORKFLOW }, NOW), asked.length]).toEqual([{ ok: false, refusal: "no_key" }, 0]);
      },
    );
  });
});
