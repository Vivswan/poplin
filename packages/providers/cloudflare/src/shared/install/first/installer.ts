// `poplin install cloudflare`: an install made with an account token, from a terminal, in one run.
//
//   the subdomain    the account's own name at workers.dev, read first: left, or made in an account that has none, under the name a person gives
//   the release      releases.json at the project's website, then the release's files, each digest checked
//   the bucket       made, or left
//   the database     made, or left
//   the Worker       the first upload of the release's files, with every binding stated, and where the install is started for; then its sweep trigger and its free address
//   the rest         the repair of the install's kind, with the first login: records and routes or forwarders, the login, the variables and the keys, the rules, the Workflow
//
// An install is the first update: the upload is the self-update's own, and everything after it is the repair the dashboard's Domain screen runs.
// A dry run reads the same things and sends no change, so its rows are the rows of the run after it: the same objects, in the same order.
// Every piece reads before it writes, so a run that stopped is run again and goes on from what stands.
// This file asks nothing and prints nothing: the command asks the questions it declares, and words the rows it answers.
// A run on an account with no subdomain that was given no name for one makes nothing, and answers the question for it.

import type { Login } from "@poplin/core/src/auth/logins";
import type { Blocked, Given, Installed, Installer, OptionRow, Question, Reach, Read, Row, Run, Startable, Step, Token, Unanswered } from "@poplin/core/src/install/installer";
import { isAbove } from "@poplin/core/src/records/release";
import { defaultSettings, type SettingValues } from "@poplin/core/src/records/settings";
import { BaseSubdomain } from "cloudflare/resources/workers/scripts/subdomain";
import { homepage } from "../../../../../../cli/package.json";
import { newestRelease, type Release } from "../../release/update/newest-release";
import { putCrons, putFirst, readCrons } from "../../release/update/upload";
import { type AccountAddresses, parseAccountAddresses } from "../../../without-domain/address-layout";
import { syncBucket } from "../pieces/bucket/bucket";
import { type CloudflareFailure, type CloudflareResult, callCloudflare } from "../client";
import { holderWords, readHolder, syncDatabase } from "../pieces/database/database";
import { makeFreeAddress, readFreeAddress, SUBDOMAIN_ROW } from "../pieces/free-address/free-address";
import { BY_NAME, INSTALL_OBJECTS } from "../install-objects";
import { type DomainLayout, parseDomainLayout } from "../../../with-domain/layout";
import { createPathPlug } from "../../../without-domain/path-plug";
import type { Mode, Synced } from "../sync";
import { commandRows, createDomainPlug, lacksRight, rightFor, TOKEN, tokenFacts, tokenForm } from "../../../with-domain/zone-plug";
import { findInstall, type Place, placeWords, type Where } from "./find";
import { removeInstall } from "../upkeep/remove/remove";
import { placeBinding } from "../kind/started-place";
import { failureWords, LACKS, lackingOf, rowOf, UNDONE } from "./rows";
import { repair } from "../upkeep/repair/repair";
import { NEWEST_POPLIN } from "../upkeep/repair/release";
import { readStored, type Untaken } from "../upkeep/repair/settings";

/** The name of the install's Worker. */
const SCRIPT = INSTALL_OBJECTS.worker;

/** What `POPLIN_DOMAIN` says for an install without a domain. */
const NO_DOMAIN = "none";

/** An account's id, as Cloudflare writes it. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** What the account's free address is called in a question and in a sentence. */
const SUBDOMAIN = "workers.dev subdomain";

/** The provider's own options. */
const OPTIONS: readonly OptionRow[] = [
  { flag: "--domain", value: "<name>", about: "Custom domain, with an Active zone on the account", variable: "POPLIN_DOMAIN" },
  { flag: "--no-domain", value: null, about: "Use the account's workers.dev subdomain", variable: `POPLIN_DOMAIN=${NO_DOMAIN}` },
  { flag: "--account", value: "<id>", about: "Account id, if the token can access several accounts", variable: "POPLIN_ACCOUNT" },
  { flag: "--subdomain", value: "<name>", about: "New workers.dev subdomain, if the account has none", variable: "POPLIN_SUBDOMAIN", work: "install" },
];

