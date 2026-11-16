// Take everything poplin made off the test account, on purpose, so that the run which follows makes the install from nothing.
//
//   Worker routes     the routes of the Worker named `poplin`                                      an install with a domain alone
//   DNS records       the records whose comment starts with poplin's mark                          an install with a domain alone
//   Rules             the rule with poplin's ref in the redirect, the custom, and the rate limiting phase   an install with a domain alone
//   Forwarders        the two Workers with poplin's tag that hand a request to the one Worker      an install without a domain alone, and before the Worker they are bound to
//   Access            the application and the policy with poplin's names
//   Workflow          the Workflow named after the Worker `poplin` that runs its code, or the code of a Worker that is gone, with every job it ran
//   Worker            the script named `poplin`, and with it the login and the first settings it was given
//   Database          the database named `poplin`, with every record
//   Bucket objects    every object of the test install's bucket; the bucket itself stays
//   Alerts            the notification policies with poplin's names: the budget alert, and the certificate alert of an install with a domain
//   Keys              every API token of the account with the name of one of the two keys an install keeps
//
// A record, a route, a rule, a Worker, an application, a policy, a Workflow, an alert, or a token without poplin's mark stays. The zone's bot switches are no object: they stay as they are set.
// It runs only on the test account: one that pays for nothing and holds the test install's bucket, a name no install of a person has.
// Each kind is listed and then removed, so a run that stopped half-way is run again, and a second run removes nothing.

import { BasePolicies as BaseAlerts } from "cloudflare/resources/alerting/policies";
import { BaseTokens } from "cloudflare/resources/accounts/tokens/tokens";
import { BaseRecords } from "cloudflare/resources/dns/records";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { BaseObjects } from "cloudflare/resources/r2/buckets/objects";
import { BaseRoutes } from "cloudflare/resources/workers/routes";
import { BaseScripts } from "cloudflare/resources/workers/scripts/scripts";
import { BaseWorkflows } from "cloudflare/resources/workflows/workflows";
import { BaseApplications } from "cloudflare/resources/zero-trust/access/applications/applications";
import { BasePolicies } from "cloudflare/resources/zero-trust/access/policies";

import { workflowNameOf } from "../../src/shared/jobs/workflow-name";
import { isAccessOff } from "../../src/shared/install/pieces/access/access";
import type { AccountAddresses } from "../../src/without-domain/address-layout";
import { BUDGET_ALERT } from "../../src/shared/install/pieces/alerts/budget-alert";
import { CERTIFICATE_ALERT } from "../../src/with-domain/pieces/alerts/certificate-alert";
import { type CloudflareResult, callCloudflare, type Zone } from "../../src/shared/install/client";
import { syncDatabase } from "../../src/shared/install/pieces/database/database";
import { removeForwarders } from "../../src/without-domain/pieces/forwarders/forwarders";
import { INSTALL_OBJECTS } from "../../src/shared/install/install-objects";
import { removeOwnRule, syncPhase } from "../../src/with-domain/pieces/rules/rules";
import { applySteps } from "../../src/shared/install/sync";
import { refuseOtherAccount } from "./test-account";
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

/** The names of poplin's two applications, and of the policy each holds. */
const OWN_ACCESS = {
  applications: [INSTALL_OBJECTS.accessApplication, INSTALL_OBJECTS.accessOpenApplication] as readonly string[],
  policies: [INSTALL_OBJECTS.accessPolicy, INSTALL_OBJECTS.accessOpenPolicy] as readonly string[],
};

/** The kinds every install has, in the order removed: the Workflow before the Worker whose code it runs, then what the Worker kept. */
const KEPT_KINDS: readonly Kind[] = [
  { name: "Workflow", remove: removeWorkflow, optional: false },
  { name: "Worker", remove: removeWorker, optional: false },
  { name: "Database", remove: removeDatabase, optional: false },
  { name: "Bucket objects", remove: removeObjects, optional: true },
];

/** The login in front of an install of either kind. */
const ACCESS_KIND: Kind = { name: "Access applications and policies", remove: removeAccess, optional: true };

/** The names of poplin's alerts. Both are the account's, so both are looked for on an install of either kind. */
const OWN_ALERTS: readonly (string | undefined)[] = [BUDGET_ALERT.name, CERTIFICATE_ALERT.name];

/** The alerts of an install of either kind. */
const ALERT_KIND: Kind = { name: "Alerts", remove: removeAlerts, optional: true };

/** The two keys an install of either kind keeps. */
const KEY_KIND: Kind = { name: "Keys", remove: removeKeys, optional: true };

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
  readonly remove: (run: Run) => Promise<Removal>;
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

async function removeRoutes(run: Run, zone: Zone): Promise<Removal> {
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseRoutes(api).list({ zone_id: zone.id })));

  return removeOwn(listed, (route) => route.script === SCRIPT, (route) => callCloudflare(run.connection, (api) => new BaseRoutes(api).delete(route.id, { zone_id: zone.id })), "Workers Routes: Edit");
}

async function removeRecords(run: Run, zone: Zone): Promise<Removal> {
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseRecords(api).list({ zone_id: zone.id })));
  const marked = (comment: string | undefined): boolean => comment?.startsWith(INSTALL_OBJECTS.recordMark) === true;

  return removeOwn(listed, (record) => marked(record.comment), (record) => callCloudflare(run.connection, (api) => new BaseRecords(api).delete(record.id, { zone_id: zone.id })), "DNS: Edit");
}

