// `poplin install cloudflare`: an install made with an account token, from a terminal, in one run.
//
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

import type { Login } from "@poplin/core/src/auth/logins";
import type { Blocked, Given, Installed, Installer, OptionRow, Question, Reach, Read, Row, Run, Startable, Step, Token } from "@poplin/core/src/install/installer";
import { defaultSettings, type SettingValues } from "@poplin/core/src/records/settings";
import { BaseSubdomain } from "cloudflare/resources/workers/scripts/subdomain";
import { BaseSubdomains } from "cloudflare/resources/workers/subdomains";
import { homepage } from "../../../../../../cli/package.json";
import { newestRelease, type Release } from "../../release/update/newest-release";
import { putCrons, putFirst, readCrons } from "../../release/update/upload";
import { type AccountAddresses, parseAccountAddresses } from "../../../without-domain/address-layout";
import { syncBucket } from "../pieces/bucket/bucket";
import { type CloudflareFailure, type CloudflareResult, callCloudflare } from "../client";
import { holderWords, readHolder, syncDatabase } from "../pieces/database/database";
import { BY_NAME, INSTALL_OBJECTS } from "../install-objects";
import { type DomainLayout, parseDomainLayout } from "../../../with-domain/layout";
import { createPathPlug } from "../../../without-domain/path-plug";
import type { Mode, Synced } from "../sync";
import { createDomainPlug, lacksRight, rightFor, rightsByHand, TOKEN, tokenFacts } from "../../../with-domain/zone-plug";
import { findInstall, type Place, placeWords, type Where } from "./find";
import { removeInstall } from "../upkeep/remove/remove";
import { placeBinding } from "../kind/started-place";
import { failureWords, LACKS, lackingOf, rowOf, UNDONE } from "./rows";
import { repair } from "../upkeep/repair/repair";
import { readStored, type Untaken } from "../upkeep/repair/settings";

/** The name of the install's Worker. */
const SCRIPT = INSTALL_OBJECTS.worker;

/** What `POPLIN_DOMAIN` says for an install without a domain. */
const NO_DOMAIN = "none";

/** An account's id, as Cloudflare writes it. */
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** The provider's own options. */
const OPTIONS: readonly OptionRow[] = [
  { flag: "--domain", value: "<name>", about: "under your own domain, which is Active on the account: example.com", variable: "POPLIN_DOMAIN" },
  { flag: "--no-domain", value: null, about: "at the free address Cloudflare gives the account", variable: `POPLIN_DOMAIN=${NO_DOMAIN}` },
  { flag: "--account", value: "<id>", about: "the account, when the token shows more than one", variable: "POPLIN_ACCOUNT" },
];

/** What a line of the run says, where no row of a piece's own says it. */
const WORDS = {
  both: "give one of --domain <name> and --no-domain",
  noName: "--domain takes a name, such as example.com",
  account: "--account takes an account's id: 32 characters of 0-9 and a-f",
  domain: { "bad-domain": "is no domain name", "domain-too-long": "is too long: an address of the login under it passes 63 characters", "bad-public-word": "is no domain name" },
  noRelease: "No release of poplin is published yet.",
  badRelease: "The release's files are not the ones the project published. Nothing was uploaded.",
  newerRelease: "This release needs a newer poplin: run npx poplin@latest install",
  noAddress: "This account has no free address yet, or one whose name is too long for the login. Open Workers & Pages in your browser and set the account's subdomain.",
  lacks: LACKS,
  refusedLater: "Cloudflare refused the token before the install was finished",
  notUsed: "it is not used, and an install needs a database of this name",
  unchecked: "its code was there before this run, and this run did not check it",
  allowance: "the database's free allowance for the day is used up",
  unreadUsers: "its records are not at the schema of this poplin, so the users it holds were not read, and --login is used",
} as const;

/** What a run answers that could not start its work, or lost Cloudflare on the way. */
const UNREACHABLE: Installed = { ok: false, why: "unreachable", words: "Cloudflare or the project's website gave no usable answer." };

/** What an install makes that no repair does, so that its token needs the permission for it. */
const MADE_FIRST = ["R2 bucket"] as const;

/** The row of the repair that this file settles itself, before the upload. */
const OWN_ROWS: ReadonlySet<string> = new Set(["D1 database"]);

/** How many users of a database a row names before it counts the rest. */
const NAMED_USERS = 5;

