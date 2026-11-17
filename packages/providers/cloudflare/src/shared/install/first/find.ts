// What a token finds of poplin in an account, read before an install makes anything. Every name is fixed, so an install is found by its names and by the marks its own Worker carries.
//
//   1  the account     the one the domain's zone is in, or the one the token shows
//   2  the Worker      `poplin`: none, poplin's own by its bindings, an install's that lost a binding, or somebody else's
//                      one that is not set yet says where it was started for, and a place of another kind, or under another domain, is refused
//   3  the version     of a whole install, from the binding every upload states: no call of its own
//   4  the database    `poplin`, by its name
//   5  the bucket      `poplin-sites`, by its name; a refusal here says the token lacks the storage right, or that storage is switched off
//                      a repair's look reads none: a repair makes no bucket, so its token is asked for no storage permission
//   6  Access          whether the login product is switched on, which no API does
//
// The Worker is poplin's when `WORKER_NAME` is its own name and its bucket, database, and Workflow are bound. It is set once `ZONE` reads as an install and `ACCOUNT_ID` is there.
// Until then it also carries `INSTALL_PLACE`, which its first upload states: without it nothing says which kind of install the run that made it was.
// For about a second after an upload, Cloudflare's settings can list a Worker without the bindings its new version holds. So a Worker that reads as not poplin's is read again, by the one settled read every piece uses, before it is told as held.
// Its sentence names the wait first: where the settings trail longer, the Worker is poplin's own, and the same command goes on a minute later.
// Nothing here changes anything. Of the texts the account holds, an answer tells three, each read first: the place as a domain, the version as a released one, and an account's name on one line.

import type { Blocked, Found, Question, Reach, Read, Token } from "@poplin/core/src/install/installer";
import { newestPinned } from "@poplin/core/src/records/release";
import { BaseAccounts } from "cloudflare/resources/accounts/accounts";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { projectReleases } from "../../release/publish/release-source";
import { readRelease } from "../../release/update/release-mark";
import { isAccessOff, readLoginFacts } from "../pieces/access/access";
import { listBuckets, planBucket } from "../pieces/bucket/bucket";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare, findZones } from "../client";
import { planDatabase } from "../pieces/database/database";
import { INSTALL_OBJECTS } from "../install-objects";
import { workflowNameOf } from "../../jobs/workflow-name";
import type { DomainLayout } from "../../../with-domain/layout";
import { type ListedBinding, readSettled } from "../pieces/variables/variables";
import { readStartedPlace } from "../kind/started-place";
import { type BoundInstall, readInstallBinding } from "../kind/zone-binding";

/** The name of the install's Worker. */
const SCRIPT = INSTALL_OBJECTS.worker;

/** The first status that is a failure of Cloudflare's own, which says nothing of the token. */
const SERVER_FAILURE = 500;

/** Cloudflare's dashboard, where a person does what no API does. */
const DASHBOARD = "https://dash.cloudflare.com";

/** The buckets of an account as a look that reads none has them: no bucket of poplin's name is told. */
const NO_BUCKETS: Awaited<ReturnType<typeof listBuckets>> = { ok: true, value: [] };

/** What the Worker of an install is bound to beside its name, each as a person is told it. */
const BOUND = [
  { name: INSTALL_OBJECTS.bucketBinding, type: "r2_bucket", told: `${INSTALL_OBJECTS.bucketBinding} (R2 bucket ${INSTALL_OBJECTS.bucket})` },
  { name: INSTALL_OBJECTS.databaseBinding, type: "d1", told: `${INSTALL_OBJECTS.databaseBinding} (D1 database ${INSTALL_OBJECTS.database})` },
  { name: INSTALL_OBJECTS.jobsBinding, type: "workflow", told: `${INSTALL_OBJECTS.jobsBinding} (Workflow ${workflowNameOf(SCRIPT)}, class ${INSTALL_OBJECTS.jobsClass})` },
] as const;

/** What a Worker that is not set carries beside those, as a person is told it. */
const PLACE_TOLD = `${INSTALL_OBJECTS.placeBinding} (plain text: the domain the install was started under, or none)`;

