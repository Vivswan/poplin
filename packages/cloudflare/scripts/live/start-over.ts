// Take everything poplin made off the test account, on purpose, so that the run which follows makes the install from nothing.
//
//   Worker routes     the routes of the Worker named `poplin`
//   DNS records       the records whose comment starts with poplin's mark
//   Rules             the rule with poplin's ref in the redirect, the custom, and the rate limiting phase
//   Access            the application and the policy with poplin's names
//   Worker            the script named `poplin`, and with it the login and the first settings it was given
//   Database          the database named `poplin`, with every record
//   Bucket objects    every object of the test install's bucket; the bucket itself stays
//   Budget alert      the notification policy with poplin's name
//   Key               every API token of the account with the name of the key an install keeps
//
// A record, a route, a rule, an application, a policy, an alert, or a token without poplin's mark stays. The zone's bot switches are no object: they stay as they are set.
// It runs only on the test account: one that pays for nothing and holds the test install's bucket, a name no install of a person has.
// Each kind is listed and then removed, so a run that stopped half-way is run again, and a second run removes nothing.

import { BasePolicies as BaseAlerts } from "cloudflare/resources/alerting/policies";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { BaseRecords } from "cloudflare/resources/dns/records";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { BaseBuckets } from "cloudflare/resources/r2/buckets/buckets";
import { BaseObjects } from "cloudflare/resources/r2/buckets/objects";
import { BaseRoutes } from "cloudflare/resources/workers/routes";
import { BaseScripts } from "cloudflare/resources/workers/scripts/scripts";
import { BaseApplications } from "cloudflare/resources/zero-trust/access/applications/applications";
import { BasePolicies } from "cloudflare/resources/zero-trust/access/policies";

import { isAccessOff } from "../../src/zone/access/access";
import { BUDGET_ALERT } from "../../src/zone/alerts/budget-alert";
import { type CloudflareResult, callCloudflare } from "../../src/zone/client";
import { syncDatabase } from "../../src/zone/database/database";
import { INSTALL_OBJECTS } from "../../src/zone/install-objects";
import { removeOwnRule, syncPhase } from "../../src/zone/rules/rules";
import { applySteps } from "../../src/zone/sync";
import { readFreePlans } from "./plan";
import { BUCKET, type Found, findInstall, isStop, openRun, type Run, reportStop, SCRIPT, type Stop, stopOf } from "./util";

/** What the variable that asks for a start-over must hold: the workflow's ticked box. */
const ASKED = "true";

/** The status Cloudflare answers for a Worker the account does not hold. */
const NOT_FOUND = 404;

/** The phases poplin keeps a rule in, each with the refs of its rules there. */
const OWN_RULES = [
  { phase: "http_request_dynamic_redirect", refs: [INSTALL_OBJECTS.httpsRef] },
  { phase: "http_request_firewall_custom", refs: [INSTALL_OBJECTS.outsideRef, INSTALL_OBJECTS.botsRef] },
  { phase: "http_ratelimit", refs: [INSTALL_OBJECTS.rateRef] },
] as const;

/** Every kind, in the order removed: what points at the Worker first, then the Worker, then what it kept. */
const KINDS: readonly Kind[] = [
  { name: "Worker routes", remove: removeRoutes, optional: false },
  { name: "DNS records", remove: removeRecords, optional: false },
  { name: "Rules", remove: removeRules, optional: true },
  { name: "Access application and policy", remove: removeAccess, optional: true },
  { name: "Worker", remove: removeWorker, optional: false },
  { name: "Database", remove: removeDatabase, optional: false },
  { name: "Bucket objects", remove: removeObjects, optional: true },
  { name: "Budget alert", remove: removeAlert, optional: true },
  { name: "Key", remove: removeKeys, optional: true },
];

/** The variables a run reads. */
type Environment = Readonly<Record<string, string | undefined>>;

/** What one kind came to: how many of poplin's objects went, and what stopped the rest, if anything did. */
interface Removal {
  readonly removed: number;
  readonly stopped?: Stop;
}

/** One kind of object: its name in the log, how its objects of poplin's are removed, and whether an install is made anew by a token that may not touch the kind. */
interface Kind {
  readonly name: string;
  readonly remove: (run: Run, found: Found) => Promise<Removal>;
  readonly optional: boolean;
}