/** What a line of the run says, where no row of a piece's own says it. */
const WORDS = {
  both: "--domain and --no-domain are mutually exclusive",
  noName: "--domain requires a domain name, such as example.com",
  account: "--account requires an account id: 32 lowercase hex characters",
  domain: { "bad-domain": "is not a domain name", "domain-too-long": "is too long: a login hostname under it exceeds 63 characters", "bad-public-word": "is not a domain name" },
  noSubdomain: `A ${SUBDOMAIN} needs a name, such as your-name`,
  badSubdomain: `is not a ${SUBDOMAIN}: use at most 36 letters, digits, and hyphens, with no hyphen first or last`,
  asks: { domain: "this account has none; Cloudflare requires one, and no address of the install uses it", "no-domain": "this account has none; every address of the install is under it" },
  taken: "is taken. Choose another name.",
  noRelease: "The project website lists no release. Rerun in a few minutes.",
  badRelease: "The release files failed validation. Nothing was uploaded.",
  newerRelease: "This release requires a newer CLI: npx poplin@latest install",
  noAddress: `This account's ${SUBDOMAIN} is too long for the login hostname: it can have 36 characters at most. Change it under Workers & Pages in the Cloudflare dashboard.`,
  lacks: LACKS,
  refusedLater: "Cloudflare refused the account token before the install finished",
  notUsed: "not reused, but an install needs a database with this name",
  unknown: "version unknown",
  out: "is available: once the install is complete,",
  deploys: "deploys it",
  allowance: "the D1 free daily quota is exhausted",
  unreadUsers: "its schema does not match this CLI, so its users were not read and --user is used",
} as const;

/** What a run answers that could not start its work, or lost Cloudflare on the way. */
const UNREACHABLE: Installed = { ok: false, why: "unreachable", words: "Cloudflare or the project website gave no valid response" };

/** What an install makes that no repair does, so that its token needs the permission for it. */
const MADE_FIRST = ["R2 bucket"] as const;

/** What the token of each kind of work is for, told from a repair's: an install makes the bucket, and a removal takes it away and leaves the bot settings as they are. */
const TOKEN_PIECES = {
  install: { also: MADE_FIRST, without: [] },
  repair: { also: [], without: [] },
  remove: { also: MADE_FIRST, without: ["Bot settings"] },
} as const;

/** The row of the repair that this file settles itself, before the upload. */
const OWN_ROWS: ReadonlySet<string> = new Set(["D1 database"]);

/** How many users of a database a row names before it counts the rest. */
const NAMED_USERS = 5;

/** How the users a row names are joined: `a and b`, `a, b, and 2 more`. */
const USERS = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Where the install answers, with its checked addresses. */
type Target = { readonly kind: "domain"; readonly layout: DomainLayout } | { readonly kind: "no-domain"; readonly layout: AccountAddresses };

/** What a person said of the account, beside where the install goes. */
type Said = Pick<Where, "account" | "subdomain">;

/** The account's subdomain as a run goes on with it: the one the account has, or with `stands` false the one a person gave, which the run makes. */
interface FreeAddress {
  readonly name: string;
  readonly stands: boolean;
}

/** What a run is made from, read before it makes anything. */
interface Ready {
  readonly free: FreeAddress;
  readonly target: Target;
  readonly release: Release;
}

/** What one run gathers. `form` is the address of the token's form, where a permission is added. */
interface Work {
  readonly mode: Mode;
  readonly place: Place;
  readonly form: string;
  readonly rows: Row[];
  readonly steps: Step[];
  readonly blocked: Blocked[];
  readonly say: (row: Row) => void;
}

/** A write that was not sent or not taken: Cloudflare's own failure, a release this code cannot place, or a database Cloudflare gave no id for. */
type NotWritten = Untaken | { readonly ok: false; readonly failure: "needs-hand" | "no-id" };

/** A database that stood before the run: as it was found, what its row says of it, and the settings an earlier install stored in it, which the run mends to; `kept` is `undefined` for one that holds none, or none this code reads. */
interface Stood {
  readonly found: Awaited<ReturnType<typeof syncDatabase>>;
  readonly detail: string;
  readonly kept: SettingValues | undefined;
}

/** Read where an install goes from what a person typed for it: a domain, or the word for none. */
function whereOf(text: string, said: Said): Read<Where> {
  const typed = text.trim().toLowerCase();
  if (typed === "" || typed === NO_DOMAIN) return { ok: true, where: { kind: "no-domain", ...said } };

  const layout = parseDomainLayout({ domain: typed });

  return layout.ok ? { ok: true, where: { kind: "domain", layout: layout.value, ...said } } : { ok: false, why: "refused", refused: `${typed} ${WORDS.domain[layout.refusal]}` };
}