/** How the users a row names are joined: `a and b`, `a, b, and 2 more`. */
const USERS = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Where the install answers, with its checked addresses. */
type Target = { readonly kind: "domain"; readonly layout: DomainLayout } | { readonly kind: "no-domain"; readonly layout: AccountAddresses };

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
function whereOf(text: string, account: string | undefined): Read<Where> {
  const typed = text.trim().toLowerCase();
  if (typed === "" || typed === NO_DOMAIN) return { ok: true, where: { kind: "no-domain", account } };

  const layout = parseDomainLayout({ domain: typed });

  return layout.ok ? { ok: true, where: { kind: "domain", layout: layout.value, account } } : { ok: false, why: "refused", refused: `${typed} ${WORDS.domain[layout.refusal]}` };
}

/** The question of where the install answers, for a run that was given neither option. */
function whichPlace(account: string | undefined): Question<Where> {
  return {
    key: "where",
    name: "where it answers",
    ask: "Your own domain (example.com), or Enter for none:",
    give: "Give --domain <name> or --no-domain (or POPLIN_DOMAIN).",
    answer: (text) => whereOf(text, account),
  };
}

/** Read the provider's own options and variables, once; an option outranks its variable. */
function read(given: Given): Read<Where> {
  const [domain, none] = [given.flags.get("domain"), given.flags.has("no-domain")];
  if (domain !== undefined && none) return { ok: false, why: "refused", refused: WORDS.both };

  if (domain === true || domain?.trim() === "") return { ok: false, why: "refused", refused: WORDS.noName };

  const named = given.flags.get("account") ?? given.env.POPLIN_ACCOUNT;
  if (named !== undefined && (named === true || !ACCOUNT_ID.test(named))) return { ok: false, why: "refused", refused: WORDS.account };

  // A variable that is set to nothing is one that was not given: only Enter at the question means none.
  const typed = domain ?? (none ? NO_DOMAIN : given.env.POPLIN_DOMAIN);

  return typed === undefined || typed.trim() === "" ? { ok: false, why: "open", open: [whichPlace(named)] } : whereOf(typed, named);
}

/** The lines of the help that say what the account token needs, for each kind of install. */
function tokenHelp(): string[] {
  const [domain, none] = [tokenFacts("domain", MADE_FIRST), tokenFacts("noDomain", MADE_FIRST)];
  const gap = " ".repeat(16);
  // The link cannot choose every permission: the line under it says how many it chooses, and names the rest.
  const chosen = (kind: "domain" | "noDomain", needed: number): string[] => {
    const byHand = rightsByHand(kind, MADE_FIRST);

    return byHand.length === 0 ? [] : [`${gap}the link chooses ${needed - byHand.length} of them: choose ${byHand.join(", ")} on the form yourself`];
  };

  return [
    "The account token needs:",
    `  with a domain ${domain.tokenRights.length} permissions: ${domain.tokenRights.join(", ")}`,
    `${gap}${domain.tokenLink}`,
    ...chosen("domain", domain.tokenRights.length),
    `  without       ${none.tokenRights.length} permissions: ${none.tokenRights.join(", ")}`,
    `${gap}${none.tokenLink}`,
    ...chosen("noDomain", none.tokenRights.length),
    `  optional      ${domain.tokenOptional.map((optional) => optional.right).join(", ")}`,
  ];
}

/** Why a call failed, with nothing Cloudflare said but its status and the numbers of its codes. */
function whyOf(failure: NotWritten): string {
  if (failure.failure === "refused" || failure.failure === "rate-limited" || failure.failure === "network") return failureWords(failure);

  if (failure.failure === "allowance") return WORDS.allowance;

  return failure.failure === "needs-hand" ? WORDS.newerRelease : "Cloudflare named no database";
}

/** Add a row to the run and tell the command. */
function note(work: Work, row: Row): boolean {
  work.rows.push(row);
  work.say(row);

  return !UNDONE.has(row.state);
}

/** The row of a piece whose call failed: blocked where the token lacks its permission, which the row names. A piece of the Worker's needs the permission its variables need. */
function failed(work: Work, object: "R2 bucket" | "D1 database" | "Worker" | "Sweep trigger" | "Worker address", detail: string, failure: NotWritten): false {
  const right = rightFor(object === "R2 bucket" || object === "D1 database" ? object : "Worker variable");
  if (lacksRight(failure)) note(work, { object, state: "block", detail: `${detail}: ${WORDS.lacks}: ${right}`, right });
  else note(work, { object, state: "fail", detail: `${detail}: ${whyOf(failure)}` });

  return false;
}

