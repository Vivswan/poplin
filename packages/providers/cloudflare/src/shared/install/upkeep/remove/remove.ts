// `poplin uninstall cloudflare`: everything an install made in an account, taken away with an account token, and nothing else.
//
//   1  what sends visitors to the Worker    routes, records, the three kinds of rule and the ruleset poplin made for each, or the two forwarders
//   2  the login                            the Access applications, then the policies they hold
//   3  the alerts                           the notification policies of poplin's names
//   4  the two keys                         before the Worker that holds them
//   5  the Workflow                         before the Worker whose code it runs
//   6  the Worker                           with its triggers, its variables, and its secrets
//   7  the sites' files                     every object, then the bucket
//   8  the database                         last
//
// An object is poplin's by the fixed name or the mark an install gives it, and one without stays.
// Each kind is listed and then removed, so a run that stopped is run again and removes what is left.

import { AllowanceSpent } from "@poplin/core/src/database/driver";
import type { Blocked, Removable, Removal, RemovalRow, RemovalState, Removed } from "@poplin/core/src/install/installer";
import { showBytes } from "@poplin/core/src/records/settings";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { BasePolicies as BaseAlerts } from "cloudflare/resources/alerting/policies";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { BaseRecords } from "cloudflare/resources/dns/records";
import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";
import { BaseObjects } from "cloudflare/resources/r2/buckets/objects";
import { BaseRulesets } from "cloudflare/resources/rulesets/rulesets";
import { BaseRoutes } from "cloudflare/resources/workers/routes";
import { BaseScripts } from "cloudflare/resources/workers/scripts/scripts";
import { BaseWorkflows } from "cloudflare/resources/workflows/workflows";
import { BaseApplications } from "cloudflare/resources/zero-trust/access/applications/applications";
import { BasePolicies } from "cloudflare/resources/zero-trust/access/policies";
import { lacksRight, rightFor } from "../../../../with-domain/zone-plug";
import { CERTIFICATE_ALERT } from "../../../../with-domain/pieces/alerts/certificate-alert";
import { NEW_RULESET_NAMES, type NamedPhaseRules, type RuleStep, removeOwnRule, syncPhase } from "../../../../with-domain/pieces/rules/rules";
import { addressesAt, forwarderNames } from "../../../../without-domain/address-layout";
import { removeForwarders } from "../../../../without-domain/pieces/forwarders/forwarders";
import { ApiRefused, apiDriver } from "../../../database/api-driver";
import { workflowNameOf } from "../../../jobs/workflow-name";
import { type CloudflareFailure, type CloudflareResult, callCloudflare, findZones } from "../../client";
import { isOwn, type Place, type Where } from "../../first/find";
import { failureWords } from "../../first/rows";
import { BY_NAME, INSTALL_OBJECTS } from "../../install-objects";
import { isAccessOff } from "../../pieces/access/access";
import { BUDGET_ALERT } from "../../pieces/alerts/budget-alert";
import { listBuckets, planBucket } from "../../pieces/bucket/bucket";
import { type DatabaseHolder, holderWords, readHolder, syncDatabase } from "../../pieces/database/database";
import { type ListedBinding, readWorker } from "../../pieces/variables/variables";
import { applySteps, type Mode, type Synced } from "../../sync";

/** The name of the install's Worker. */
const SCRIPT = INSTALL_OBJECTS.worker;

/** The status Cloudflare answers for an object the account does not hold. */
const NOT_FOUND = 404;

/** The phases poplin keeps a rule in, each with the row of its rules, the refs of its rules there, and the row of the ruleset poplin makes for them where the zone had none. */
const OWN_RULES = [
  { object: "Redirect rule", holder: "Redirect ruleset", phase: "http_request_dynamic_redirect", refs: [INSTALL_OBJECTS.httpsRef] },
  { object: "WAF rule", holder: "WAF ruleset", phase: "http_request_firewall_custom", refs: [INSTALL_OBJECTS.outsideRef, INSTALL_OBJECTS.botsRef] },
  { object: "Rate rule", holder: "Rate ruleset", phase: "http_ratelimit", refs: [INSTALL_OBJECTS.rateRef] },
] as const;