/** The question of where the install answers, for a run that was given neither option. */
function whichPlace(said: Said): Question<Where> {
  return {
    key: "where",
    name: "domain",
    ask: "Custom domain (Enter for workers.dev):",
    give: "pass --domain <name> or --no-domain, or set POPLIN_DOMAIN",
    answer: (text) => whereOf(text, said),
  };
}

/**
 * Read a name a person typed for the account's subdomain, by the rule an install without a domain holds an account's name to.
 *
 * An install under a domain is held to it too: a name a run makes is one either kind can answer under.
 */
function subdomainOf(text: string): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly refused: string } {
  const name = text.trim().toLowerCase();
  if (name === "") return { ok: false, refused: WORDS.noSubdomain };

  const layout = parseAccountAddresses({ account_address: name }, SCRIPT);

  return layout.ok ? { ok: true, name } : { ok: false, refused: `${name} ${WORDS.badSubdomain}` };
}

/** The question of the account's subdomain, for an account that has none and a run that was given no name: its answer is the place with that name. */
function whichSubdomain(where: Where): Question<Where> {
  return {
    key: "subdomain",
    name: `${SUBDOMAIN} (this account has none)`,
    ask: `${SUBDOMAIN} (${WORDS.asks[where.kind]}):`,
    give: "pass --subdomain <name> or set POPLIN_SUBDOMAIN",
    answer: (text) => {
      const named = subdomainOf(text);

      return named.ok ? { ok: true, where: { ...where, subdomain: named.name } } : { ok: false, why: "refused", refused: named.refused };
    },
  };
}

/** Read the name a person gave for the account's subdomain, from its option or its variable; `undefined` where neither gave one. */
function saidSubdomain(given: Given): string | undefined | Extract<Read<Where>, { readonly why: "refused" }> {
  const flag = given.flags.get("subdomain");
  const typed = flag === true ? "" : (flag ?? given.env.POPLIN_SUBDOMAIN ?? "");
  // A variable that is set to nothing is one that was not given. An option with nothing in it is refused.
  if (flag === undefined && typed.trim() === "") return undefined;

  const named = subdomainOf(typed);

  return named.ok ? named.name : { ok: false, why: "refused", refused: named.refused };
}

/** Read the provider's own options and variables, once; an option outranks its variable. */
function read(given: Given): Read<Where> {
  const [domain, none] = [given.flags.get("domain"), given.flags.has("no-domain")];
  if (domain !== undefined && none) return { ok: false, why: "refused", refused: WORDS.both };

  if (domain === true || domain?.trim() === "") return { ok: false, why: "refused", refused: WORDS.noName };

  const account = given.flags.get("account") ?? given.env.POPLIN_ACCOUNT;
  if (account !== undefined && (account === true || !ACCOUNT_ID.test(account))) return { ok: false, why: "refused", refused: WORDS.account };

  const subdomain = saidSubdomain(given);
  if (typeof subdomain === "object") return subdomain;

  // A variable that is set to nothing is one that was not given: only Enter at the question means none.
  const typed = domain ?? (none ? NO_DOMAIN : given.env.POPLIN_DOMAIN);
  const said = { account, subdomain };

  return typed === undefined || typed.trim() === "" ? { ok: false, why: "open", open: [whichPlace(said)] } : whereOf(typed, said);
}

/**
 * What the account token needs for one kind of work, a permission a line, each with when it holds where that is not always: under one kind of install alone, or only to do more.
 *
 * @param pieces - the objects the token is for, told from a repair's: the ones it makes beside those, and the ones of those it is not for
 */
function tokenHelp(pieces: (typeof TOKEN_PIECES)[keyof typeof TOKEN_PIECES]): string[] {
  const [domain, none] = [tokenFacts("domain", pieces.also, pieces.without), tokenFacts("noDomain", pieces.also, pieces.without)];
  const optional = { domain: domain.tokenOptional.map((one) => one.right), none: none.tokenOptional.map((one) => one.right) };
  const line = (right: string, where: { readonly domain: readonly string[]; readonly none: readonly string[] }, more: readonly string[]): string => {
    const marks = [...(where.none.includes(right) ? [] : ["--domain"]), ...(where.domain.includes(right) ? [] : ["--no-domain"]), ...more];

    return marks.length === 0 ? right : `${right} (${marks.join(", ")})`;
  };
  const needed = [...new Set([...none.tokenRights, ...domain.tokenRights])].map((right) => line(right, { domain: domain.tokenRights, none: none.tokenRights }, []));

  return [...needed, ...[...new Set([...optional.none, ...optional.domain])].map((right) => line(right, optional, ["optional"]))];
}

