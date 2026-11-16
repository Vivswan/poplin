// The plug of an install without a domain: every object of an install on the account's free address read, or made to match, with a token that lives for the one call.
//
//   token -> the account whose free address the install answers under -> the two forwarders, Access, the Worker's own variables and its keys, the database, the budget alert, the Workflow
//
// With no zone to show, a token proves itself by the account: the one whose free address is the one in the install's own hostnames. Any other token is refused before anything is read.
// Each piece is the one an install with a domain is made of. No record, route, or rule is read or written: the free address has none of them.
// So no setting is carried by a repair, and the one whose whole effect is at a zone, `block_bots`, is said to do nothing here.
// An install that holds its key checks by itself, with no token: the same pieces are read with the key, in the account the Worker runs in.

import type { DomainPlug, DomainReading, ReadSettings } from "@poplin/app/src/console/domain/records";
import { parseLogins } from "@poplin/core/src/auth/logins";
import { BaseSubdomains } from "cloudflare/resources/workers/subdomains";
import type { KeptKey } from "../shared/install/key/kept-key";
import type { AccountAddresses } from "./address-layout";
import { type Connection, callCloudflare } from "../shared/install/client";
import { syncForwarders } from "./pieces/forwarders/forwarders";
import { syncJobs } from "../shared/install/pieces/jobs/jobs";
import type { Mode } from "../shared/install/sync";
import { accessPiece, alertPiece, databasePiece, firstValues, type Known, keyGiven, type Placed, type Progress, piece, REFUSED, readingOf, TOKEN, tokenFacts, UNREACHABLE, variablesPiece } from "../with-domain/zone-plug";

/** What the Domain screen says first on an install of this kind. */
const NO_DOMAIN = "No domain: your sites answer at Cloudflare's free address.";

/** What the control of a setting says whose whole effect is a rule or a switch of a zone. */
const NEEDS_DOMAIN = "Needs a domain.";

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

  /** The clock a new upload key's moment of making is read from, in milliseconds since the epoch; absent outside tests. */
  readonly now?: (() => number) | undefined;
};

/**
 * Prove that the account is the one the install answers under: the install's own, or for an install with nothing set the one the token was found in.
 *
 * @returns the account's id where its free address is the install's; a token that may not read it, and an account with another free address or none, are refused alike
 */
async function findAccount(parts: PathParts, connection: Connection): Promise<string | DomainReading> {
  const known = parts.first === undefined ? parts.accountId : parts.first.accountId;
  const address = await callCloudflare(connection, (api) => new BaseSubdomains(api).get({ account_id: known }));
  if (address.ok && address.value.subdomain === parts.layout.account) return known;

  return address.ok || address.failure === "refused" ? REFUSED : UNREACHABLE;
}

/** Prove a token: one that is malformed, refused, or shows no account whose free address is the install's gets its refusal, and nothing of the install is read with it. */
async function prove(parts: PathParts, token: string): Promise<{ readonly connection: Connection; readonly placed: Placed } | DomainReading> {
  if (!TOKEN.test(token)) return REFUSED;

  const connection: Connection = { key: token, baseUrl: parts.baseUrl, fetch: parts.fetch };
  const accountId = await findAccount(parts, connection);
  if (typeof accountId !== "string") return accountId;

  return { connection, placed: placedIn(parts, accountId) };
}

/** The install in the account it answers under. */
function placedIn(parts: PathParts, accountId: string): Placed {
  const { layout } = parts;
  const firsts = firstValues(parts, { account_address: layout.account }, accountId);

  return { script: parts.script, accountId, zoneId: undefined, key: parts.key, uploadKeyId: parts.uploadKeyId, now: parts.now, adminHost: layout.adminHost, privateSites: layout.privateHost, firstValues: firsts };
}

/**
 * Word a forwarder's row: one that stands, or was made, names the address its sites answer at.
 * One left out because another Worker holds its name has failed: the install needs both forwarders, and its sites reach that other Worker until it is renamed or deleted.
 */