/** The names of poplin's two applications, and of the policy each holds. */
const OWN_ACCESS = {
  applications: [INSTALL_OBJECTS.accessApplication, INSTALL_OBJECTS.accessOpenApplication] as readonly string[],
  policies: [INSTALL_OBJECTS.accessPolicy, INSTALL_OBJECTS.accessOpenPolicy] as readonly string[],
};

/** The notification policies an install makes, in the order of their rows, each with the name its policy has. The certificate alert is of an install under a domain alone. */
const OWN_ALERTS = [
  { object: "Budget alert", name: BUDGET_ALERT.name, domain: false },
  { object: "Certificate alert", name: CERTIFICATE_ALERT.name, domain: true },
] as const;

/** The two keys of an install, in the order of their rows, each with the name every key of its kind has. */
const OWN_KEYS = [
  { object: "Key", name: INSTALL_OBJECTS.keyName },
  { object: "Upload key", name: INSTALL_OBJECTS.uploadKeyName },
] as const;

/** The states of a row that leave a removal not done. */
const UNDONE: ReadonlySet<RemovalState> = new Set(["block", "fail", "not-run"]);

/** The one question the database is asked: how many sites it holds. */
const SITES_COUNT = "SELECT count(*) AS sites FROM sites";

/** Where a person deletes an account token. */
const TOKENS_PAGE = "https://dash.cloudflare.com/profile/api-tokens";

/** What a line says, where no object's own name says it. */
const WORDS = {
  lacks: "the account token lacks",
  optional: "The account token lacks",
  workerStands: "the Worker must be removed first",
  applicationsStand: "an Access application must be removed first",
  notOwn: "not this install's: the Worker binds another",
  stays: "left in place",
  strangers: "a Worker with this name is not poplin's and is left in place",
  othersRules: "it has rules that are not poplin's and is left in place",
  bots: "AI crawler blocking and Bot Fight Mode are zone settings and keep their values",
  token: `delete it at Cloudflare: ${TOKENS_PAGE}`,
  unreachable: "Cloudflare gave no valid response. Nothing changed.",
  notConfirmed: "The confirmation does not match",
  changed: "The account changed after it was checked. Rerun this command. Nothing changed.",
} as const;

/** The row of a kind of rule, or of the ruleset poplin makes for it. */
type RuleKind = (typeof OWN_RULES)[number]["object" | "holder"];

/** The object of each row, as the table of rights names it. The Worker and its Workflow need the permission its variables need, and a ruleset the one its rules need. */
type Kind = "Worker route" | "DNS record" | RuleKind | "Forwarder" | "Access application" | "Access policy" | (typeof OWN_ALERTS)[number]["object"] | "Key" | "Upload key" | "Workflow" | "Worker" | "R2 bucket" | "D1 database";

/** What one run gathers. `zoneId` is of an install under a domain alone, and `form` is where a permission is added to the token. */
interface Work {
  readonly mode: Mode;
  readonly place: Place;
  readonly data: "remove" | "keep";
  readonly kind: Where["kind"];
  readonly zoneId: string | undefined;
  readonly form: string;
  readonly rows: RemovalRow[];
  readonly say: (row: RemovalRow) => void;
}

/** What listing and removing one kind came to: the names that went, or would go, with the ones found gone on the way; or the failure, with the names that went before it and whether the list or a removal failed. */
type Taken = { readonly ok: true; readonly names: readonly string[]; readonly gone: readonly string[] } | (CloudflareFailure & { readonly names: readonly string[]; readonly at: "list" | "removal" });

/** How much a row's object holds. */
interface Held {
  readonly count?: number;
  readonly bytes?: number;
}