/** The row of a piece that a sync of its own settled: made, or left as it is. */
function synced(work: Work, object: "R2 bucket" | "D1 database", detail: string, answer: Synced | Awaited<ReturnType<typeof syncDatabase>>): boolean {
  if (!answer.ok) return failed(work, object, detail, answer);

  return note(work, { object, state: answer.report.changedNothing ? "leave" : "make", detail });
}

/**
 * Settle one piece of the Worker: its code, its sweep trigger, or its free address.
 *
 * @param stands - reads whether the piece is as it should be, on a Worker that was there before the run; `undefined` on a Worker the run makes, where the piece is made with it
 * @param write - makes the piece match; never called by a dry run, nor for a piece that stands
 */
async function workerPiece(
  work: Work,
  row: { readonly object: "Worker" | "Sweep trigger" | "Worker address"; readonly detail: string },
  stands: (() => Promise<CloudflareResult<boolean>>) | undefined,
  write: () => Promise<{ readonly ok: true } | NotWritten>,
): Promise<boolean> {
  const stood = stands === undefined ? undefined : await stands();
  if (stood?.ok === false) return failed(work, row.object, row.detail, stood);

  if (stood?.value === true) return note(work, { ...row, state: "leave" });

  const written = work.mode === "apply" ? await write() : ({ ok: true } as const);
  if (!written.ok) return failed(work, row.object, row.detail, written);

  return note(work, { ...row, state: stood === undefined ? "make" : "change" });
}

/** Whether two cron lists hold the same crons. */
function sameCrons(one: readonly string[], other: readonly string[]): boolean {
  const [left, right] = [new Set(one), new Set(other)];

  return left.size === right.size && [...left].every((cron) => right.has(cron));
}

/** Read where the install answers: the domain's own layout, or the three hosts on the account's free address, whose name is read here. */
async function targetOf(place: Place, where: Where, form: string): Promise<Target | Blocked | CloudflareFailure> {
  if (where.kind === "domain") return { kind: "domain", layout: where.layout };

  const address = await callCloudflare(place.connection, (api) => new BaseSubdomains(api).get({ account_id: place.accountId }));
  if (!address.ok && lacksRight(address)) {
    const right = rightFor("Forwarder");

    return { what: "right_lacking", right, words: `Free address: ${WORDS.lacks}: ${right}`, address: form };
  }

  if (!address.ok) return address;

  // An account that never set its free address answers with no name.
  const layout = typeof address.value.subdomain === "string" && address.value.subdomain !== "" ? parseAccountAddresses({ account_address: address.value.subdomain }, SCRIPT) : undefined;
  if (layout?.ok === true) return { kind: "no-domain", layout: layout.value };

  return { what: "no_address", words: WORDS.noAddress, address: `https://dash.cloudflare.com/${place.accountId}/workers-and-pages` };
}

/** Fetch the newest release the project published, with every digest checked; a release there is none of is the block that says why. */
async function releaseOf(reach: Reach): Promise<Release | Blocked | "unreachable"> {
  const release = await newestRelease(reach);
  if (typeof release !== "string" || release === "unreachable") return release;

  if (release === "no_release") return { what: release, words: WORDS.noRelease, address: homepage };

  return release === "newer_release" ? { what: release, words: WORDS.newerRelease, address: homepage } : { what: release, words: WORDS.badRelease, address: homepage };
}

