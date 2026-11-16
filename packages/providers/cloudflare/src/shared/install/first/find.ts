// What a token finds of poplin in an account, read before an install makes anything. Every name is fixed, so an install is found by its names and by the marks its own Worker carries.
//
//   1  the account     the one the domain's zone is in, or the one the token shows
//   2  the Worker      `poplin`: none, poplin's own by its bindings, or somebody else's
//   3  the version     of a whole install, from the tag of its latest version
//   4  the database    `poplin`, by its name
//   5  the bucket      `poplin-sites`, by its name; a refusal here says the token lacks the storage right, or that storage is switched off
//   6  Access          whether the login product is switched on, which no API does
//
// The Worker is poplin's when `WORKER_NAME` is its own name and its bucket, database, and Workflow are bound. It is set once `ZONE` reads as an install and `ACCOUNT_ID` is there.
// Nothing here changes anything, and no answer holds a text Cloudflare sent.

import type { Blocked, Found, Question, Reach, Read, Token } from "@poplin/core/src/install/installer";
import { newestPinned } from "@poplin/core/src/records/release";
import { BaseAccounts } from "cloudflare/resources/accounts/accounts";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { BaseVersions } from "cloudflare/resources/workers/scripts/versions";
import * as v from "valibot";
import { projectReleases } from "../../release/deploy/release-source";
import { isAccessOff, readLoginFacts } from "../pieces/access/access";
import { listBuckets, planBucket } from "../pieces/bucket/bucket";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare, findZones } from "../client";
import { planDatabase } from "../pieces/database/database";
import { INSTALL_OBJECTS } from "../install-objects";
import type { DomainLayout } from "../../../with-domain/layout";
import { type ListedBinding, readWorker } from "../pieces/variables/variables";
import { readInstallBinding } from "../kind/zone-binding";

/** The name of the install's Worker. */
const SCRIPT = INSTALL_OBJECTS.worker;

/** The first status that is a failure of Cloudflare's own, which says nothing of the token. */
const SERVER_FAILURE = 500;

/** Cloudflare's dashboard, where a person does what no API does. */
const DASHBOARD = "https://dash.cloudflare.com";

/** The annotation of a version that holds the release it was uploaded from. */
const VERSION_TAG = "workers/tag";

/** A version as Cloudflare lists it, read no further than its annotations. */
const LISTED_VERSION = v.object({ annotations: v.optional(v.record(v.string(), v.unknown())) });

/** What each state is told in. */
const WORDS = {
  token: "Cloudflare refused the token, or the token shows no account.",
  otherAccount: "The token does not show that account.",
  unreachable: "Cloudflare gave no usable answer.",
  held: `A Worker named ${SCRIPT} is in this account and is not poplin's. Rename or delete it, then run this again.`,
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

/** The question of which account, where a token shows several: the answer is the place with that account named. */
function whichAccount(where: Where, shown: readonly Shown[]): Question<Where> {
  const list = shown.map((account, index) => `  ${index + 1}) ${account.name} (${account.id})`).join("\n");

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

/**
 * Tell whether a Worker is poplin's by the marks its bindings carry.
 *
 * @param bindings - every binding of the Worker named `poplin`, as Cloudflare lists them
 */
export function isOwn(bindings: readonly ListedBinding[]): boolean {
  const bound = (name: string, type: string): boolean => bindings.some((binding) => binding.name === name && binding.type === type);
  const named = bindings.some((binding) => binding.name === INSTALL_OBJECTS.workerBinding && binding.type === "plain_text" && binding.text === SCRIPT);

  return named && bound(INSTALL_OBJECTS.bucketBinding, "r2_bucket") && bound(INSTALL_OBJECTS.databaseBinding, "d1") && bound(INSTALL_OBJECTS.jobsBinding, "workflow");
}

/** The value of a JSON variable, which Cloudflare lists as text or already read. */
function readJson(json: unknown): unknown {
  if (typeof json !== "string") return json;

  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** Where a set install's dashboard is; `undefined` for a Worker that is not set: one with no place it answers at, or no account. */
function dashboardOf(bindings: readonly ListedBinding[]): string | undefined {
  const zone = bindings.find((binding) => binding.name === INSTALL_OBJECTS.zoneBinding && binding.type === "json");
  const install = readInstallBinding(zone === undefined ? undefined : readJson(zone.json), SCRIPT);
  if (!install.ok || !bindings.some((binding) => binding.name === INSTALL_OBJECTS.accountBinding && binding.type === "plain_text")) return undefined;

  return `https://${install.value.kind === "domain" ? install.value.layout.adminHostname : install.value.layout.adminHost}`;
}

/** The release a Worker runs, from the tag of its latest version; `undefined` where none can be read. */
async function versionOf(place: Place): Promise<string | undefined> {
  const versions = await callCloudflare(place.connection, (api) => new BaseVersions(api).list(SCRIPT, { account_id: place.accountId }));
  const latest = versions.ok ? v.safeParse(LISTED_VERSION, versions.value.result.items?.[0]) : undefined;
  const tag = latest?.success === true ? latest.output.annotations?.[VERSION_TAG] : undefined;

  return typeof tag === "string" ? tag : undefined;
}

/** A whole install: its version, and the newest release the project's website names. */
async function wholeAt(place: Place, address: string, reach: Reach): Promise<FoundHere> {
  const pins = await projectReleases({ fetch: reach.fetch }).pins();

  return { state: "whole", place, version: await versionOf(place), address, newest: pins === undefined ? undefined : newestPinned(pins) };
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
  const words = `There is ${things} in this account, and no poplin runs. It may hold an earlier install's sites and records.`;

  return { state: "leftover", place, notes, words, address: held.database ? pages.database : pages.storage };
}

/** What stands in an account with no install, or an unfinished one: the data of poplin's names, and what stops a run before it changes anything. */
async function standing(place: Place, started: boolean, rights: Rights): Promise<FoundHere> {
  const { connection, accountId } = place;
  const databases = await callCloudflare(connection, (api) => Array.fromAsync(new BaseDatabase(api).list({ account_id: accountId, name: INSTALL_OBJECTS.database })));
  const buckets = await listBuckets(connection, accountId);
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
 * @param rights - how a refusal for a lacking permission is told, and how the permission is named
 * @returns what is there, as one value; a token that is refused or shows no such domain, and an account whose storage is off or whose token lacks a needed permission, are states of their own
 */
export async function findInstall(token: Token, where: Where, reach: Reach, rights: Rights): Promise<Found<Where, Place>> {
  const connection: Connection = { key: token, fetch: reach.fetch };
  const accountId = await accountOf(connection, where);
  if (typeof accountId !== "string") return accountId;

  const place: Place = { connection, accountId, toJSON: () => undefined };
  const bindings = await readWorker(connection, { accountId, script: SCRIPT });
  if (!bindings.ok) return rights.lacks(bindings) ? { state: "blocked", blocked: [rightLacking(rights, "Worker variable", accountId)] } : refusedBy(bindings);

  if (bindings.value === undefined) return standing(place, false, rights);

  if (!isOwn(bindings.value)) return { state: "held", words: WORDS.held, address: pagesOf(accountId).worker };

  const address = dashboardOf(bindings.value);

  return address === undefined ? standing(place, true, rights) : wholeAt(place, address, reach);
}