/** Why a call failed, with nothing Cloudflare said but its status and the numbers of its codes. */
function whyOf(failure: NotWritten): string {
  if (failure.failure === "refused" || failure.failure === "rate-limited" || failure.failure === "network") return failureWords(failure);

  if (failure.failure === "allowance") return WORDS.allowance;

  return failure.failure === "needs-hand" ? WORDS.newerRelease : "Cloudflare returned no database id";
}

/** Add a row to the run and tell the command. */
function note(work: Work, row: Row): boolean {
  work.rows.push(row);
  work.say(row);

  return !UNDONE.has(row.state);
}

/** The row of a piece whose call failed: blocked where the token lacks its permission, which the row names. A piece of the Worker's, and the account's subdomain, need the permission the Worker's variables need. */
function failed(work: Work, object: typeof SUBDOMAIN_ROW | "R2 bucket" | "D1 database" | "Worker" | "Cron trigger" | "workers.dev route", detail: string, failure: NotWritten): false {
  const right = rightFor(object === "R2 bucket" || object === "D1 database" ? object : "Worker variable");
  if (lacksRight(failure)) note(work, { object, state: "block", detail: `${detail}: ${WORDS.lacks} ${right}`, right });
  else note(work, { object, state: "fail", detail: `${detail}: ${whyOf(failure)}` });

  return false;
}

/** The row of a piece that a sync of its own settled: made, or left as it is. */
function synced(work: Work, object: "R2 bucket" | "D1 database", detail: string, answer: Synced | Awaited<ReturnType<typeof syncDatabase>>): boolean {
  if (!answer.ok) return failed(work, object, detail, answer);

  return note(work, { object, state: answer.report.changedNothing ? "leave" : "make", detail });
}

/**
 * Settle one piece of the Worker: its code, its cron trigger, or its free address.
 *
 * @param row - `setting` is on a piece that is a switch of the Worker: a run writes it and makes nothing, so its row never says made
 * @param stands - reads whether the piece is as it should be, on a Worker that was there before the run; `undefined` on a Worker the run makes, where the piece is made with it
 * @param write - makes the piece match; never called by a dry run, nor for a piece that stands
 */
async function workerPiece(
  work: Work,
  row: { readonly object: "Worker" | "Cron trigger" | "workers.dev route"; readonly detail: string; readonly setting?: true },
  stands: (() => Promise<CloudflareResult<boolean>>) | undefined,
  write: () => Promise<{ readonly ok: true } | NotWritten>,
): Promise<boolean> {
  const stood = stands === undefined ? undefined : await stands();
  if (stood?.ok === false) return failed(work, row.object, row.detail, stood);

  if (stood?.value === true) return note(work, { object: row.object, detail: row.detail, state: "leave" });

  const written = work.mode === "apply" ? await write() : ({ ok: true } as const);
  if (!written.ok) return failed(work, row.object, row.detail, written);

  return note(work, { object: row.object, detail: row.detail, state: stood === undefined && row.setting !== true ? "make" : "change" });
}

/** Whether two cron lists hold the same crons. */
function sameCrons(one: readonly string[], other: readonly string[]): boolean {
  const [left, right] = [new Set(one), new Set(other)];

  return left.size === right.size && [...left].every((cron) => right.has(cron));
}

/**
 * Read the account's subdomain, which a run of either kind needs before it makes anything.
 *
 * @returns the one the account has, or for an account that has none the one a person gave; with neither, the question for it; or a token that may not read it, as a block
 */