/** The permission a token needs to remove an object, as the token form names it. */
function rightOf(object: Kind): string {
  if (object === "Worker") return rightFor("Worker variable");

  if (object === "Redirect ruleset") return rightFor("Redirect rule");

  return rightFor(object === "WAF ruleset" || object === "Rate ruleset" ? "WAF rule" : object);
}

/** Add a row to the run and tell the command; answers whether the row leaves nothing undone. */
function note(work: Work, row: RemovalRow): boolean {
  work.rows.push(row);
  work.say(row);

  return !UNDONE.has(row.state);
}

/**
 * The row of a kind whose list or removal failed: blocked where the token lacks its permission, which the row names.
 *
 * @param before - what went before the failure, as the row says it
 * @param unlisted - whether it is the list of a kind an install makes only with an optional permission that failed: a token that may not read it is then no failure, and the kind stays
 */
function failed(work: Work, object: Kind, failure: CloudflareFailure, before: readonly string[] = [], unlisted = false): boolean {
  const right = rightOf(object);
  const went = before.length === 0 ? "" : `removed ${before.join(", ")}; then: `;
  if (lacksRight(failure) && unlisted) return note(work, { object, state: "stay", detail: `${WORDS.optional} ${right}`, right });

  if (lacksRight(failure)) return note(work, { object, state: "block", detail: `${went}${WORDS.lacks} ${right}`, right });

  return note(work, { object, state: "fail", detail: `${went}${failureWords(failure)}` });
}

/** Name what went, each name once: one that several objects carry, as two keys of one name do, says how many. */
function namedOnce(names: readonly string[]): string {
  const counted = new Map<string, number>();
  for (const name of names) counted.set(name, (counted.get(name) ?? 0) + 1);

  return [...counted].map(([name, same]) => (same === 1 ? name : `${name} (${same})`)).join(", ");
}

/** The row of one kind, from what its list and its removals came to; a kind the account holds nothing of has no row. */
function settled(work: Work, object: Kind, taken: Taken, held: Held = {}, optional = false): boolean {
  if (!taken.ok) return failed(work, object, taken, taken.names, optional && taken.at === "list");

  if (taken.names.length === 0) return true;

  const gone = taken.gone.length === taken.names.length;

  return note(work, { object, state: gone ? "gone" : "remove", detail: namedOnce(taken.names), ...held });
}

/** What a sync that removes came to, as the names that went. */
function takenOf(synced: Synced, gone: readonly string[] = []): Taken {
  return synced.ok ? { ok: true, names: synced.report.removed, gone } : { ...synced, names: synced.report.removed, at: synced.failed === undefined ? "list" : "removal" };
}

/**
 * Remove every listed item that is poplin's, one call each, in order.
 *
 * @param own - the name of an item that is poplin's, as its row shows it; `undefined` for one that is not
 * @returns the names that went, or in a plan would go; an item Cloudflare no longer holds counts as gone
 */
async function removeOwn<Item>(work: Work, listed: CloudflareResult<readonly Item[]>, own: (item: Item) => string | undefined, remove: (item: Item) => Promise<CloudflareResult<unknown>>): Promise<Taken> {
  if (!listed.ok) return { ...listed, names: [], at: "list" };

  const gone: string[] = [];
  const steps = listed.value.flatMap((item) => {
    const subject = own(item);

    return subject === undefined ? [] : [{ kind: "remove" as const, subject, item }];
  });
  const done = await applySteps(
    steps,
    async (step) => {
      const removed = await remove(step.item);
      if (removed.ok || removed.failure !== "refused" || removed.status !== NOT_FOUND) return removed;

      gone.push(step.subject);

      return { ok: true, value: undefined };
    },
    work.mode,
  );

  return takenOf(done, gone);
}

async function removeRoutes(work: Work, zoneId: string): Promise<boolean> {
  const { connection } = work.place;
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseRoutes(api).list({ zone_id: zoneId })));
  const taken = await removeOwn(
    work,
    listed,
    (route) => (route.script === SCRIPT ? route.pattern : undefined),
    (route) => callCloudflare(connection, (api) => new BaseRoutes(api).delete(route.id, { zone_id: zoneId })),
  );

  return settled(work, "Worker route", taken);
}

