// Cloudflare's own figures of an account, read with the install's kept key: six questions to its GraphQL Analytics API, and one to its API of Workflows.
//
//   figure                    dataset                         what is read                                              over
//   requests, errors          workersInvocationsAdaptive      sum.requests, sum.errors                                  the UTC day
//   stopped by a limit        workersInvocationsAdaptive      sum.requests of the status exceededResources              the UTC day
//   slowest processing        workersInvocationsAdaptive      quantiles.cpuTimeP99, in microseconds                     the UTC day
//   rows                      d1AnalyticsAdaptiveGroups       sum.rowsRead, sum.rowsWritten                             the UTC day
//   database bytes            d1StorageAdaptiveGroups         max.databaseSizeBytes, database by database               the UTC day and the one before
//   stored bytes              r2StorageAdaptiveGroups         max.payloadSize + max.metadataSize, bucket by bucket      the last 24 hours
//   files, unfinished uploads r2StorageAdaptiveGroups         max.objectCount, max.uploadCount, bucket by bucket        the last 24 hours
//   storage calls             r2OperationsAdaptiveGroups      sum.requests by actionType, as Class A or Class B         the UTC month
//   jobs                      workflowsAdaptiveGroups         count by eventType: started, ended well, failed           the UTC day
//   jobs running              GET .../workflows/{name}/instances?status=running, the install's own Workflow            now
//
// The free limits are the account's, so every figure but the last is of the whole account, whatever else runs in it.
// Cloudflare answers nothing of a query when one dataset in it fails, so each dataset is asked for by itself: one that gives nothing leaves its figures out and the others stand.
// https://developers.cloudflare.com/analytics/graphql-api/

import type { Keyed, KeyRefusal } from "@poplin/app/src/console/key/records";
import type { HostFigures } from "@poplin/app/src/console/usage/records";
import { BaseInstances } from "cloudflare/resources/workflows/instances/instances";
import * as v from "valibot";

import { type KeptKey, keyed } from "../install/key/kept-key";
import { callCloudflare } from "../install/client";
import { USAGE_RIGHT } from "../install/key/rights";

/** The right the running jobs are listed with. */
const JOBS_RIGHT = "Workers Scripts Write";

/** The code of the error the API answers a key that may not read a dataset. */
const DENIED_CODE = "authz";

/** The most groups one answer holds, which is Cloudflare's own bound. */
const MOST_GROUPS = 10_000;

/** The most instances one page of a Workflow's list holds, which is also the most an account runs at one time. */
const MOST_RUNNING = 100;

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** The length of a date in an ISO moment. */
const DATE_LENGTH = 10;

/** The length of the year and the month in an ISO moment. */
const MONTH_LENGTH = 7;

/** How many microseconds a tenth of a millisecond holds, and how many tenths a millisecond: a processing time is written to one decimal place. */
const TENTH = { microseconds: 100, inMillisecond: 10 } as const;

/** The status of a request Cloudflare ended because it used more than a request may. */
const STOPPED_STATUS = "exceededResources";

/** The events of a job that are counted: its start, its good end, and its failure. */
const JOB_EVENTS = { started: "WORKFLOW_START", done: "WORKFLOW_SUCCESS", failed: "WORKFLOW_FAILURE" } as const;

/** The R2 operations billed as Class A: the ones that write or list. https://developers.cloudflare.com/r2/pricing/ */
const CLASS_A: ReadonlySet<string> = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

/** The R2 operations billed as Class B: the ones that read. Every other operation, a delete among them, is free. */
const CLASS_B: ReadonlySet<string> = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);

/** One query for each dataset. Each names its groups `groups`, under the one account asked about; `whole` is the same dataset undivided, which a quantile is read of. */
const QUERIES = {
  requests: `query ($account: string!, $dayStart: Time!, $now: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: workersInvocationsAdaptive(limit: ${MOST_GROUPS}, filter: { datetime_geq: $dayStart, datetime_leq: $now }) { sum { requests errors } dimensions { status } }
    whole: workersInvocationsAdaptive(limit: ${MOST_GROUPS}, filter: { datetime_geq: $dayStart, datetime_leq: $now }) { quantiles { cpuTimeP99 } } } } }`,
  rows: `query ($account: string!, $day: Date!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: d1AnalyticsAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { date: $day }) { sum { rowsRead rowsWritten } } } } }`,
  sizes: `query ($account: string!, $dayBefore: Date!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: d1StorageAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { date_geq: $dayBefore }) { max { databaseSizeBytes } dimensions { databaseId } } } } }`,
  stored: `query ($account: string!, $dayAgo: Time!, $now: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: r2StorageAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { datetime_geq: $dayAgo, datetime_leq: $now }) { max { payloadSize metadataSize objectCount uploadCount } dimensions { bucketName } } } } }`,
  calls: `query ($account: string!, $monthStart: Time!, $now: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: r2OperationsAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { datetime_geq: $monthStart, datetime_leq: $now }) { sum { requests } dimensions { actionType } } } } }`,
  jobs: `query ($account: string!, $dayStart: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: workflowsAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { datetime_geq: $dayStart }) { count dimensions { eventType } } } } }`,
} as const;