async function freeAddressOf(place: Place, where: Where, form: string): Promise<FreeAddress | Unanswered<Where> | Blocked | CloudflareFailure> {
  const read = await readFreeAddress(place.connection, place.accountId);
  if (!read.ok && lacksRight(read)) {
    const right = rightFor("Worker variable");

    return { what: "right_lacking", right, words: `${SUBDOMAIN_ROW}: ${WORDS.lacks} ${right}`, address: form };
  }

  if (!read.ok) return read;

  if (read.value !== undefined) return { name: read.value, stands: true };

  return where.subdomain === undefined ? { ok: false, why: "answer", question: whichSubdomain(where), refused: undefined } : { name: where.subdomain, stands: false };
}

/** Where the install answers: the domain's own layout, or the three hosts under the account's subdomain. A subdomain the account has that is too long for those hosts is a block. */
function targetOf(where: Where, free: FreeAddress, accountId: string): Target | Blocked {
  if (where.kind === "domain") return { kind: "domain", layout: where.layout };

  const layout = parseAccountAddresses({ account_address: free.name }, SCRIPT);
  if (layout.ok) return { kind: "no-domain", layout: layout.value };

  return { what: "no_address", words: WORDS.noAddress, address: `https://dash.cloudflare.com/${accountId}/workers-and-pages` };
}

/**
 * Settle the account's subdomain, the first piece of a run: left where the account has one, made where it has none.
 *
 * @returns whether the run goes on; a name Cloudflare gives no account makes nothing and tells no row, and is the question for another
 */
async function freeAddressPiece(work: Work, free: FreeAddress, where: Where): Promise<boolean | Unanswered<Where>> {
  const detail = `${free.name}.workers.dev`;
  if (free.stands) return note(work, { object: SUBDOMAIN_ROW, state: "leave", detail });

  const made = work.mode === "apply" ? await makeFreeAddress(work.place.connection, work.place.accountId, free.name) : ({ ok: true } as const);
  if (made.ok) return note(work, { object: SUBDOMAIN_ROW, state: "make", detail });

  if (made.failure === "taken") return { ok: false, why: "answer", question: whichSubdomain(where), refused: `${detail} ${WORDS.taken}` };

  return failed(work, SUBDOMAIN_ROW, detail, made);
}

/** Fetch the newest release the project published, with every digest checked; a release there is none of is the block that says why. */
async function releaseOf(reach: Reach): Promise<Release | Blocked | "unreachable"> {
  const release = await newestRelease(reach);
  if (typeof release !== "string" || release === "unreachable") return release;

  if (release === "no_release") return { what: release, words: WORDS.noRelease, address: homepage };

  return release === "newer_release" ? { what: release, words: WORDS.newerRelease, address: homepage } : { what: release, words: WORDS.badRelease, address: homepage };
}

/**
 * What the row of a Worker that stood before the run says: the release its code states, or that it states none, which the command's last line then says what to do about.
 *
 * A Worker that is behind the release this run would upload is told the repair that takes it there: the newest poplin's, which places the newest release whatever its schema, at the install's place and with the run's own token.
 *
 * @param runs - the release the Worker's own binding states, as the look read it; `undefined` for a Worker that states none
 * @param newest - the release this run would upload
 */
function stoodWorker(runs: string | undefined, newest: string, target: Target): string {
  if (runs === undefined) return `${SCRIPT}, ${WORDS.unknown}`;

  if (!isAbove(newest, runs)) return `${SCRIPT}, runs ${runs}`;

  return `${SCRIPT}, runs ${runs}; ${newest} ${WORDS.out} ${[NEWEST_POPLIN.update, ...placeWords(target)].join(" ")} ${WORDS.deploys}`;
}