/** The command that takes an install whose Worker has its bindings back, as its sentence names it. */
const HELD_COMMANDS = { install: "npx poplin install cloudflare", repair: "npx poplin doctor --repair" } as const;

/** A list as a sentence says it. */
const LISTED = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** A run of control characters, which no line told to a person holds. */
const CONTROL_RUN = /\p{Cc}+/gu;

/** What each state is told in. */
const WORDS = {
  token: "Cloudflare refused the token, or the token shows no account.",
  otherAccount: "The token does not show that account.",
  unreachable: "Cloudflare gave no usable answer.",
  held: `A Worker named ${SCRIPT} is in this account and does not carry poplin's name, so nothing here touches it. If you just installed or updated poplin, wait a minute and run this again. Else give it another name in your browser, then run this again.`,
  storage: "R2 is not switched on for this account, or the token may not use it. Switch R2 on in your browser, and check that the token has Workers R2 Storage: Edit.",
  loginOff: "Access is not switched on for this account. Open Zero Trust and pick a plan (Free works): until then nobody can log in.",
  lacks: "The token lacks a permission. Add this one",
} as const;

/** Where an install goes: under a domain of the person's own, or on the account's free address; `account` is the account a person named, where the token shows more than one. */
export type Where = { readonly kind: "domain"; readonly layout: DomainLayout; readonly account: string | undefined } | { readonly kind: "no-domain"; readonly account: string | undefined };

/** What a token showed: the way to Cloudflare with it, and the account the install is in or goes to. It holds the token, so a place written as JSON writes nothing. */
export interface Place {
  readonly connection: Connection;
  readonly accountId: string;
  readonly toJSON: () => undefined;
}

/** How a refusal is read, and a permission named, by the table of rights both kinds of install share: the caller hands it over, so this file loads no kind's code. */
interface Rights {
  /** Whether the provider refused a read for a permission the token lacks, and for nothing else. */
  readonly lacks: (failure: CloudflareFailure) => boolean;

  /** The permission a token needs first for one object, as the token form names it. */
  readonly nameOf: (object: "D1 database" | "R2 bucket" | "Access application" | "Worker variable") => string;

  /** Whether the look reads the account's buckets: only where the token it is made with is asked for the storage permission. */
  readonly buckets: boolean;
}

/** What `find` answers. */
type FoundHere = Found<Where, Place>;

/** An account a token shows. */
interface Shown {
  readonly id: string;
  readonly name: string;
}

/** The pages of the dashboard a person is sent to, for one account. */
function pagesOf(accountId: string): { readonly worker: string; readonly database: string; readonly storage: string; readonly login: string; readonly tokens: string } {
  return {
    worker: `${DASHBOARD}/${accountId}/workers/services/view/${SCRIPT}`,
    database: `${DASHBOARD}/${accountId}/workers/d1`,
    storage: `${DASHBOARD}/${accountId}/r2/overview`,
    login: `https://one.dash.cloudflare.com/${accountId}`,
    tokens: `${DASHBOARD}/profile/api-tokens`,
  };
}

/** A read that failed for nothing a person can mend at once: the token refused whole, or no answer. */
function refusedBy(failure: CloudflareFailure): FoundHere {
  const token = failure.failure === "refused" && (failure.status === 401 || failure.status === 403);

  return token ? { state: "refused", why: "token", words: WORDS.token } : { state: "refused", why: "unreachable", words: WORDS.unreachable };
}

/** The block of a read the token has no permission for. */
function rightLacking(rights: Rights, object: Parameters<Rights["nameOf"]>[0], accountId: string): Blocked {
  const right = rights.nameOf(object);

  return { what: "right_lacking", right, words: `${object}: ${WORDS.lacks}: ${right}`, address: pagesOf(accountId).tokens };
}

/** Take an account a person named by its id, or by its number in the list they were shown. */
function chosen(text: string, shown: readonly Shown[]): string | undefined {
  const typed = text.trim();
  const numbered = /^[1-9]\d*$/.test(typed) ? shown[Number(typed) - 1]?.id : undefined;

  return numbered ?? shown.find((account) => account.id === typed)?.id;
}

/** An account's name as one line of a list: each run of control characters is one space, so a name adds no line and no escape sequence to what a person is asked. */
function oneLine(name: string): string {
  return name.replace(CONTROL_RUN, " ").trim();
}