/** The Worker's own pieces, in order: its code, its sweep trigger, and whether its free address is switched on. Each stops the ones after it. */
async function workerPieces(work: Work, target: Target, release: Release, made: { readonly standing: boolean; readonly databaseId: string | undefined }): Promise<boolean> {
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
    { object: "Worker", detail: made.standing ? `${SCRIPT}: ${WORDS.unchecked}` : `${SCRIPT}, runs ${bundle.version}` },
    made.standing ? async () => ({ ok: true, value: true }) : undefined,
    async () => {
      if (made.databaseId === undefined) return { ok: false, failure: "no-id" };

      const place = placeBinding(target.kind === "domain" ? { kind: "domain", domain: target.layout.domain } : { kind: "no-domain" });

      return putFirst(connection, worker, bundle, [...release.first({ script: SCRIPT, bucket: INSTALL_OBJECTS.bucket, databaseId: made.databaseId }), place]);
    },
  );
  if (!uploaded) return false;

  const scheduled = await workerPiece(
    work,
    { object: "Sweep trigger", detail: bundle.deploy.crons.join(", ") },
    reads(
      () => readCrons(connection, worker),
      (crons) => sameCrons(crons, bundle.deploy.crons),
    ),
    () => putCrons(connection, worker, bundle.deploy.crons),
  );
  if (!scheduled) return false;

  return workerPiece(
    work,
    { object: "Worker address", detail: target.kind === "no-domain" ? `on: ${target.layout.adminHost}` : "off: the install answers under its domain" },
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
 * A database that stood before the run and holds an earlier install's settings is what the Worker goes on with: its login is mended to those users, its rules to those settings, and `--login` is not used.
 *
 * @param kept - the settings such a database holds; `undefined` for a database the Worker stores its first settings in
 * @returns whether Cloudflare answered; its rows are added to the run, but the database's, which stands by now
 */
async function finish(work: Work, target: Target, login: Login, kept: SettingValues | undefined, reach: Reach): Promise<boolean> {
  const settings = kept ?? defaultSettings({ installer: login });
  const parts = { script: SCRIPT, first: { login: settings.logins[0] ?? login, accountId: work.place.accountId }, fetch: reach.fetch, now: reach.now };
  const plug = target.kind === "domain" ? createDomainPlug({ ...parts, layout: target.layout }) : createPathPlug({ ...parts, layout: target.layout });
  const reading = await (work.mode === "plan" ? plug.check(work.place.connection.key, async () => settings) : plug.repair(work.place.connection.key, async () => settings));
  if (!reading.ok && reading.refusal === "unreachable") return false;

  if (!reading.ok) {
    note(work, { object: "Token", state: "fail", detail: WORDS.refusedLater });

    return true;
  }

  const loginOff = work.blocked.some((block) => block.what === "login_off");
  for (const row of reading.rows.filter((entry) => !OWN_ROWS.has(entry.object))) note(work, rowOf(row, work.mode, loginOff));

  work.steps.push(...reading.steps);

  return true;
}

/** What a run came to, from what it gathered. Each permission a row names as lacking is a block too, once. */
function done(work: Work, known: { readonly release?: string; readonly address?: string; readonly unused?: Login | undefined }): Installed {
  const blocked = [...work.blocked, ...lackingOf(work.rows, work.form)];
  const ready = blocked.length === 0 && !work.rows.some((row) => UNDONE.has(row.state));

  return { ok: true, rows: work.rows, steps: work.steps, blocked, release: known.release, address: known.address, ready, proof: "reads", unused: known.unused };
}

/** Read what a run is made from, before it makes anything: where the install answers, and the release. A block of either ends the run with nothing changed. */
async function prepared(work: Work, where: Where, reach: Reach): Promise<{ readonly target: Target; readonly release: Release } | Installed> {
  const target = await targetOf(work.place, where, work.form);
  if ("failure" in target) return UNREACHABLE;

  if ("what" in target) return done({ ...work, blocked: [...work.blocked, target] }, {});

  const release = await releaseOf(reach);
  if (release === "unreachable") return UNREACHABLE;

  return "what" in release ? done({ ...work, blocked: [...work.blocked, release] }, {}) : { target, release };
}

/** Say that the users a kept database holds were not read, and name the repair that mends the login to them, at the place of the install. */
function unreadUsers(target: Target): string {
  return `${WORDS.unreadUsers}. Once the install answers, ${["npx poplin doctor --repair", ...placeWords(target)].join(" ")} mends the login to the users it holds`;
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
function namedUsers(logins: readonly Login[]): string {
  const more = logins.length - NAMED_USERS;

  return USERS.format(more > 0 ? [...logins.slice(0, NAMED_USERS), `${more} more`] : logins);
}

/** The first login a person gave, where the database holds users already and it is none of them; `undefined` where the login is used, or is a user already. */
function unusedLogin(login: Login, kept: SettingValues | undefined): Login | undefined {
  return kept === undefined || kept.logins.includes(login) ? undefined : login;
}

/**
 * The row of the first login a person gave, where the database holds users already; `undefined` where it holds none, and the login is used.
 *
 * It names the users the login is mended to, whether the person is one of them or not: the database may be one somebody else left under poplin's name, and they are who logs in from then on.
 * The command says how a person who is none of them is let in: the run's answer names that login as unused.
 */
function keptUsersRow(login: Login, kept: SettingValues | undefined): Row | undefined {
  if (kept === undefined) return undefined;

  const users = kept.logins.length === 1 ? "its user" : `its ${kept.logins.length} users`;
  const held = `The database holds ${users} already, and they are who logs in: ${namedUsers(kept.logins)}.`;
  if (unusedLogin(login, kept) === undefined) return { object: "First login", state: "leave", detail: `${login}: a user already. ${held}` };

  return { object: "First login", state: "leave-out", detail: `${login}: not used. ${held}` };
}

/**
 * Make what the install's own repair cannot: the bucket, the database, and the Worker with its trigger and its address. Each stops the ones after it.
 *
 * @returns `false` once a piece stopped the run; else the settings a database that stood before the run holds, which the install is finished to
 */
async function madeFirst(work: Work, target: Target, release: Release, login: Login, stood: { readonly standing: boolean; readonly adopted: boolean }): Promise<false | { readonly kept: SettingValues | undefined }> {
  const { connection, accountId } = work.place;
  const { standing } = stood;
  // A database that is somebody else's stops the run before the bucket is made beside it. One this run makes holds nothing to read.
  const left = stood.adopted || standing ? await stoodDatabase(work, stood.adopted, target) : undefined;
  if (left === false) return false;

  const bucket = await syncBucket(connection, accountId, work.mode);
  const taken = stood.adopted && bucket.ok && bucket.report.changedNothing;
  if (!synced(work, "R2 bucket", taken ? `${INSTALL_OBJECTS.bucket} (${BY_NAME})` : INSTALL_OBJECTS.bucket, bucket)) return false;

  // A database that was found and read is left as it is: it is not looked for again.
  const database = left?.found ?? (await syncDatabase(connection, accountId, work.mode));
  if (!synced(work, "D1 database", left?.detail ?? INSTALL_OBJECTS.database, database)) return false;

  const users = keptUsersRow(login, left?.kept);
  if (users !== undefined) note(work, users);

  return (await workerPieces(work, target, release, { standing, databaseId: database.ok ? database.id : undefined })) && { kept: left?.kept };
}

/** Make the install, or with a dry run say what a run would make. */
async function install(found: Startable<Place>, where: Where, login: Login, run: Run, reach: Reach, say: (row: Row) => void): Promise<Installed> {
  const { tokenLink: form } = tokenFacts(where.kind === "domain" ? "domain" : "noDomain", MADE_FIRST);
  const work: Work = { mode: run === "apply" ? "apply" : "plan", place: found.place, form, rows: [], steps: [], blocked: [...found.notes], say };
  const ready = await prepared(work, where, reach);
  if ("ok" in ready) return ready;

  const { target, release } = ready;
  const address = `https://${target.kind === "domain" ? target.layout.adminHostname : target.layout.adminHost}`;
  const standing = found.state === "started";
  const known = { release: standing ? undefined : release.bundle.version, address };
  const made = await madeFirst(work, target, release, login, { standing, adopted: found.state === "adopted" });
  if (made === false) return done(work, known);

  return (await finish(work, target, login, made.kept, reach)) ? done(work, { ...known, unused: unusedLogin(login, made.kept) }) : UNREACHABLE;
}

/** Cloudflare, as the command works through it. */
export const installer: Installer<Where, Place> = {
  id: "cloudflare",
  name: "Cloudflare",
  about: "Cloudflare: under your own domain, or without one",
  options: OPTIONS,
  usage: "(--domain <name> | --no-domain)",
  tokenHelp: tokenHelp(),
  token: (text) => (TOKEN.test(text) ? (text as Token) : undefined),
  read,
  placeWords,
  facts: (where, work) => tokenFacts(where.kind === "domain" ? "domain" : "noDomain", work === "repair" ? [] : MADE_FIRST),
  find: (token, where, reach, work) => findInstall(token, where, reach, { lacks: lacksRight, nameOf: rightFor, buckets: work !== "repair" }),
  install,
  remove: (found, where, removal, _reach, say) => removeInstall(found, where, removal, tokenFacts(where.kind === "domain" ? "domain" : "noDomain", MADE_FIRST).tokenLink, say),
  repair,
};