/** The Worker's own pieces, in order: its code, its sweep trigger, and whether its free address is switched on. Each stops the ones after it. */
async function workerPieces(work: Work, target: Target, release: Release, made: { readonly standing: boolean; readonly databaseId: string | undefined; readonly logsKept: boolean }): Promise<boolean> {
  const { connection, accountId } = work.place;
  const worker = { accountId, script: SCRIPT };
  const { bundle } = release;
  const wanted = { enabled: target.kind === "no-domain", previews_enabled: false };
  const reads = <Value>(read: () => Promise<CloudflareResult<Value>>, same: (value: Value) => boolean): (() => Promise<CloudflareResult<boolean>>) | undefined => {
    if (!made.standing) return undefined;

    return async () => {
      const answer = await read();

      return answer.ok ? { ok: true, value: same(answer.value) } : answer;
    };
  };

  const uploaded = await workerPiece(
    work,
    { object: "Worker", detail: made.standing ? stoodWorker(work.place.runs, bundle.version, target) : `${SCRIPT}, runs ${bundle.version}` },
    made.standing ? async () => ({ ok: true, value: true }) : undefined,
    async () => {
      if (made.databaseId === undefined) return { ok: false, failure: "no-id" };

      const place = placeBinding(target.kind === "domain" ? { kind: "domain", domain: target.layout.domain } : { kind: "no-domain" });

      return putFirst(connection, worker, bundle, { bindings: [...release.first({ script: SCRIPT, bucket: INSTALL_OBJECTS.bucket, databaseId: made.databaseId }), place], logsKept: made.logsKept });
    },
  );
  if (!uploaded) return false;

  const scheduled = await workerPiece(
    work,
    { object: "Cron trigger", detail: bundle.deploy.crons.join(", ") },
    reads(
      () => readCrons(connection, worker),
      (crons) => sameCrons(crons, bundle.deploy.crons),
    ),
    () => putCrons(connection, worker, bundle.deploy.crons),
  );
  if (!scheduled) return false;

  return workerPiece(
    work,
    { object: "workers.dev route", detail: target.kind === "no-domain" ? `enabled: ${target.layout.adminHost}` : "disabled", setting: true },
    reads(
      () => callCloudflare(connection, (api) => new BaseSubdomain(api).get(SCRIPT, { account_id: accountId })),
      (current) => current.enabled === wanted.enabled && current.previews_enabled === wanted.previews_enabled,
    ),
    () => callCloudflare(connection, (api) => new BaseSubdomain(api).create(SCRIPT, { account_id: accountId, ...wanted })),
  );
}

/**
 * Finish the install with the repair of its kind and its first login: the code the dashboard's Domain screen runs, on a Worker with nothing set.
 *
 * The repair is given the account the token was found in, so it looks for no other.
 * A database that stood before the run and holds an earlier install's settings is what the Worker goes on with: its login is mended to those users, its rules to those settings, and `--user` is not used.
 *
 * @param kept - the settings such a database holds; `undefined` for a database the Worker stores its first settings in
 * @returns whether Cloudflare answered; its rows are added to the run, but the database's, which stands by now
 */
async function finish(work: Work, target: Target, login: Login, kept: SettingValues | undefined, reach: Reach): Promise<boolean> {
  const settings = kept ?? defaultSettings({ installer: login });
  const parts = { script: SCRIPT, first: { login: settings.users[0] ?? login, accountId: work.place.accountId }, fetch: reach.fetch, now: reach.now, sleep: reach.sleep, ride: work.place.connection.ride };
  const plug = target.kind === "domain" ? createDomainPlug({ ...parts, layout: target.layout }) : createPathPlug({ ...parts, layout: target.layout });
  const reading = await (work.mode === "plan" ? plug.check(work.place.connection.key, async () => settings) : plug.repair(work.place.connection.key, async () => settings));
  if (!reading.ok && reading.refusal === "unreachable") return false;

  if (!reading.ok) {
    note(work, { object: "Token", state: "fail", detail: WORDS.refusedLater });

    return true;
  }

  const loginOff = work.blocked.some((block) => block.what === "login_off");
  for (const row of commandRows(reading.rows.filter((entry) => !OWN_ROWS.has(entry.object)))) note(work, rowOf(row, work.mode, loginOff));

  work.steps.push(...reading.steps);

  return true;
}

/** What a run came to, from what it gathered. Each permission a row names as lacking is a block too, once. */
function done(work: Work, known: { readonly release?: string; readonly address?: string; readonly unused?: Login | undefined }): Installed {
  const blocked = [...work.blocked, ...lackingOf(work.rows, work.form)];
  const ready = blocked.length === 0 && !work.rows.some((row) => UNDONE.has(row.state));

  return { ok: true, rows: work.rows, steps: work.steps, blocked, release: known.release, address: known.address, ready, proof: "reads", unused: known.unused };
}

/**
 * Read what a run is made from, before it makes anything: the account's subdomain, where the install answers, and the release.
 *
 * @returns the three; or the run's end with nothing changed: a block of any of them, or the question for a subdomain nobody named
 */