async function removeRecords(work: Work, zoneId: string): Promise<boolean> {
  const { connection } = work.place;
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseRecords(api).list({ zone_id: zoneId })));
  const taken = await removeOwn(
    work,
    listed,
    (record) => (record.comment?.startsWith(INSTALL_OBJECTS.recordMark) === true ? record.name : undefined),
    (record) => callCloudflare(connection, (api) => new BaseRecords(api).delete(record.id, { zone_id: zoneId })),
  );

  return settled(work, "DNS record", taken);
}

/** A ruleset under the name poplin makes one with is poplin's whole, and goes once no rule but poplin's is in it. One of another name was the zone's before the install: it stays, and is no row. */
async function removeRuleset(work: Work, zoneId: string, own: (typeof OWN_RULES)[number], current: NamedPhaseRules): Promise<void> {
  const name = NEW_RULESET_NAMES[own.phase];
  if (current.name !== name) return;

  const refs: readonly (string | undefined)[] = own.refs;
  if (current.rules.some((rule) => !refs.includes(rule.ref))) {
    note(work, { object: own.holder, state: "stay", detail: `${name}: ${WORDS.othersRules}` });

    return;
  }

  const remove = (): Promise<CloudflareResult<unknown>> => callCloudflare(work.place.connection, (api) => new BaseRulesets(api).delete(current.id, { zone_id: zoneId }));
  settled(work, own.holder, await removeOwn(work, { ok: true, value: [name] }, (ruleset) => ruleset, remove));
}

/** The rule with one of poplin's refs goes from each phase; the phase's other rules are in no request. The phase's ruleset is looked at once its rules went. */
async function removeRules(work: Work, zoneId: string): Promise<void> {
  for (const own of OWN_RULES) {
    const read: { phase?: NamedPhaseRules } = {};
    const plan = (current: NamedPhaseRules | undefined): RuleStep[] => {
      read.phase = current;

      return own.refs.flatMap((ref) => removeOwnRule(ref, ref, current));
    };
    const done = await syncPhase(work.place.connection, zoneId, own.phase, plan, work.mode);
    settled(work, own.object, takenOf(done), {}, true);
    if (done.ok && read.phase !== undefined) await removeRuleset(work, zoneId, own, read.phase);
  }
}

/** The forwarders go by the product's own removal: a Worker of a forwarder's name without poplin's tag stays, and is listed. */
async function removeOwnForwarders(work: Work): Promise<void> {
  const done = await removeForwarders(work.place.connection, work.place.accountId, forwarderNames(SCRIPT), work.mode);
  settled(work, "Forwarder", takenOf(done));

  for (const skipped of done.report.skipped) note(work, { object: "Forwarder", state: "skip", detail: `${skipped.subject}: ${WORDS.strangers}` });
}

/** An application goes before the policy it holds. An account whose Access is off holds none. */
async function removeAccess(work: Work): Promise<void> {
  const { connection, accountId } = work.place;
  const account = { account_id: accountId };
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseApplications(api).list(account)));
  if (!listed.ok && isAccessOff(listed)) return;

  const applications = await removeOwn(
    work,
    listed,
    (application) => (OWN_ACCESS.applications.includes(application.name ?? "") ? application.name : undefined),
    (application) => callCloudflare(connection, (api) => new BaseApplications(api).delete(application.id ?? "", account)),
  );
  if (!settled(work, "Access application", applications)) {
    note(work, { object: "Access policy", state: "not-run", detail: WORDS.applicationsStand });

    return;
  }

  const policies = await removeOwn(
    work,
    await callCloudflare(connection, (api) => Array.fromAsync(new BasePolicies(api).list(account))),
    (policy) => (OWN_ACCESS.policies.includes(policy.name ?? "") ? policy.name : undefined),
    (policy) => callCloudflare(connection, (api) => new BasePolicies(api).delete(policy.id ?? "", account)),
  );
  settled(work, "Access policy", policies);
}