async function removeRules(run: Run, zone: Zone): Promise<Removal> {
  let removed = 0;

  for (const { phase, refs } of OWN_RULES) {
    const done = await syncPhase(run.connection, zone.id, phase, (current) => refs.flatMap((ref) => removeOwnRule(ref, ref, current)), "apply");
    removed += done.report.removed.length;
    if (!done.ok) return stoppedAt(removed, stopOf(done, "for the rules of the zone"));
  }

  return { removed };
}

/** The forwarders go by the product's own removal: a Worker of a forwarder's name without poplin's tag stays. */
async function removeOwnForwarders(run: Run, layout: AccountAddresses): Promise<Removal> {
  const done = await removeForwarders(run.connection, run.accountId, layout, "apply");
  const removed = done.report.removed.length;

  return done.ok ? { removed } : stoppedAt(removed, stopOf(done, "Workers Scripts: Edit"));
}

/** An application goes before the policy it holds. An account whose Access is off holds none. */
async function removeAccess(run: Run): Promise<Removal> {
  const account = { account_id: run.accountId };
  const permission = "Access: Apps and Policies: Edit";
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseApplications(api).list(account)));
  if (!listed.ok && isAccessOff(listed)) return { removed: 0 };

  const applications = await removeOwn(
    listed,
    (application) => OWN_ACCESS.applications.includes(application.name ?? ""),
    (application) => callCloudflare(run.connection, (api) => new BaseApplications(api).delete(application.id ?? "", account)),
    permission,
  );
  if (applications.stopped !== undefined) return applications;

  const policies = await removeOwn(
    await callCloudflare(run.connection, (api) => Array.fromAsync(new BasePolicies(api).list(account))),
    (policy) => OWN_ACCESS.policies.includes(policy.name ?? ""),
    (policy) => callCloudflare(run.connection, (api) => new BasePolicies(api).delete(policy.id ?? "", account)),
    permission,
  );

  return { ...policies, removed: applications.removed + policies.removed };
}

// Cloudflare keeps a Workflow whose Worker was deleted, so it goes by its own call, before the Worker it runs.
async function removeWorkflow(run: Run): Promise<Removal> {
  const account = { account_id: run.accountId };
  const name = workflowNameOf(SCRIPT);
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseWorkflows(api).list({ ...account, search: name })));

  // A Workflow of the name that runs another Worker's code is that Worker's: the repair leaves it too.
  const own = (workflow: { readonly name: string; readonly script_name: string; readonly script_deleted?: boolean }): boolean => workflow.name === name && (workflow.script_name === SCRIPT || workflow.script_deleted === true);

  return removeOwn(listed, own, () => callCloudflare(run.connection, (api) => new BaseWorkflows(api).delete(name, account)), "Workers Scripts: Edit");
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

async function removeAlerts(run: Run): Promise<Removal> {
  const account = { account_id: run.accountId };
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseAlerts(api).list(account)));

  return removeOwn(listed, (policy) => OWN_ALERTS.includes(policy.name), (policy) => callCloudflare(run.connection, (api) => new BaseAlerts(api).delete(policy.id ?? "", account)), "Notifications: Edit");
}

// Ended keys are listed too: a key of the name that ran out is still an object poplin made.
async function removeKeys(run: Run): Promise<Removal> {
  const account = { account_id: run.accountId };
  const listed = await callCloudflare(run.connection, (api) => Array.fromAsync(new BaseTokens(api).list({ ...account, include_expired: true })));

  const names: readonly (string | undefined)[] = [INSTALL_OBJECTS.keyName, INSTALL_OBJECTS.uploadKeyName];

  return removeOwn(listed, (token) => names.includes(token.name), (token) => callCloudflare(run.connection, (api) => new BaseTokens(api).delete(token.id ?? "", account)), "Account API Tokens: Edit");
}

/**
 * Every kind of the install's own, in the order removed: what points at the Worker first, then the Worker, then what it kept.
 *
 * @returns for an install without a domain, the forwarders before the Worker they are bound to, and no kind of a zone
 */
function kindsOf(found: Found): readonly Kind[] {
  if (found.kind === "account address") {
    const { layout } = found;

    return [{ name: "Forwarders", remove: (run) => removeOwnForwarders(run, layout), optional: false }, ACCESS_KIND, ...KEPT_KINDS, ALERT_KIND, KEY_KIND];
  }

  const { zone } = found;

  return [
    { name: "Worker routes", remove: (run) => removeRoutes(run, zone), optional: false },
    { name: "DNS records", remove: (run) => removeRecords(run, zone), optional: false },
    { name: "Rules", remove: (run) => removeRules(run, zone), optional: true },
    ACCESS_KIND,
    ...KEPT_KINDS,
    ALERT_KIND,
    KEY_KIND,
  ];
}

/**
 * Find the test install, and refuse any account that is not the test account.
 *
 * @returns where the install answers, or why nothing may be removed: an account that pays for something, or one without the test install's bucket
 */
async function findTestInstall(run: Run, env: Environment): Promise<Found | Stop> {
  const found = await findInstall(run, env);
  if (isStop(found)) return found;

  return (await refuseOtherAccount(run, found.zone)) ?? found;
}

/** Remove each kind in order, telling how many went; answers what stopped the run, or `undefined` once every kind is gone or told as left. */
async function removeAll(run: Run, env: Environment, rows: string[]): Promise<Stop | undefined> {
  if (env.POPLIN_LIVE_START_OVER !== ASKED) return { kind: "failed", what: "nobody asked for it: POPLIN_LIVE_START_OVER is not true" };

  const found = await findTestInstall(run, env);
  if (isStop(found)) return found;

  for (const kind of kindsOf(found)) {
    const { removed, stopped } = await kind.remove(run);
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