async function prepared(work: Work, where: Where, reach: Reach): Promise<Ready | Installed | Unanswered<Where>> {
  const free = await freeAddressOf(work.place, where, work.form);
  if ("failure" in free && free.failure === "network") return UNREACHABLE;

  // A read Cloudflare answered and refused is a row that failed, as any other piece's: it is no missing answer of Cloudflare's.
  if ("failure" in free) {
    note(work, { object: SUBDOMAIN_ROW, state: "fail", detail: failureWords(free) });

    return done(work, {});
  }

  if ("why" in free) return free;

  if ("what" in free) return done({ ...work, blocked: [...work.blocked, free] }, {});

  const target = targetOf(where, free, work.place.accountId);
  if ("what" in target) return done({ ...work, blocked: [...work.blocked, target] }, {});

  const release = await releaseOf(reach);
  if (release === "unreachable") return UNREACHABLE;

  return "what" in release ? done({ ...work, blocked: [...work.blocked, release] }, {}) : { free, target, release };
}

/** Say that the users a kept database holds were not read, and name the repair that mends the login to them, at the place of the install. */
function unreadUsers(target: Target): string {
  return `${WORDS.unreadUsers}. When the install responds, ${["npx poplin doctor --repair", ...placeWords(target)].join(" ")} syncs the login to its stored users`;
}

/**
 * Find the database of poplin's name that stood before the run, and read what it holds for it.
 *
 * Where a person said to use data that was left behind, no Worker is bound to it, so only its tables say whose it is.
 * One that is poplin's is read for the settings an earlier install stored: the Worker keeps those, and stores its first ones only in a database that holds none.
 *
 * @param adopted - whether the name alone matched the database, which its row then says
 * @returns the database with what its row says of it and the settings it holds; `undefined` where the account has none; or `false` once the row of a database that is not poplin's, or that could not be read, is in the run
 */
async function stoodDatabase(work: Work, adopted: boolean, target: Target): Promise<Stood | undefined | false> {
  const { connection, accountId } = work.place;
  const name = INSTALL_OBJECTS.database;
  const found = await syncDatabase(connection, accountId, "plan");
  if (!found.ok) return failed(work, "D1 database", name, found);

  if (found.id === undefined) return undefined;

  const holder = await readHolder(connection, accountId, found.id);
  if (!holder.ok) return failed(work, "D1 database", name, holder);

  if (holder.value === "other") {
    note(work, { object: "D1 database", state: "block", detail: `${name}: ${holderWords(holder.value)}: ${WORDS.notUsed}` });

    return false;
  }

  const stored = holder.value === "poplin" ? await readStored(connection, { accountId, databaseId: found.id }) : undefined;
  if (stored?.state === "unread") return failed(work, "D1 database", name, stored.failure);

  const said = [...(adopted ? [holderWords(holder.value)] : []), ...(stored?.state === "another" ? [unreadUsers(target)] : [])];

  return { found, detail: said.length === 0 ? name : `${name} (${said.join("; ")})`, kept: stored?.state === "stored" ? stored.settings : undefined };
}

/** The users a database holds, named for a row: the first five, and how many more there are. */
function namedUsers(users: readonly Login[]): string {
  const more = users.length - NAMED_USERS;

  return USERS.format(more > 0 ? [...users.slice(0, NAMED_USERS), `${more} more`] : users);
}

/** The first login a person gave, where the database holds users already and it is none of them; `undefined` where the login is used, or is a user already. */
function unusedLogin(login: Login, kept: SettingValues | undefined): Login | undefined {
  return kept === undefined || kept.users.includes(login) ? undefined : login;
}

/**
 * The row of the first login a person gave, where the database holds users already; `undefined` where it holds none, and the login is used.
 *
 * It names the users the login is mended to, whether the person is one of them or not: the database may be one somebody else left under poplin's name, and they are who logs in from then on.
 * The command says how a person who is none of them is let in: the run's answer names that login as unused.
 */
function keptUsersRow(login: Login, kept: SettingValues | undefined): Row | undefined {
  if (kept === undefined) return undefined;

  const users = kept.users.length === 1 ? "its user" : `its ${kept.users.length} users`;
  const held = `The database already has ${users}, and only they can log in: ${namedUsers(kept.users)}.`;
  if (unusedLogin(login, kept) === undefined) return { object: "First user", state: "leave", detail: `${login}: already a user. ${held}` };

  return { object: "First user", state: "leave-out", detail: `${login}: not used. ${held}` };
}