/** Every notification policy of one of poplin's names that an install of the kind makes. A Repair makes each only with an optional permission, so a list the token may not read leaves its row as one that stays. */
async function removeAlerts(work: Work): Promise<void> {
  const { connection, accountId } = work.place;
  const account = { account_id: accountId };
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseAlerts(api).list(account)));

  for (const { object, name } of OWN_ALERTS.filter((alert) => !alert.domain || work.kind === "domain")) {
    const taken = await removeOwn(
      work,
      listed,
      (policy) => (policy.name === name ? name : undefined),
      (policy) => callCloudflare(connection, (api) => new BaseAlerts(api).delete(policy.id ?? "", account)),
    );
    settled(work, object, taken, {}, true);
  }
}

/** Every token of the account with the name of one of the two keys, ended ones too: a key of the name that ran out is still an object an install made. */
async function removeKeys(work: Work): Promise<void> {
  const { connection, accountId } = work.place;
  const account = { account_id: accountId };
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseTokens(api).list({ ...account, include_expired: true })));

  for (const { object, name } of OWN_KEYS) {
    const taken = await removeOwn(
      work,
      listed,
      (token) => (token.name === name ? name : undefined),
      (token) => callCloudflare(connection, (api) => new BaseTokens(api).delete(token.id ?? "", account)),
    );
    settled(work, object, taken);
  }
}

/** Cloudflare keeps a Workflow whose Worker was deleted, so it goes by its own call, with every job it ran. One of the name that runs another Worker's code is that Worker's, and is listed. */
async function removeWorkflow(work: Work): Promise<void> {
  const { connection, accountId } = work.place;
  const account = { account_id: accountId };
  const name = workflowNameOf(SCRIPT);
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseWorkflows(api).list({ ...account, search: name })));
  const named = listed.ok ? listed.value.filter((workflow) => workflow.name === name) : [];
  const own = (workflow: { readonly script_name: string; readonly script_deleted?: boolean }): boolean => workflow.script_name === SCRIPT || workflow.script_deleted === true;
  const taken = await removeOwn(
    work,
    listed.ok ? { ok: true, value: named } : listed,
    (workflow) => (own(workflow) ? name : undefined),
    () => callCloudflare(connection, (api) => new BaseWorkflows(api).delete(name, account)),
  );
  settled(work, "Workflow", taken);

  for (const other of named.filter((workflow) => !own(workflow))) note(work, { object: "Workflow", state: "skip", detail: `${name}: it runs the Worker ${other.script_name}, which is not poplin's` });
}

/** The Worker goes with everything it holds; answers whether none stands after. `stands` says whether the look for an install found one. */
async function removeWorker(work: Work, stands: boolean): Promise<boolean> {
  if (!stands) return true;

  const { connection, accountId } = work.place;
  // Asked for as the bare response: an answer with no body is a removal too.
  const remove = (): Promise<CloudflareResult<unknown>> => callCloudflare(connection, (api) => new BaseScripts(api).delete(SCRIPT, { account_id: accountId, force: true }).asResponse());

  return settled(work, "Worker", await removeOwn(work, { ok: true, value: [SCRIPT] }, (name) => name, remove));
}

/** The row of data a run leaves: it was told to keep it, the Worker still stands, or the Worker was bound to another. */
function left(work: Work, object: "R2 bucket" | "D1 database", detail: string, why: { readonly own: boolean; readonly workerGone: boolean }, held: Held = {}): boolean {
  if (!why.own) return note(work, { object, state: "skip", detail: `${detail}: ${WORDS.notOwn}`, ...held });

  if (work.data === "keep") return note(work, { object, state: "keep", detail, ...held });

  return note(work, { object, state: "not-run", detail: `${detail}: ${WORDS.workerStands}`, ...held });
}

