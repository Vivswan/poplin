// Cloudflare's own figures of an account, read from its GraphQL Analytics API with the install's kept key.
//
//   figure           dataset                         what is summed                                          over
//   requests         workersInvocationsAdaptive      sum.requests                                            the UTC day
//   rows             d1AnalyticsAdaptiveGroups       sum.rowsRead, sum.rowsWritten                           the UTC day
//   stored bytes     r2StorageAdaptiveGroups         max.payloadSize + max.metadataSize, bucket by bucket    the last 24 hours
//   storage calls    r2OperationsAdaptiveGroups      sum.requests by actionType, as Class A or Class B       the UTC month
//
// The free limits are the account's, so every figure is of the whole account, whatever else runs in it.
// Each figure is asked for by itself, four calls in all: a dataset that gives nothing leaves its figure out and the others stand.
// https://developers.cloudflare.com/analytics/graphql-api/

import type { Keyed, KeyRefusal } from "@poplin/app/src/console/key/records";
import type { HostFigures } from "@poplin/app/src/console/usage/records";
import * as v from "valibot";

import { type KeptKey, keyed } from "../install/key/kept-key";
import { callCloudflare } from "../install/client";
import { USAGE_RIGHT } from "../install/key/rights";

/** The code of the error the API answers a key that may not read a dataset. */
const DENIED_CODE = "authz";

/** The most groups one answer holds, which is Cloudflare's own bound. */
const MOST_GROUPS = 10_000;

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** The length of a date in an ISO moment. */
const DATE_LENGTH = 10;

/** The length of the year and the month in an ISO moment. */
const MONTH_LENGTH = 7;

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

/** One query for each figure. Each names its groups `groups`, under the one account asked about. */
const QUERIES = {
  requests: `query ($account: string!, $dayStart: Time!, $now: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: workersInvocationsAdaptive(limit: ${MOST_GROUPS}, filter: { datetime_geq: $dayStart, datetime_leq: $now }) { sum { requests } } } } }`,
  rows: `query ($account: string!, $day: Date!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: d1AnalyticsAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { date: $day }) { sum { rowsRead rowsWritten } } } } }`,
  stored: `query ($account: string!, $dayAgo: Time!, $now: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: r2StorageAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { datetime_geq: $dayAgo, datetime_leq: $now }) { max { payloadSize metadataSize } dimensions { bucketName } } } } }`,
  calls: `query ($account: string!, $monthStart: Time!, $now: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    groups: r2OperationsAdaptiveGroups(limit: ${MOST_GROUPS}, filter: { datetime_geq: $monthStart, datetime_leq: $now }) { sum { requests } dimensions { actionType } } } } }`,
} as const;

/** A number of an answer; one left out counts nothing. */
const COUNT = v.optional(v.pipe(v.number(), v.minValue(0)), 0);

/** One group of an answer, with every number and name a figure is made of. */
const GROUP = v.object({
  sum: v.optional(v.object({ requests: COUNT, rowsRead: COUNT, rowsWritten: COUNT }), {}),
  max: v.optional(v.object({ payloadSize: COUNT, metadataSize: COUNT }), {}),
  dimensions: v.optional(v.object({ actionType: v.optional(v.string(), "") }), {}),
});

/** An answer that holds groups: those of the one account asked about. */
const ANSWER = v.object({ data: v.object({ viewer: v.object({ accounts: v.tupleWithRest([v.object({ groups: v.array(GROUP) })], v.unknown()) }) }) });

/** An answer that holds no groups and says why, as GraphQL writes its errors. */
const ERRORS = v.object({ errors: v.array(v.object({ extensions: v.optional(v.object({ code: v.optional(v.string(), "") }), {}) })) });

/** One group of an answer. */
type Group = v.InferOutput<typeof GROUP>;

/** What one query came back with: its groups, or why it holds none, as the kept key's refusals name it. */
type Asked = readonly Group[] | KeyRefusal;

/** What the figures are read with. */
interface Asking {
  /** The install's kept key; `undefined` for an install that keeps none. */
  readonly key: KeptKey | undefined;

  /** The id of the account the figures are of. */
  readonly accountId: string;
}