/** The question of which account, where a token shows several: the answer is the place with that account named. */
function whichAccount(where: Where, shown: readonly Shown[]): Question<Where> {
  const list = shown.map((account, index) => `  ${index + 1}) ${oneLine(account.name)} (${account.id})`).join("\n");

  return {
    key: "account",
    name: "the account",
    ask: `The token shows more than one account:\n${list}\nWhich one?`,
    give: "Give --account <id> (or POPLIN_ACCOUNT).",
    answer: (text): Read<Where> => {
      const account = chosen(text, shown);

      return account === undefined ? { ok: false, why: "refused", refused: "that is none of the accounts the token shows" } : { ok: true, where: { ...where, account } };
    },
  };
}

/** The accounts an install could go to: the ones the domain is an active zone in, or the ones the token shows. */
async function accountsOf(connection: Connection, where: Where): Promise<CloudflareResult<Shown[]>> {
  if (where.kind === "domain") {
    const zones = await findZones(connection, where.layout.domain);

    return zones.ok ? { ok: true, value: zones.value.map((zone) => ({ id: zone.accountId, name: zone.name })) } : zones;
  }

  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseAccounts(api).list()));

  return listed.ok ? { ok: true, value: listed.value.map((account) => ({ id: account.id, name: account.name })) } : listed;
}

/** Settle on the one account: the one named, the only one shown, or a question. */
async function accountOf(connection: Connection, where: Where): Promise<string | FoundHere> {
  const shown = await accountsOf(connection, where);
  if (!shown.ok) return refusedBy(shown);

  const named = where.account === undefined ? shown.value : shown.value.filter((account) => account.id === where.account);
  const [only] = named;
  if (only !== undefined && named.length === 1) return only.id;

  if (named.length > 1) return { state: "choice", question: whichAccount(where, named) };

  if (where.account !== undefined && shown.value.length > 0) return { state: "refused", why: "token", words: WORDS.otherAccount };

  if (where.kind !== "domain") return { state: "refused", why: "token", words: WORDS.token };

  return { state: "refused", why: "no_domain", words: `The token shows no active domain ${where.layout.domain}. Add the domain to the account, or choose it under Zone Resources on the token's form.` };
}

/** Whether a Worker says it is poplin's: its `WORKER_NAME` is the install's own name. */
function isNamed(bindings: readonly ListedBinding[]): boolean {
  return bindings.some((binding) => binding.name === INSTALL_OBJECTS.workerBinding && binding.type === "plain_text" && binding.text === SCRIPT);
}

/** What a Worker lacks of the things an install's Worker is bound to, each as a person is told it: the three every one has, and where it was started for on one that is not set. */
function lackedBy(bindings: readonly ListedBinding[]): string[] {
  const lacked = BOUND.filter((mark) => !bindings.some((binding) => binding.name === mark.name && binding.type === mark.type)).map((mark) => mark.told);
  const unplaced = boundInstall(bindings) === undefined && readStartedPlace(bindings) === undefined;

  return unplaced ? [...lacked, PLACE_TOLD] : lacked;
}

/**
 * Tell whether a Worker is poplin's by the marks its bindings carry.
 *
 * @param bindings - every binding of the Worker named `poplin`, as Cloudflare lists them
 */
export function isOwn(bindings: readonly ListedBinding[]): boolean {
  return isNamed(bindings) && lackedBy(bindings).length === 0;
}

/**
 * The option that names a place again, as a command line gives it.
 *
 * @param where - the place, as a person named it or as a run settled it
 * @returns each word of it: `--no-domain`, or `--domain` and the domain
 */
export function placeWords(where: { readonly kind: "domain"; readonly layout: Pick<DomainLayout, "domain"> } | { readonly kind: "no-domain" }): readonly string[] {
  return where.kind === "domain" ? ["--domain", where.layout.domain] : ["--no-domain"];
}

/**
 * Why a Worker of the name that is not poplin's own stops a run: a stranger, or an install that lost a binding, which is told with what it lacks and the command that takes it once that is back. Neither is told to be deleted.
 *
 * @param where - the place a person named, which the command the sentence names carries
 */
