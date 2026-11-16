// The plug of an install without a domain: every object of an install on the account's free address read, or made to match, with a token that lives for the one call.
//
//   token -> the account whose free address the install answers under -> the two forwarders, Access, the Worker's own variables and its key, the database
//
// With no zone to show, a token proves itself by the account: the one whose free address is the one in the install's own hostnames. Any other token is refused before anything is read.
// Each piece is the one an install with a domain is made of. No record, route, or rule is read or written: the free address has none of them.

import type { DomainPlug, DomainReading, ReadSettings } from "@poplin/app/src/console/domain/records";
import { parseLogins } from "@poplin/core/src/auth/logins";
import type { BaseCloudflare } from "cloudflare/client";
import { BaseAccounts } from "cloudflare/resources/accounts/accounts";
import { BaseSubdomains } from "cloudflare/resources/workers/subdomains";
import type { AccountAddresses } from "./address-layout";
import { type Connection, callCloudflare } from "./client";
import { syncDatabase } from "./database/database";
import { syncForwarders } from "./forwarders/forwarders";
import type { Mode } from "./sync";
import { accessPiece, firstValues, type Known, keyGiven, type Placed, type Progress, piece, REFUSED, readingOf, TOKEN, tokenFacts, UNREACHABLE, variablesPiece } from "./zone-plug";

/** How many accounts a token of an install with nothing set is looked through for the install's: one call each, inside what one request of a Worker may send. */
const MAX_ACCOUNTS = 10;

/** What the plug is built from. */
type PathParts = Known & {
  /** The name of the install's Worker, which its forwarders hand every request to. */
  readonly script: string;

  /** The install's checked addresses. */
  readonly layout: AccountAddresses;

  /** Where the API is; absent outside tests. */
  readonly baseUrl?: string | undefined;

  /** What sends a call; absent outside tests. */
  readonly fetch?: Connection["fetch"];
};

/** The ids of the first accounts a token shows, from the first page of the list alone: no further page is asked for. */
async function firstAccounts(api: BaseCloudflare): Promise<string[]> {
  const page = await new BaseAccounts(api).list({ per_page: MAX_ACCOUNTS });

  return page.result.slice(0, MAX_ACCOUNTS).map((account) => account.id);
}

/**
 * Find the account the install answers under: the install's own, or for an install with nothing set whichever account the token shows.
 *
 * @returns the id of the account whose free address is the install's; a token that shows no such account is refused, alike whatever it does show
 */
async function findAccount(parts: PathParts, connection: Connection): Promise<string | DomainReading> {
  const shown = parts.accountId === undefined ? await callCloudflare(connection, (api) => firstAccounts(api)) : ({ ok: true, value: [parts.accountId] } as const);
  if (!shown.ok) return shown.failure === "refused" ? REFUSED : UNREACHABLE;

  for (const id of shown.value) {
    const address = await callCloudflare(connection, (api) => new BaseSubdomains(api).get({ account_id: id }));
    if (address.ok && address.value.subdomain === parts.layout.account) return id;

    // An account the token may not read, or one with no free address, is not the install's: the next one is asked.
    if (!address.ok && address.failure !== "refused") return UNREACHABLE;
  }

  return REFUSED;
}

/** Prove a token: one that is malformed, refused, or shows no account whose free address is the install's gets its refusal, and nothing of the install is read with it. */
async function prove(parts: PathParts, token: string): Promise<{ readonly connection: Connection; readonly placed: Placed } | DomainReading> {
  if (!TOKEN.test(token)) return REFUSED;

  const connection: Connection = { key: token, baseUrl: parts.baseUrl, fetch: parts.fetch };
  const accountId = await findAccount(parts, connection);
  if (typeof accountId !== "string") return accountId;

  const { layout } = parts;
  const firsts = firstValues(parts, { account_address: layout.account }, accountId);

  return { connection, placed: { script: parts.script, accountId, zoneId: undefined, key: parts.key, adminHost: layout.adminHost, privateSites: layout.privateHost, firstValues: firsts } };
}

async function read(parts: PathParts, mode: Mode, token: string, readSettings: ReadSettings): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  const { connection, placed } = proven;

  // The token is proven: only now is anything of the install read.
  const settings = await readSettings();
  const parsed = parseLogins(settings.logins);
  const { layout } = parts;
  const answers = { [layout.sitesWorker]: `https://${layout.sitesHost} (unlisted and public sites)`, [layout.privateWorker]: `https://${layout.privateHost} (private sites)` };
  const progress: Progress = { rows: [], steps: [], stopped: false };

  await piece(
    progress,
    mode,
    () => "Forwarder",
    () => syncForwarders(connection, placed.accountId, layout, mode),
  );
  // A forwarder's row names the address its sites answer at.
  progress.rows.splice(0, Number.POSITIVE_INFINITY, ...progress.rows.map((row) => (row.detail in answers ? { ...row, detail: `${row.detail}: ${answers[row.detail]}` } : row)));
  await variablesPiece(progress, mode, placed, connection, await accessPiece(progress, mode, placed, connection, parsed.ok ? parsed.value : undefined));
  await piece(
    progress,
    mode,
    () => "D1 database",
    () => syncDatabase(connection, placed.accountId, mode),
  );

  return readingOf(progress);
}

/**
 * Give an install without a domain a new key, made with a token a person pasted, and nothing else: no other object is read or changed.
 *
 * @param parts - the install; with `key`, a key the install holds is said to be replaced
 * @returns the key's one row, and a step for an older key that is still at Cloudflare; a token that does not prove itself is refused as a check refuses it
 */
export async function givePathKey(parts: Extract<PathParts, { readonly accountId: string }>, token: string): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  return keyGiven(proven.connection, proven.placed, parts.key?.has() === true);
}

/**
 * Build the plug of an install without a domain on Cloudflare.
 *
 * @returns a plug whose `check` sends no change. Both refuse, alike and before reading anything, a token that is malformed, that Cloudflare refuses, or that does not show the install's free address as the one of `accountId`.
 * With no `accountId` the account is the one the token shows that address in. The settings are read only after that
 */
export function createPathPlug(parts: PathParts): DomainPlug {
  return {
    ...tokenFacts("noDomain"),
    check: (token, settings) => read(parts, "plan", token, settings),
    repair: (token, settings) => read(parts, "apply", token, settings),
  };
}