function forwarderRow(row: Progress["rows"][number], answers: Readonly<Record<string, string>>): Progress["rows"][number] {
  if (row.detail in answers) return { ...row, detail: `${row.detail}: ${answers[row.detail]}` };

  return row.state === "left-out" ? { ...row, state: "failed" } : row;
}

/** Read every piece of the install, or make each match. The settings are read here and no earlier: a token has proven itself by now. */
async function readPieces(parts: PathParts, mode: Mode, found: { readonly connection: Connection; readonly placed: Placed }, progress: Progress, readSettings: ReadSettings): Promise<DomainReading> {
  const { connection, placed } = found;
  const settings = await readSettings();
  const parsed = parseLogins(settings.logins);
  const logins = parsed.ok ? parsed.value : undefined;
  const { layout } = parts;
  const answers = { [layout.sitesWorker]: `https://${layout.sitesHost} (unlisted and public sites)`, [layout.privateWorker]: `https://${layout.privateHost} (private sites)` };

  await piece(
    progress,
    mode,
    () => "Forwarder",
    () => syncForwarders(connection, placed.accountId, layout, mode),
  );
  progress.rows.splice(0, Number.POSITIVE_INFINITY, ...progress.rows.map((row) => forwarderRow(row, answers)));
  await variablesPiece(progress, mode, placed, connection, await accessPiece(progress, mode, placed, connection, logins));
  await databasePiece(progress, mode, placed, connection);
  await alertPiece(progress, mode, placed, connection, logins);
  // The Workflow comes last, as on an install with a domain: nothing else of the install waits for it.
  await piece(
    progress,
    mode,
    () => "Workflow",
    () => syncJobs(connection, placed, mode),
  );

  return readingOf(progress);
}

async function read(parts: PathParts, mode: Mode, token: string, readSettings: ReadSettings): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  return readPieces(parts, mode, proven, { rows: [], steps: [], stopped: false }, readSettings);
}

/** Check an install with the key it holds, in the account its Worker runs in: no token is proven, so no account is looked for. */
function readOwn(parts: PathParts, accountId: string, kept: KeptKey, readSettings: ReadSettings): Promise<DomainReading> {
  return readPieces(parts, "plan", { connection: kept.connection, placed: placedIn(parts, accountId) }, { rows: [], steps: [], stopped: false, own: { kept } }, readSettings);
}

/**
 * Give an install without a domain new keys, both made with a token a person pasted, and nothing else: no other object is changed.
 *
 * @param parts - the install; with `key` or `uploadKeyId`, a key the install holds is said to be replaced
 * @returns a row a key, and a step for an older key that is still at Cloudflare; a token that does not prove itself is refused as a check refuses it
 */
export async function givePathKey(parts: Extract<PathParts, { readonly accountId: string }>, token: string): Promise<DomainReading> {
  const proven = await prove(parts, token);
  if ("ok" in proven) return proven;

  return keyGiven(proven.connection, proven.placed, { kept: parts.key?.has() === true, upload: parts.uploadKeyId !== undefined });
}

/**
 * Build the plug of an install without a domain on Cloudflare.
 *
 * @returns a plug whose `check` sends no change. Both refuse, alike and before reading anything, a token that is malformed, that Cloudflare refuses, or that does not show the install's free address as the one of `accountId`.
 * With no `accountId` the account is the one `first` names. The settings are read only after that.
 * With `kept` the plug has `ownCheck`, which reads the same pieces with that key and no token
 */
export function createPathPlug(parts: PathParts): DomainPlug {
  const { accountId, kept } = parts;

  return {
    ...tokenFacts("noDomain"),
    words: { thing: "the install", line: NO_DOMAIN },
    carriedSettings: [],
    idleSettings: { block_bots: NEEDS_DOMAIN },
    check: (token, settings) => read(parts, "plan", token, settings),
    repair: (token, settings) => read(parts, "apply", token, settings),
    ...(accountId === undefined || kept === undefined ? {} : { ownCheck: (settings: ReadSettings) => readOwn(parts, accountId, kept, settings) }),
  };
}