function heldBy(bindings: readonly ListedBinding[], where: Where): Pick<Extract<FoundHere, { readonly state: "held" }>, "words" | "after"> {
  if (!isNamed(bindings)) return { words: WORDS.held, after: "again" };

  const lacked = lackedBy(bindings);
  const back = lacked.length === 1 ? "the binding" : "the bindings";
  // With its bindings back, a Worker that is set is found whole, which a repair takes; one that is not set is found started, which an install goes on from.
  const after = boundInstall(bindings) === undefined ? "install" : "repair";
  const words =
    `A Worker named ${SCRIPT} is in this account. It carries poplin's name and lacks ${LISTED.format(lacked)}: it looks like an install that was deployed again by hand. ` +
    `Keep it: it may hold the install's keys. Put ${back} back on the Worker's Bindings page in your browser, then run ${[HELD_COMMANDS[after], ...placeWords(where)].join(" ")}.`;

  return { words, after };
}

/**
 * Read a JSON variable of a Worker, which Cloudflare lists as text or already read.
 *
 * @returns its value; `undefined` for a Worker with no such variable, and for text that is no JSON
 */
export function jsonOf(bindings: readonly ListedBinding[], name: string): unknown {
  const json = bindings.find((binding) => binding.name === name && binding.type === "json")?.json;
  if (typeof json !== "string") return json;

  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Read which install a Worker's bindings name.
 *
 * @returns its kind with its layout; `undefined` for a Worker that is not set: one with no place it answers at, or no account
 */
export function boundInstall(bindings: readonly ListedBinding[]): BoundInstall | undefined {
  const install = readInstallBinding(jsonOf(bindings, INSTALL_OBJECTS.zoneBinding), SCRIPT);
  if (!install.ok || !bindings.some((binding) => binding.name === INSTALL_OBJECTS.accountBinding && binding.type === "plain_text")) return undefined;

  return install.value;
}

/** Where a set install's dashboard is; `undefined` for a Worker that is not set. */
function dashboardOf(bindings: readonly ListedBinding[]): string | undefined {
  const install = boundInstall(bindings);
  if (install === undefined) return undefined;

  return `https://${install.kind === "domain" ? install.layout.adminHostname : install.layout.adminHost}`;
}

/** Say that an install that was started and not finished was started for another place than the one a person named, with the option that names its own; `undefined` where the two are one. */
function startedElsewhere(bindings: readonly ListedBinding[], where: Where): Pick<Extract<FoundHere, { readonly why: "other_place" }>, "words" | "give"> | undefined {
  const started = readStartedPlace(bindings);
  if (started === undefined) return undefined;

  if (started.kind === "no-domain") {
    const give = "--no-domain";

    return where.kind === "domain" ? { words: `An install was started in this account without a domain, and not finished: give ${give}.`, give } : undefined;
  }

  const named = where.kind === "domain" && where.layout.domain === started.domain;
  const give = `--domain ${started.domain}`;

  return named ? undefined : { words: `An install was started in this account under the domain ${started.domain}, and not finished: give ${give}.`, give };
}

/** A whole install: the release its bindings state, and the newest release the project's website names. */
async function wholeAt(place: Place, set: { readonly address: string; readonly version: string | undefined }, reach: Reach): Promise<FoundHere> {
  const pins = await projectReleases({ fetch: reach.fetch }).pins();

  return { state: "whole", place, ...set, newest: pins === undefined ? undefined : newestPinned(pins) };
}

/** What stops a run before it changes anything, from the three reads Cloudflare refused or answered. Access that is switched off is no block: a run goes on without it. */
function blocksOf(reads: { readonly databases: CloudflareResult<unknown>; readonly buckets: CloudflareResult<unknown>; readonly login: CloudflareResult<unknown> }, accountId: string, rights: Rights): Blocked[] {
  const blocked: Blocked[] = [];
  if (!reads.databases.ok) blocked.push(rightLacking(rights, "D1 database", accountId));

  // Storage that is switched off and a token without the right are both a refusal: only the one that carries the permission's own code is surely the token's.
  if (!reads.buckets.ok) blocked.push(rights.lacks(reads.buckets) ? rightLacking(rights, "R2 bucket", accountId) : { what: "storage_off", words: WORDS.storage, address: pagesOf(accountId).storage });

  if (!reads.login.ok && !isAccessOff(reads.login)) blocked.push(rightLacking(rights, "Access application", accountId));

  return blocked;
}

/** An account with no Worker of poplin's: nothing there, or data of poplin's names that an earlier install may have left. */
function withoutWorker(place: Place, notes: readonly Blocked[], held: { readonly database: boolean; readonly bucket: boolean }): FoundHere {
  if (!held.database && !held.bucket) return { state: "none", place, notes };

  const pages = pagesOf(place.accountId);
  const things = [...(held.database ? [`a database named ${INSTALL_OBJECTS.database}`] : []), ...(held.bucket ? [`a bucket named ${INSTALL_OBJECTS.bucket}`] : [])].join(" and ");
  const both = held.database && held.bucket;
  const words = `There is ${things} in this account, and no poplin runs. ${both ? "They" : "It"} may hold an earlier install's sites and records. ${both ? "They are matched by their names alone." : "It is matched by its name alone."}`;

  return { state: "leftover", place, notes, words, address: held.database ? pages.database : pages.storage };
}

/** What stands in an account with no install, or an unfinished one: the data of poplin's names, and what stops a run before it changes anything. */
async function standing(place: Place, started: boolean, rights: Rights): Promise<FoundHere> {
  const { connection, accountId } = place;
  const databases = await callCloudflare(connection, (api) => Array.fromAsync(new BaseDatabase(api).list({ account_id: accountId, name: INSTALL_OBJECTS.database })));
  const buckets = rights.buckets ? await listBuckets(connection, accountId) : NO_BUCKETS;
  const login = await readLoginFacts(connection, accountId);
  const unanswered = [databases, buckets, login].flatMap((read) => (!read.ok && (read.failure !== "refused" || read.status >= SERVER_FAILURE) ? [read] : []))[0];
  if (unanswered !== undefined) return refusedBy(unanswered);

  const blocked = blocksOf({ databases, buckets, login }, accountId, rights);
  if (blocked.length > 0 || !databases.ok || !buckets.ok) return { state: "blocked", blocked };

  const notes: Blocked[] = login.ok ? [] : [{ what: "login_off", words: WORDS.loginOff, address: pagesOf(accountId).login }];
  if (started) return { state: "started", place, notes };

  const database = planDatabase(databases.value).some((step) => step.kind === "leave");
  const bucket = planBucket(buckets.value).some((step) => step.kind === "leave");

  return withoutWorker(place, notes, { database, bucket });
}

/**
 * Look for an install with a token. It only reads.
 *
 * @param where - the place a person chose: its domain says which account, and its `account` picks one where the token shows several
 * @param rights - how a refusal for a lacking permission is told, how the permission is named, and whether the token is one that may read the buckets
 * @returns what is there, as one value; a token that is refused or shows no such domain, an install that was started for another place, and an account whose storage is off or whose token lacks a needed permission, are states of their own
 */
export async function findInstall(token: Token, where: Where, reach: Reach, rights: Rights): Promise<Found<Where, Place>> {
  const connection: Connection = { key: token, fetch: reach.fetch, sleep: reach.sleep };
  const accountId = await accountOf(connection, where);
  if (typeof accountId !== "string") return accountId;

  const place: Place = { connection, accountId, toJSON: () => undefined };
  const bindings = await readSettled(connection, { accountId, script: SCRIPT }, isOwn);
  if (!bindings.ok) return rights.lacks(bindings) ? { state: "blocked", blocked: [rightLacking(rights, "Worker variable", accountId)] } : refusedBy(bindings);

  if (bindings.value === undefined) return standing(place, false, rights);

  if (!isOwn(bindings.value)) return { state: "held", ...heldBy(bindings.value, where), address: pagesOf(accountId).worker };

  const address = dashboardOf(bindings.value);
  if (address !== undefined) return wholeAt(place, { address, version: readRelease(bindings.value) }, reach);

  const other = startedElsewhere(bindings.value, where);

  return other === undefined ? standing(place, true, rights) : { state: "refused", why: "other_place", ...other };
}