function stoppedAt(removed: number, stopped: Stop): Removal {
  return { removed, stopped };
}

/**
 * Remove every listed item that is poplin's, one call each, in order.
 *
 * @param permission - the token permission the list and the removals need
 * @returns how many were removed, with why the list or a removal stopped the rest
 */
async function removeOwn<Item>(
  listed: CloudflareResult<Item[]>,
  own: (item: Item) => boolean,
  remove: (item: Item) => Promise<CloudflareResult<unknown>>,
  permission: string,
): Promise<Removal> {
  if (!listed.ok) return stoppedAt(0, stopOf(listed, permission));

  const steps = listed.value.filter(own).map((item, place) => ({ kind: "remove" as const, subject: String(place), item }));
  const done = await applySteps(steps, (step) => remove(step.item), "apply");
  const removed = done.report.removed.length;

  return done.ok ? { removed } : stoppedAt(removed, stopOf(done, permission));
}

async function removeRoutes(run: Run, { zone }: Found): Promise<Removal> {
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseRoutes(api).list({ zone_id: zone.id })));

  return removeOwn(listed, (route) => route.script === SCRIPT, (route) => callCloudflare(run.connection, (api) => new BaseRoutes(api).delete(route.id, { zone_id: zone.id })), "Workers Routes: Edit");
}

async function removeRecords(run: Run, { zone }: Found): Promise<Removal> {
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseRecords(api).list({ zone_id: zone.id })));
  const marked = (comment: string | undefined): boolean => comment?.startsWith(INSTALL_OBJECTS.recordMark) === true;

  return removeOwn(listed, (record) => marked(record.comment), (record) => callCloudflare(run.connection, (api) => new BaseRecords(api).delete(record.id, { zone_id: zone.id })), "DNS: Edit");
}

async function removeRules(run: Run, { zone }: Found): Promise<Removal> {
  let removed = 0;

  for (const { phase, refs } of OWN_RULES) {
    const done = await syncPhase(run.connection, zone.id, phase, (current) => refs.flatMap((ref) => removeOwnRule(ref, ref, current)), "apply");
    removed += done.report.removed.length;
    if (!done.ok) return stoppedAt(removed, stopOf(done, "for the rules of the zone"));
  }

  return { removed };
}

/** The application goes before the policy it holds. An account whose Access is off holds neither. */
async function removeAccess(run: Run): Promise<Removal> {
  const account = { account_id: run.accountId };
  const permission = "Access: Apps and Policies: Edit";
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseApplications(api).list(account)));
  if (!listed.ok && isAccessOff(listed)) return { removed: 0 };

  const applications = await removeOwn(
    listed,
    (application) => application.name === INSTALL_OBJECTS.accessApplication,
    (application) => callCloudflare(run.connection, (api) => new BaseApplications(api).delete(application.id ?? "", account)),
    permission,
  );
  if (applications.stopped !== undefined) return applications;

  const policies = await removeOwn(
    await callCloudflare(run.connection, (api) => Array.fromAsync(new BasePolicies(api).list(account))),
    (policy) => policy.name === INSTALL_OBJECTS.accessPolicy,
    (policy) => callCloudflare(run.connection, (api) => new BasePolicies(api).delete(policy.id ?? "", account)),
    permission,
  );

  return { ...policies, removed: applications.removed + policies.removed };
}

async function removeWorker(run: Run): Promise<Removal> {
  // Asked for as the bare response: an answer with no body is a removal too.
  const removed = await callCloudflare(run.connection, (api) => new BaseScripts(api).delete(SCRIPT, { account_id: run.accountId, force: true }).asResponse());
  if (removed.ok) return { removed: 1 };

  return removed.failure === "refused" && removed.status === NOT_FOUND ? { removed: 0 } : stoppedAt(0, stopOf(removed, "Workers Scripts: Edit"));
}

async function removeDatabase(run: Run): Promise<Removal> {
  const permission = "D1: Edit";
  const found = await syncDatabase(run.connection, run.accountId, "plan");
  if (!found.ok) return stoppedAt(0, found.failure === "no-id" ? { kind: "failed", what: "Cloudflare named no database" } : stopOf(found, permission));

  const { id } = found;
  if (id === undefined) return { removed: 0 };

  const removed = await callCloudflare(run.connection, (api) => new BaseDatabase(api).delete(id, { account_id: run.accountId }));

  return removed.ok ? { removed: 1 } : stoppedAt(0, stopOf(removed, permission));
}