/** A number of an answer; one left out counts nothing. */
const COUNT = v.optional(v.pipe(v.number(), v.minValue(0)), 0);

/** A name of an answer; one left out is no name. */
const NAME = v.optional(v.string(), "");

/** One group of an answer, with every number and name a figure is made of. */
const GROUP = v.object({
  count: COUNT,
  sum: v.optional(v.object({ requests: COUNT, errors: COUNT, rowsRead: COUNT, rowsWritten: COUNT }), {}),
  max: v.optional(v.object({ payloadSize: COUNT, metadataSize: COUNT, objectCount: COUNT, uploadCount: COUNT, databaseSizeBytes: COUNT }), {}),
  quantiles: v.optional(v.object({ cpuTimeP99: COUNT }), {}),
  dimensions: v.optional(v.object({ actionType: NAME, status: NAME, eventType: NAME }), {}),
});

/** An answer that holds groups: those of the one account asked about, and the dataset undivided where the query asked for it. */
const ANSWER = v.object({ data: v.object({ viewer: v.object({ accounts: v.tupleWithRest([v.object({ groups: v.array(GROUP), whole: v.optional(v.array(GROUP), []) })], v.unknown()) }) }) });

/** An answer that holds no groups and says why, as GraphQL writes its errors. */
const ERRORS = v.object({ errors: v.array(v.object({ extensions: v.optional(v.object({ code: v.optional(v.string(), "") }), {}) })) });

/** One group of an answer. */
type Group = v.InferOutput<typeof GROUP>;

/** What one query came back with. */
interface Groups {
  readonly groups: readonly Group[];
  readonly whole: readonly Group[];
}

/** What one question came back with: its value, or why it holds none, as the kept key's refusals name it. */
type Asked<Value> = Value | KeyRefusal;

/** What the figures are read with. */
interface Asking {
  /** The install's kept key; `undefined` for an install that keeps none. */
  readonly key: KeptKey | undefined;

  /** The id of the account the figures are of. */
  readonly accountId: string;

  /** The name of the install's own Workflow, which runs its jobs. */
  readonly workflow: string;
}

/** Why an answer Cloudflare sent holds no groups: the key may not read the dataset, or the answer is none this code can read. */
function withoutGroups(answer: unknown): KeyRefusal {
  const read = v.safeParse(ERRORS, answer);
  const denied = read.success && read.output.errors.some((error) => error.extensions.code === DENIED_CODE);

  return denied ? "lacks_right" : "unreachable";
}

/** Send one query with the kept key. */
async function ask(asking: Asking, query: string, variables: Readonly<Record<string, string>>): Promise<Asked<Groups>> {
  const body = { query, variables: { account: asking.accountId, ...variables } };
  const answer = await keyed(asking.key, USAGE_RIGHT, (connection) => callCloudflare(connection, (api) => api.post<unknown>("/graphql", { body })));
  if (!answer.ok) return answer.refusal;

  const read = v.safeParse(ANSWER, answer.value);

  return read.success ? read.output.data.viewer.accounts[0] : withoutGroups(answer.value);
}

/** Count the jobs of the install's own Workflow that run now, with the kept key: one page of its list, which holds as many as an account may run. */
async function askRunning(asking: Asking): Promise<Asked<number>> {
  const listed = { account_id: asking.accountId, status: "running", per_page: MOST_RUNNING } as const;
  // Awaited, the list is its first page alone: no further page is asked for.
  const answer = await keyed(asking.key, JOBS_RIGHT, (connection) => callCloudflare(connection, async (api) => (await new BaseInstances(api).list(asking.workflow, listed)).result.length));

  return answer.ok ? answer.value : answer.refusal;
}

function refused<Value>(asked: Asked<Value>): asked is KeyRefusal {
  return typeof asked === "string";
}