/** What data a run leaves without reading it is called: with no Worker bound to it, its name is all that matched it, and the row says so. */
function unread(name: string, bound: boolean): string {
  return bound ? name : `${name} (${BY_NAME})`;
}

/** The row of data whose holdings a list could not read. A run that leaves the data never reads them, so its list names the data with no count; for data a run removes, the read failed. */
function uncounted(work: Work, object: "R2 bucket" | "D1 database", detail: string, why: { readonly own: boolean; readonly workerGone: boolean; readonly leaves: boolean }, failure: CloudflareFailure): boolean {
  return why.leaves ? left(work, object, detail, why) : failed(work, object, failure);
}

/** The sites' files: every object of the bucket, counted with its bytes, then the bucket. A run that leaves the bucket does not list what it holds. */
async function removeFiles(work: Work, why: { readonly own: boolean; readonly bound: boolean; readonly workerGone: boolean }): Promise<boolean> {
  const { connection, accountId } = work.place;
  const name = INSTALL_OBJECTS.bucket;
  const buckets = await listBuckets(connection, accountId);
  if (!buckets.ok) return failed(work, "R2 bucket", buckets);

  if (!planBucket(buckets.value).some((step) => step.kind === "leave")) return true;

  const leaves = !why.own || work.data === "keep" || !why.workerGone;
  if (leaves && work.mode === "apply") return left(work, "R2 bucket", unread(name, why.bound), why);

  const objects = await callCloudflare(connection, (api) => Array.fromAsync(new BaseObjects(api).list(name, { account_id: accountId })));
  // A bucket that went between the two reads is gone, which is no failure.
  if (!objects.ok && objects.failure === "refused" && objects.status === NOT_FOUND) return note(work, { object: "R2 bucket", state: "gone", detail: name });

  if (!objects.ok) return uncounted(work, "R2 bucket", unread(name, why.bound), { ...why, leaves }, objects);

  const held = { count: objects.value.length, bytes: objects.value.reduce((sum, object) => sum + (object.size ?? 0), 0) };
  const named = `${name} (files: ${held.count}, ${showBytes(held.bytes)}${why.bound ? "" : `; ${BY_NAME}`})`;
  if (leaves) return left(work, "R2 bucket", named, why, held);

  const emptied = await removeOwn(
    work,
    objects,
    (object) => object.key,
    (object) => callCloudflare(connection, (api) => new BaseObjects(api).delete(object.key ?? "", { account_id: accountId, bucket_name: name })),
  );
  if (!emptied.ok) return failed(work, "R2 bucket", emptied, [`${emptied.names.length} of the ${held.count} files`]);

  const bucket = await removeOwn(work, { ok: true, value: [named] }, (bucketName) => bucketName, () => callCloudflare(connection, (api) => new BaseBuckets(api).delete(name, { account_id: accountId })));

  return settled(work, "R2 bucket", bucket, held);
}

/** How many sites a database holds; `undefined` where it does not say, as one no Worker ever opened, or one whose day of free use is over. */
async function sitesIn(work: Work, id: string): Promise<number | undefined> {
  const driver = apiDriver(work.place.connection, { accountId: work.place.accountId, databaseId: id });

  try {
    const [counted] = await driver.batch([{ sql: SITES_COUNT, params: [] }]);
    const sites = counted?.rows[0]?.sites;

    return typeof sites === "number" ? sites : undefined;
  } catch (error) {
    if (error instanceof ApiRefused || error instanceof AllowanceSpent) return undefined;

    throw error;
  }
}

/**
 * Read what a database says of itself before it goes.
 *
 * @param bound - whether a Worker stood and was bound to it; with none, the name is all that says the database is poplin's, and its tables say whether it is
 * @returns whose it is by its tables, where no Worker was bound to it, and how many sites it holds, which only one that may be poplin's is asked; or the read that failed
 */