async function removeObjects(run: Run): Promise<Removal> {
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseObjects(api).list(BUCKET, { account_id: run.accountId })));

  return removeOwn(
    listed,
    (object) => object.key !== undefined,
    (object) => callCloudflare(run.connection, (api) => new BaseObjects(api).delete(object.key ?? "", { account_id: run.accountId, bucket_name: BUCKET })),
    "Workers R2 Storage: Edit",
  );
}

async function removeAlert(run: Run): Promise<Removal> {
  const account = { account_id: run.accountId };
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseAlerts(api).list(account)));

  return removeOwn(listed, (policy) => policy.name === BUDGET_ALERT, (policy) => callCloudflare(run.connection, (api) => new BaseAlerts(api).delete(policy.id ?? "", account)), "Notifications: Edit");
}

// Ended keys are listed too: a key of the name that ran out is still an object poplin made.
async function removeKeys(run: Run): Promise<Removal> {
  const account = { account_id: run.accountId };
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseTokens(api).list({ ...account, include_expired: true })));

  return removeOwn(listed, (token) => token.name === INSTALL_OBJECTS.keyName, (token) => callCloudflare(run.connection, (api) => new BaseTokens(api).delete(token.id ?? "", account)), "Account API Tokens: Edit");
}

/**
 * Find the test install, and refuse any account that is not the test account.
 *
 * @returns the install's zone, or why nothing may be removed: an account that pays for something, or one without the test install's bucket
 */
async function findTestInstall(run: Run, env: Environment): Promise<Found | Stop> {
  const found = await findInstall(run, env);
  if (isStop(found)) return found;

  const plans = await readFreePlans(run, found.zone);
  if (isStop(plans) && plans.kind === "failed") return plans;

  const buckets = await callCloudflare(run.connection, (api) => new BaseBuckets(api).list({ account_id: run.accountId, name_contains: BUCKET }));
  if (!buckets.ok) return stopOf(buckets, "Workers R2 Storage: Edit");

  const held = buckets.value.buckets?.some((bucket) => bucket.name === BUCKET) === true;

  return held ? found : { kind: "failed", what: "the account holds no bucket of the test install, so nothing in it is removed" };
}

/** Remove each kind in order, telling how many went; answers what stopped the run, or `undefined` once every kind is gone or told as left. */
async function removeAll(run: Run, env: Environment, rows: string[]): Promise<Stop | undefined> {
  if (env.POPLIN_LIVE_START_OVER !== ASKED) return { kind: "failed", what: "nobody asked for it: POPLIN_LIVE_START_OVER is not true" };

  const found = await findTestInstall(run, env);
  if (isStop(found)) return found;

  for (const kind of KINDS) {
    const { removed, stopped } = await kind.remove(run, found);
    const left = stopped?.kind === "skipped" && kind.optional ? stopped.needs : undefined;
    const result = left === undefined ? `removed ${removed}` : `removed ${removed}, the rest left: needs ${left}`;
    rows.push(`| ${kind.name} | ${result} |`);
    run.say(`${kind.name}: ${result}`);

    if (left !== undefined) run.annotate("warning", `The start-over left the ${kind.name} it could not reach: it needs ${left}.`);

    if (stopped !== undefined && left === undefined) return stopped;
  }

  return undefined;
}

/**
 * Take the test install off its account, and tell the log and the step summary how many of each kind went.
 *
 * @param env - where the asking, the zone's name, and the account are read from: the same variables the run was opened from
 * @returns the exit code: 0 only once every kind is removed, or left, with a warning, for a permission the token lacks
 */
export async function startOver(run: Run, env: Environment): Promise<number> {
  const rows: string[] = [];
  const stopped = await removeAll(run, env, rows);

  run.summarize(["### The test install, started over", "", "| Kind | Result |", "| --- | --- |", ...rows, ""].join("\n"));

  return stopped === undefined ? 0 : reportStop(run, stopped, "The test install was not started over");
}

if (import.meta.main) process.exitCode = await startOver(openRun(), process.env);