/**
 * Make what the install's own repair cannot: the account's subdomain, the bucket, the database, and the Worker with its trigger and its address. Each stops the ones after it.
 *
 * @param where - the place of the run, which the question for another subdomain is asked at
 * @returns `false` once a piece stopped the run; the question for a subdomain where the one named is taken; else the settings a database that stood before the run holds, which the install is finished to
 */
async function madeFirst(work: Work, ready: Ready, where: Where, login: Login, stood: { readonly standing: boolean; readonly adopted: boolean }): Promise<false | Unanswered<Where> | { readonly kept: SettingValues | undefined }> {
  const { connection, accountId } = work.place;
  const { standing } = stood;
  const { free, target, release } = ready;
  // A database that is somebody else's stops the run before anything is made beside it. One this run makes holds nothing to read.
  const left = stood.adopted || standing ? await stoodDatabase(work, stood.adopted, target) : undefined;
  if (left === false) return false;

  const named = await freeAddressPiece(work, free, where);
  if (named !== true) return named;

  const bucket = await syncBucket(connection, accountId, work.mode);
  const taken = stood.adopted && bucket.ok && bucket.report.changedNothing;
  if (!synced(work, "R2 bucket", taken ? `${INSTALL_OBJECTS.bucket} (${BY_NAME})` : INSTALL_OBJECTS.bucket, bucket)) return false;

  // A database that was found and read is left as it is: it is not looked for again.
  const database = left?.found ?? (await syncDatabase(connection, accountId, work.mode));
  if (!synced(work, "D1 database", left?.detail ?? INSTALL_OBJECTS.database, database)) return false;

  const users = keptUsersRow(login, left?.kept);
  if (users !== undefined) note(work, users);

  // A database that stood before the run holds the setting of the logs the Worker goes on with; a new install starts with them kept.
  const logsKept = left?.kept?.provider_logs ?? true;

  return (await workerPieces(work, target, release, { standing, databaseId: database.ok ? database.id : undefined, logsKept })) && { kept: left?.kept };
}

/** Make the install, or with a dry run say what a run would make. */
async function install(found: Startable<Place>, where: Where, login: Login, run: Run, reach: Reach, say: (row: Row) => void): Promise<Installed | Unanswered<Where>> {
  const { tokenLink: form } = tokenFacts(where.kind === "domain" ? "domain" : "noDomain", MADE_FIRST);
  const work: Work = { mode: run === "apply" ? "apply" : "plan", place: found.place, form, rows: [], steps: [], blocked: [...found.notes], say };
  const ready = await prepared(work, where, reach);
  if ("ok" in ready) return ready;

  const { target, release } = ready;
  const address = `https://${target.kind === "domain" ? target.layout.adminHostname : target.layout.adminHost}`;
  const standing = found.state === "started";
  // A Worker that stood before the run goes on running the release its code states: the run uploads none.
  const known = { release: standing ? found.place.runs : release.bundle.version, address };
  const made = await madeFirst(work, ready, where, login, { standing, adopted: found.state === "adopted" });
  if (made === false) return done(work, known);

  if ("why" in made) return made;

  return (await finish(work, target, login, made.kept, reach)) ? done(work, { ...known, unused: unusedLogin(login, made.kept) }) : UNREACHABLE;
}

/** Cloudflare, as the command works through it. */
export const installer: Installer<Where, Place> = {
  id: "cloudflare",
  name: "Cloudflare",
  about: "Installs on a custom domain or on workers.dev",
  options: OPTIONS,
  usage: "(--domain <name> | --no-domain)",
  tokenHelp: { install: tokenHelp(TOKEN_PIECES.install), repair: tokenHelp(TOKEN_PIECES.repair), remove: tokenHelp(TOKEN_PIECES.remove) },
  token: (text) => (TOKEN.test(text) ? (text as Token) : undefined),
  read,
  placeWords,
  form: (where, work, rights) => tokenForm(where.kind === "domain" ? { kind: "domain", domain: where.layout.domain } : { kind: "noDomain" }, TOKEN_PIECES[work], rights),
  find: (token, where, reach, work) => findInstall(token, where, reach, { lacks: lacksRight, nameOf: rightFor, buckets: work !== "repair" }),
  install,
  remove: (found, where, removal, _reach, say) => removeInstall(found, where, removal, tokenFacts(where.kind === "domain" ? "domain" : "noDomain", MADE_FIRST).tokenLink, say),
  repair,
};