async function databaseFacts(work: Work, id: string, bound: boolean): Promise<CloudflareFailure | { readonly holder: DatabaseHolder | undefined; readonly sites: number | undefined }> {
  const read = bound ? undefined : await readHolder(work.place.connection, work.place.accountId, id);
  if (read?.ok === false) return read;

  const holder = read?.value;

  return { holder, sites: holder === "empty" || holder === "other" ? undefined : await sitesIn(work, id) };
}

/** The database, with every record, and how many sites it holds. `boundId` is the id the Worker's binding named, where a Worker stood. */
async function removeDatabase(work: Work, why: { readonly boundId: string | undefined; readonly bound: boolean; readonly workerGone: boolean }): Promise<boolean> {
  const { connection, accountId } = work.place;
  const name = INSTALL_OBJECTS.database;
  const found = await syncDatabase(connection, accountId, "plan");
  if (!found.ok) return found.failure === "no-id" ? note(work, { object: "D1 database", state: "fail", detail: "Cloudflare returned no database id" }) : failed(work, "D1 database", found);

  const { id } = found;
  if (id === undefined) return true;

  const reasons = { own: !why.bound || why.boundId === id, workerGone: why.workerGone };
  const leaves = !reasons.own || work.data === "keep" || !reasons.workerGone;
  if (leaves && work.mode === "apply") return left(work, "D1 database", unread(name, why.bound), reasons);

  const read = await databaseFacts(work, id, why.bound);
  if ("ok" in read) return uncounted(work, "D1 database", unread(name, why.bound), { ...reasons, leaves }, read);

  const { holder, sites } = read;
  if (holder === "other") return note(work, { object: "D1 database", state: "skip", detail: `${name}: ${holderWords(holder)}: ${WORDS.stays}` });

  const held = sites === undefined ? {} : { count: sites };
  const facts = [...(sites === undefined ? [] : [`sites: ${sites}`]), ...(holder === undefined ? [] : [holderWords(holder)])];
  const named = facts.length === 0 ? name : `${name} (${facts.join("; ")})`;
  if (leaves) return left(work, "D1 database", named, reasons, held);

  const taken = await removeOwn(work, { ok: true, value: [named] }, (databaseName) => databaseName, () => callCloudflare(connection, (api) => new BaseDatabase(api).delete(id, { account_id: accountId })));

  return settled(work, "D1 database", taken, held);
}

/** What the Worker that stands is bound to: its bucket's name and its database's id. */
function boundTo(bindings: readonly ListedBinding[]): { readonly bucket: string | undefined; readonly databaseId: string | undefined } {
  const bucket = bindings.find((binding) => binding.name === INSTALL_OBJECTS.bucketBinding && binding.type === "r2_bucket");
  const database = bindings.find((binding) => binding.name === INSTALL_OBJECTS.databaseBinding && binding.type === "d1");

  return { bucket: bucket?.bucket_name, databaseId: database?.id };
}

/** What a person types to say this install is meant: its dashboard's host; the bucket's name where data is left and no Worker stands; else the Worker's name with the account's. */
function confirmOf(found: Removable<Place>): string {
  if (found.state === "whole") return new URL(found.address).host;

  return found.state === "leftover" ? INSTALL_OBJECTS.bucket : `${SCRIPT}@${found.place.accountId}`;
}

/** What was typed, as a host is compared: without the scheme, a trailing slash, or capitals. */
function typedOf(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/$/, "");
}

/** Find the domain's zone in the account, for an install under a domain; an install without one has none. */
async function zoneOf(place: Place, where: Where): Promise<CloudflareResult<string | undefined>> {
  if (where.kind !== "domain") return { ok: true, value: undefined };

  const zones = await findZones(place.connection, where.layout.domain);

  return zones.ok ? { ok: true, value: zones.value.find((zone) => zone.accountId === place.accountId)?.id } : zones;
}