/** Why no figure can be shown, where that is so: the install keeps no key or Cloudflare no longer takes it, whatever else answered, or no question came back with a value. */
function refusalOf(queries: readonly Asked<Groups>[], running: Asked<number>): Extract<Keyed<never>, { readonly ok: false }> | undefined {
  const ofKey = [...queries, running].find((asked) => asked === "no_key" || asked === "key_refused");
  if (ofKey !== undefined && refused(ofKey)) return { ok: false, refusal: ofKey };

  if (!refused(running) || !queries.every(refused)) return undefined;

  // The right named is the one the queries need: the list of the jobs has its own, and a key that lacks only that one still reads every other figure.
  return queries.includes("lacks_right") ? { ok: false, refusal: "lacks_right", right: USAGE_RIGHT } : { ok: false, refusal: "unreachable" };
}

/** One figure of an answer: its groups added up, or none for an answer that holds no groups, so the figure is left out. */
function figureOf(asked: Asked<Groups>, pick: (group: Group) => number): number | undefined {
  if (refused(asked)) return undefined;

  return asked.groups.reduce((sum, group) => sum + pick(group), 0);
}

/** The processing time 99 in 100 requests stayed under, in milliseconds to one decimal place; none for an answer that holds no groups, and for a day with no request. */
function slowestOf(asked: Asked<Groups>): number | undefined {
  if (refused(asked) || asked.whole.length === 0) return undefined;

  const microseconds = Math.max(...asked.whole.map((group) => group.quantiles.cpuTimeP99));

  return Math.round(microseconds / TENTH.microseconds) / TENTH.inMillisecond;
}

/** A group's storage calls where its operation is billed in one class, and none where it is not. */
function billedAs(billed: ReadonlySet<string>): (group: Group) => number {
  return (group) => (billed.has(group.dimensions.actionType) ? group.sum.requests : 0);
}

/** A group's count where it is of one event of a job, and none where it is not. */
function eventsOf(event: string): (group: Group) => number {
  return (group) => (group.dimensions.eventType === event ? group.count : 0);
}

/**
 * Read Cloudflare's own figures of an account.
 *
 * @param now - the clock, in milliseconds since the epoch: the day and the month are the UTC ones it is in
 * @returns the figures, each left out where its question gave none. `no_key` or `key_refused` from any question is the answer; with no figure at all it is `lacks_right` when a question was denied, and `unreachable` when none was
 */
export async function readFigures(asking: Asking, now: number): Promise<Keyed<HostFigures>> {
  const moment = new Date(now).toISOString();
  const day = moment.slice(0, DATE_LENGTH);
  const dayAgo = new Date(now - DAY_MS).toISOString();
  const times = { now: moment, dayStart: `${day}T00:00:00Z`, dayAgo, dayBefore: dayAgo.slice(0, DATE_LENGTH), monthStart: `${moment.slice(0, MONTH_LENGTH)}-01T00:00:00Z` };
  const [running, ...queries] = await Promise.all([
    askRunning(asking),
    ask(asking, QUERIES.requests, { dayStart: times.dayStart, now: times.now }),
    ask(asking, QUERIES.rows, { day }),
    ask(asking, QUERIES.sizes, { dayBefore: times.dayBefore }),
    ask(asking, QUERIES.stored, { dayAgo: times.dayAgo, now: times.now }),
    ask(asking, QUERIES.calls, { monthStart: times.monthStart, now: times.now }),
    ask(asking, QUERIES.jobs, { dayStart: times.dayStart }),
  ] as const);
  const failed = refusalOf(queries, running);
  if (failed !== undefined) return failed;

  const [requests, rows, sizes, stored, calls, jobs] = queries;
  const value: HostFigures = {
    at: now,
    requests: figureOf(requests, (group) => group.sum.requests),
    errors: figureOf(requests, (group) => group.sum.errors),
    stopped: figureOf(requests, (group) => (group.dimensions.status === STOPPED_STATUS ? group.sum.requests : 0)),
    slowestMs: slowestOf(requests),
    rowsRead: figureOf(rows, (group) => group.sum.rowsRead),
    rowsWritten: figureOf(rows, (group) => group.sum.rowsWritten),
    databaseBytes: figureOf(sizes, (group) => group.max.databaseSizeBytes),
    storedBytes: figureOf(stored, (group) => group.max.payloadSize + group.max.metadataSize),
    files: figureOf(stored, (group) => group.max.objectCount),
    unfinishedUploads: figureOf(stored, (group) => group.max.uploadCount),
    storageWrites: figureOf(calls, billedAs(CLASS_A)),
    storageReads: figureOf(calls, billedAs(CLASS_B)),
    jobsStarted: figureOf(jobs, eventsOf(JOB_EVENTS.started)),
    jobsDone: figureOf(jobs, eventsOf(JOB_EVENTS.done)),
    jobsFailed: figureOf(jobs, eventsOf(JOB_EVENTS.failed)),
    jobsRunning: refused(running) ? undefined : running,
  };

  return { ok: true, value };
}