/** Why an answer Cloudflare sent holds no groups: the key may not read the dataset, or the answer is none this code can read. */
function withoutGroups(answer: unknown): KeyRefusal {
  const read = v.safeParse(ERRORS, answer);
  const denied = read.success && read.output.errors.some((error) => error.extensions.code === DENIED_CODE);

  return denied ? "lacks_right" : "unreachable";
}

/** Send one query with the kept key. */
async function ask(asking: Asking, query: string, variables: Readonly<Record<string, string>>): Promise<Asked> {
  const body = { query, variables: { account: asking.accountId, ...variables } };
  const answer = await keyed(asking.key, USAGE_RIGHT, (connection) => callCloudflare(connection, (api) => api.post<unknown>("/graphql", { body })));
  if (!answer.ok) return answer.refusal;

  const read = v.safeParse(ANSWER, answer.value);

  return read.success ? read.output.data.viewer.accounts[0].groups : withoutGroups(answer.value);
}

function holdsGroups(asked: Asked): asked is readonly Group[] {
  return typeof asked !== "string";
}

/** Why no figure can be shown, where that is so: the install keeps no key or Cloudflare no longer takes it, whatever else answered, or no query came back with groups. */
function refusalOf(answers: readonly Asked[]): Extract<Keyed<never>, { readonly ok: false }> | undefined {
  const ofKey = answers.find((asked) => asked === "no_key" || asked === "key_refused");
  if (ofKey !== undefined && !holdsGroups(ofKey)) return { ok: false, refusal: ofKey };

  if (answers.some(holdsGroups)) return undefined;

  return answers.includes("lacks_right") ? { ok: false, refusal: "lacks_right", right: USAGE_RIGHT } : { ok: false, refusal: "unreachable" };
}

/** One figure of an answer: its groups added up, or none for an answer that holds no groups, so the figure is left out. */
function figureOf(asked: Asked, pick: (group: Group) => number): number | undefined {
  if (!holdsGroups(asked)) return undefined;

  return asked.reduce((sum, group) => sum + pick(group), 0);
}

/** A group's storage calls where its operation is billed in one class, and none where it is not. */
function billedAs(billed: ReadonlySet<string>): (group: Group) => number {
  return (group) => (billed.has(group.dimensions.actionType) ? group.sum.requests : 0);
}

/**
 * Read Cloudflare's own figures of an account.
 *
 * @param now - the clock, in milliseconds since the epoch: the day and the month are the UTC ones it is in
 * @returns the figures, each left out where its query gave none. `no_key` or `key_refused` from any query is the answer; with no figure at all it is `lacks_right` when a query was denied, and `unreachable` when none was
 */
export async function readFigures(asking: Asking, now: number): Promise<Keyed<HostFigures>> {
  const moment = new Date(now).toISOString();
  const day = moment.slice(0, DATE_LENGTH);
  const times = { now: moment, dayStart: `${day}T00:00:00Z`, dayAgo: new Date(now - DAY_MS).toISOString(), monthStart: `${moment.slice(0, MONTH_LENGTH)}-01T00:00:00Z` };
  const answers = await Promise.all([
    ask(asking, QUERIES.requests, { dayStart: times.dayStart, now: times.now }),
    ask(asking, QUERIES.rows, { day }),
    ask(asking, QUERIES.stored, { dayAgo: times.dayAgo, now: times.now }),
    ask(asking, QUERIES.calls, { monthStart: times.monthStart, now: times.now }),
  ] as const);
  const refused = refusalOf(answers);
  if (refused !== undefined) return refused;

  const [requests, rows, stored, calls] = answers;
  const value: HostFigures = {
    at: now,
    requests: figureOf(requests, (group) => group.sum.requests),
    rowsRead: figureOf(rows, (group) => group.sum.rowsRead),
    rowsWritten: figureOf(rows, (group) => group.sum.rowsWritten),
    storedBytes: figureOf(stored, (group) => group.max.payloadSize + group.max.metadataSize),
    storageWrites: figureOf(calls, billedAs(CLASS_A)),
    storageReads: figureOf(calls, billedAs(CLASS_B)),
  };

  return { ok: true, value };
}