/** Why an install that is set is not the one the place names, where it answers at an address of the other kind or of another domain; `undefined` for one that is. */
function otherPlace(found: Removable<Place>, where: Where): string | undefined {
  if (found.state !== "whole") return undefined;

  const { host } = new URL(found.address);
  const there = where.kind === "domain" ? host === where.layout.adminHostname : addressesAt(host, SCRIPT) !== undefined;
  if (there) return undefined;

  const named = where.kind === "domain" ? `under ${where.layout.domain}` : "without a domain";

  return `The install in this account is at ${found.address}, not ${named}. Pass the matching --domain <name> or --no-domain. Nothing changed.`;
}

/** What points at the Worker, by the kind of install: the zone's routes, records, and rules, or the two forwarders. */
async function removeReach(work: Work): Promise<void> {
  if (work.kind === "no-domain") await removeOwnForwarders(work);

  if (work.zoneId === undefined) return;

  await removeRoutes(work, work.zoneId);
  await removeRecords(work, work.zoneId);
  await removeRules(work, work.zoneId);
}

/** What a run came to, from what it gathered. Each permission a blocked row names is a block too, once. */
function done(work: Work, confirm: string): Removed {
  const rights = [...new Set(work.rows.flatMap((row) => (row.state === "block" && row.right !== undefined ? [row.right] : [])))];
  const blocked = rights.map((right): Blocked => ({ what: "right_lacking", right, words: `${WORDS.lacks} ${right}`, address: work.form }));

  return { ok: true, rows: work.rows, blocked, confirm, ready: !work.rows.some((row) => UNDONE.has(row.state)) };
}

/**
 * Remove an install, or with a dry run list what a run would remove.
 *
 * @param where - the place the person named: its kind says which objects point at the Worker, and an install that is set must answer there
 * @param form - the address of the token's form, where a permission is added
 * @param say - told each row as it is settled
 * @returns the rows in the order removed and what to type to confirm; or why nothing was removed: no answer, an install of another place, a run whose `confirmed` is not this install's, or a Worker that came, went, or changed hands since the look
 */
export async function removeInstall(found: Removable<Place>, where: Where, removal: Removal, form: string, say: (row: RemovalRow) => void): Promise<Removed> {
  const { place } = found;
  const other = otherPlace(found, where);
  if (other !== undefined) return { ok: false, why: "other_place", words: other };

  const confirm = confirmOf(found);
  if (removal.run === "apply" && typedOf(removal.confirmed) !== confirm) return { ok: false, why: "not_confirmed", words: `${WORDS.notConfirmed} ${confirm}. Nothing changed.` };

  const zone = await zoneOf(place, where);
  if (!zone.ok) return { ok: false, why: "unreachable", words: WORDS.unreachable };

  // The Worker is read anew: time passed since the look, and whether one stands and is poplin's decides what may go.
  const bindings = await readWorker(place.connection, { accountId: place.accountId, script: SCRIPT });
  if (!bindings.ok) return { ok: false, why: "unreachable", words: WORDS.unreachable };

  const stood = found.state === "whole" || found.state === "started";
  const stands = bindings.value !== undefined;
  if (stands !== stood || (bindings.value !== undefined && !isOwn(bindings.value))) return { ok: false, why: "changed", words: WORDS.changed };

  const bound = boundTo(bindings.value ?? []);
  const work: Work = { mode: removal.run === "apply" ? "apply" : "plan", place, data: removal.data, kind: where.kind, zoneId: zone.value, form, rows: [], say };
  await removeReach(work);
  await removeAccess(work);
  await removeAlerts(work);
  await removeKeys(work);
  await removeWorkflow(work);
  const workerGone = await removeWorker(work, stands);
  await removeFiles(work, { own: !stands || bound.bucket === INSTALL_OBJECTS.bucket, bound: stands, workerGone });
  await removeDatabase(work, { boundId: bound.databaseId, bound: stands, workerGone });

  if (where.kind === "domain") note(work, { object: "Bot settings", state: "stay", detail: WORDS.bots });

  note(work, { object: "Account token", state: "stay", detail: WORDS.token });

  return done(work, confirm);
}
