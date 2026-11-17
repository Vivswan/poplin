// `poplin doctor --repair`: an install that is set, mended with an account token from a terminal. It needs no login of the install, so it is the way back in.
//
//   the Worker's bindings   which kind of install it is, where it answers, and which database holds its records
//   the release             left as it is, with a row that says where a newer one is out; brought to the newest only where the line asks to update
//   the settings            read from that database with the token, as the Worker's own store reads them
//   the repair              the one of the install's kind: the code the dashboard's Domain screen runs, with the same settings
//   one more user           only where asked: the login is written with the email first, and the email is stored after Cloudflare took that write
//
// A dry run reads the same things and sends no change, so its rows are the rows of the run after it.
// A token that may only read adds nobody: the write of the login is what proves that it may change who logs in, and nothing is stored before it.

import type { DomainSettings } from "@poplin/app/src/console/domain/records";
import type { Login } from "@poplin/core/src/auth/logins";
import type { Mend, Reach, Repaired, Row, Step, Whole } from "@poplin/core/src/install/installer";
import { createPathPlug } from "../../../../without-domain/path-plug";
import { ACCESS_OFF, createDomainPlug, lacksRight, rightFor, tokenFacts } from "../../../../with-domain/zone-plug";
import type { CloudflareFailure } from "../../client";
import { boundInstall, jsonOf, type Place, placeWords, type Where } from "../../first/find";
import { failureWords, LACKS, lackingOf, rowOf, UNDONE } from "../../first/rows";
import { INSTALL_OBJECTS } from "../../install-objects";
import { readFirstSettings } from "../../kind/first-settings";
import type { BoundInstall } from "../../kind/zone-binding";
import { isAccessOff, writeLogins } from "../../pieces/access/access";
import { type ListedBinding, readBindings } from "../../pieces/variables/variables";
import type { Mode } from "../../sync";
import { NEWEST_POPLIN, RECORDS_WAIT, syncRelease } from "./release";
import { readStored, type Stored, storeUser, type Untaken } from "./settings";

/** The name of the install's Worker. */
const SCRIPT = INSTALL_OBJECTS.worker;

/** A path of the dashboard's address that passes the login in front, so a person with no login reaches the Worker there. */
const OPEN_PATH = `${INSTALL_OBJECTS.openPaths[0]}/whoami`;

/** What the row of the user a repair adds is called. */
const USER = "User";

/** What a line of the run says, where no row of a piece's own says it. */
const WORDS = {
  unreachable: "Cloudflare gave no usable answer.",
  token: "Cloudflare refused the token at the install: it must show the install's own account, and its domain where it has one.",
  changed: "The install changed while it was read. Run this again.",
  another: "The install's records are not at the schema of this poplin. Run the poplin of the install's own version, or the newest:",
  behind: "its records are not at the schema of this poplin, so this poplin cannot mend it as it is. To bring it to the newest release and mend it: npx poplin doctor --repair --update",
  noDomain: "The install here has no domain: give --no-domain.",
  noFirst: `${INSTALL_OBJECTS.firstSettingsBinding}: the install stored no settings yet, and the ones its Worker starts with cannot be read`,
  allowance: "the database's free allowance for the day is used up",
  already: "a user already",
  noUsers: "the install has stored no users yet. It stores them when it first answers: ask this address once, then run this again",
  noLogin: "the login is not made yet: the rows above say why",
  unstored: "the login lets the email in, and the install did not store it. Run this again",
} as const;

/** What one run gathers. `form` is the address of the token's form, where a permission is added, and `address` where the install's dashboard is. */
interface Work {
  readonly mode: Mode;
  readonly place: Place;
  readonly form: string;
  readonly address: string;
  readonly rows: Row[];
  readonly steps: Step[];
  readonly say: (row: Row) => void;
}

/** What a repair stands on, read from the Worker: its bindings, the kind of install they say it is, and the id of the database that holds its records. */
interface Ground {
  readonly bindings: readonly ListedBinding[];
  readonly install: BoundInstall;
  readonly databaseId: string;
}

/** Add a row to the run and tell the command. */
function note(work: Work, row: Row): void {
  work.rows.push(row);
  work.say(row);
}

/** What a run came to, from what it gathered. Each permission a row names as lacking is a block, once. */
function done(work: Work): Repaired {
  const blocked = lackingOf(work.rows, work.form);
  const ready = blocked.length === 0 && !work.rows.some((row) => UNDONE.has(row.state));

  return { ok: true, rows: work.rows, steps: work.steps, blocked, address: work.address, ready };
}

/** A read of the install that failed before any row: the token refused whole, or no answer. */
function unread(failure: CloudflareFailure): Repaired {
  const token = failure.failure === "refused" && (failure.status === 401 || failure.status === 403);

  return token ? { ok: false, why: "token", words: WORDS.token } : { ok: false, why: "unreachable", words: WORDS.unreachable };
}

/** Say that the install's records are of another poplin, with the newest poplin's repair that goes on: the one that also updates, where this run was asked to. */
function anotherWords(update: boolean): string {
  return `${WORDS.another} ${update ? NEWEST_POPLIN.update : NEWEST_POPLIN.mend}`;
}

/** Put the option of the install's place after a refusal that ends in the command that goes on, so that the line runs as it is written. */
function atPlace(words: string, where: Where): string {
  return [words, ...placeWords(where)].join(" ");
}

/** Say that the install answers at another place than the one a person named; `undefined` where the two are one. */
function elsewhere(install: BoundInstall, where: Where): string | undefined {
  if (install.kind !== "domain") return where.kind === "domain" ? WORDS.noDomain : undefined;

  const { domain } = install.layout;
  const named = where.kind === "domain" && where.layout.domain === domain;

  return named ? undefined : `The install here is under the domain ${domain}: give --domain ${domain}.`;
}

/**
 * Read what the repair stands on.
 *
 * @param where - the place a person named
 * @returns the Worker's bindings with what they say; or why nothing is mended: no answer, a Worker that is no whole install now, or an install at another place than the one named
 */
async function groundOf(place: Place, where: Where): Promise<Ground | Repaired> {
  const bindings = await readBindings(place.connection, { accountId: place.accountId, script: SCRIPT });
  if (!bindings.ok) return unread(bindings);

  const install = boundInstall(bindings.value);
  const databaseId = bindings.value.find((binding) => binding.name === INSTALL_OBJECTS.databaseBinding && binding.type === "d1")?.id;
  if (install === undefined || databaseId === undefined) return { ok: false, why: "changed", words: WORDS.changed };

  const other = elsewhere(install, where);

  return other === undefined ? { bindings: bindings.value, install, databaseId } : { ok: false, why: "elsewhere", words: other };
}

/** Why a call the database did not take failed. */
function whyOf(failure: Untaken): string {
  return failure.failure === "allowance" ? WORDS.allowance : failureWords(failure);
}

/** The row of a call that failed for one object: blocked where the token lacks the object's permission, which the row names. */
function failed(object: "D1 database" | typeof USER, detail: string, failure: Untaken, right: string): Row {
  if (failure.failure !== "allowance" && lacksRight(failure)) return { object, state: "block", detail: `${detail}: ${LACKS}: ${right}`, right };

  return { object, state: "fail", detail: `${detail}: ${whyOf(failure)}` };
}

/**
 * The settings a repair mends to: the stored ones, or for an install that has stored none yet, the ones its Worker will store on its first start.
 *
 * @returns the settings, or the row that says why there are none to mend to
 */
function settingsOf(stored: Exclude<Stored, { readonly state: "another" }>, bindings: readonly ListedBinding[]): DomainSettings | Row {
  if (stored.state === "stored") return stored.settings;

  if (stored.state === "unread") return failed("D1 database", INSTALL_OBJECTS.database, stored.failure, rightFor("D1 database"));

  const first = readFirstSettings(jsonOf(bindings, INSTALL_OBJECTS.firstSettingsBinding));

  return first.ok ? first.values : { object: "Worker variable", state: "fail", detail: `${WORDS.noFirst}: ${first.refusal}` };
}

/**
 * Run the repair of the install's kind with the settings, or its check for a dry run, and add its rows and steps to the run.
 *
 * @returns `undefined` once the rows are in; else why nothing was read
 */
async function mended(work: Work, install: BoundInstall, settings: DomainSettings, reach: Reach): Promise<Extract<Repaired, { readonly ok: false }> | undefined> {
  const parts = { script: SCRIPT, accountId: work.place.accountId, fetch: reach.fetch, now: reach.now };
  const plug = install.kind === "domain" ? createDomainPlug({ ...parts, layout: install.layout }) : createPathPlug({ ...parts, layout: install.layout });
  const { key } = work.place.connection;
  const reading = await (work.mode === "plan" ? plug.check(key, async () => settings) : plug.repair(key, async () => settings));
  if (!reading.ok) return reading.refusal === "unreachable" ? { ok: false, why: "unreachable", words: WORDS.unreachable } : { ok: false, why: "token", words: WORDS.token };

  const loginOff = reading.rows.some((row) => row.state === "missing" && row.detail === ACCESS_OFF);
  for (const row of reading.rows) note(work, rowOf(row, work.mode, loginOff));

  work.steps.push(...reading.steps);

  return undefined;
}

/**
 * Let one more person log in, and say so in one row.
 *
 * The login is written with the email first, with the token and even where it holds the email already: Cloudflare taking that write is the proof that the token may change who logs in.
 * Only after it is the email stored, in the one step that also writes the entry of the change. A refused write stores nothing.
 *
 * @param at - the moment of the change, in milliseconds since the epoch
 */
async function userRow(work: Work, stored: Exclude<Stored, { readonly state: "another" }>, login: Login, at: number): Promise<Row> {
  // The path is open to a caller with no login, and any request the Worker answers makes it store its first settings.
  const unstored: Row = { object: USER, state: "block", detail: `${login}: ${WORDS.noUsers}: ${work.address}${OPEN_PATH}` };
  if (stored.state !== "stored") return unstored;

  const { logins } = stored.settings;
  const already = logins.includes(login);
  const known: Row = { object: USER, state: "leave", detail: `${login}: ${WORDS.already}` };
  if (work.mode === "plan") return already ? known : { object: USER, state: "make", detail: login };

  const { connection, accountId } = work.place;
  const written = await writeLogins(connection, accountId, already ? logins : [...logins, login], "always");
  if (!written.ok) return isAccessOff(written) ? { object: USER, state: "block", detail: `${login}: ${ACCESS_OFF}` } : failed(USER, login, written, rightFor("Access policy"));

  if (!written.value) return { object: USER, state: "block", detail: `${login}: ${WORDS.noLogin}` };

  const kept = already ? "already" : await storeUser(stored.database, login, at);
  if (kept === "added") return { object: USER, state: "make", detail: login };

  if (kept === "already") return known;

  if (kept === "none") return unstored;

  return failed(USER, `${login}: ${WORDS.unstored}`, kept, rightFor("D1 database"));
}

/**
 * End a run whose release step left rows, on records this poplin does not read.
 *
 * A dry run that named the steps of a release it did not place reads the records in the run after. Every other run whose rows say nothing of the records yet says so here: a release in place is no mended install.
 */
function unreadRecords(work: Work, release: Extract<Awaited<ReturnType<typeof syncRelease>>, { readonly rows: readonly Row[] }>, where: Where): Repaired {
  // Only a run that was asked to update gets here, so the repair its row names updates too.
  const another = atPlace(anotherWords(true), where);
  const named = work.mode === "plan" && release.rows.some((row) => row.object === RECORDS_WAIT.object && row.state === "change");
  const said = named || release.rows.some((row) => row.object === RECORDS_WAIT.object && UNDONE.has(row.state));
  if (release.state === "unplaced") note(work, RECORDS_WAIT);
  else if (!said) note(work, { object: RECORDS_WAIT.object, state: "block", detail: another });

  return done(work);
}

/**
 * Why an install whose code the run left alone is not mended, where its records are not at this poplin's schema.
 *
 * @param out - the newer release the run was not asked to take; `undefined` for an install that is not behind one
 * @returns `behind` where a repair that updates goes on, and else `another`, which the newest poplin goes on from
 */
function unmendedWhole(found: Whole<Place>, out: string | undefined, mend: Mend, where: Where): Repaired {
  if (out !== undefined) return { ok: false, why: "behind", words: atPlace(`The install runs ${found.version}, and ${WORDS.behind}`, where) };

  return { ok: false, why: "another", words: atPlace(anotherWords(mend.update), where) };
}

/**
 * Mend an install that is set, or with a dry run say what a run would change.
 *
 * @param where - the place a person named: one that is not the install's own stops the repair before it reads the settings
 * @param say - told each row as it is settled
 * @returns the row of the Worker's code, every row of the kind's own repair, then the row of the user it was asked to add; or why nothing was mended
 */
export async function repair(found: Whole<Place>, where: Where, mend: Mend, reach: Reach, say: (row: Row) => void): Promise<Repaired> {
  const { place } = found;
  const { connection, accountId } = place;
  const ground = await groundOf(place, where);
  if ("ok" in ground) return ground;

  const { install, databaseId, bindings } = ground;
  const { tokenLink: form } = tokenFacts(install.kind === "domain" ? "domain" : "noDomain");
  const work: Work = { mode: mend.run === "apply" ? "apply" : "plan", place, form, address: found.address, rows: [], steps: [], say };
  const release = await syncRelease({ found, update: mend.update, databaseId, mode: work.mode, reach, rights: { lacks: lacksRight, nameOf: rightFor } });
  if (release.state === "stop") return { ok: false, why: "another", words: atPlace(release.words, where) };

  const stored = await readStored(connection, { accountId, databaseId });
  // An install whose code this run left alone is another poplin's whole. One this run was to bring to its release has its rows to show, and its records are read by the run after.
  if (stored.state === "another" && release.state === "left") return unmendedWhole(found, release.out, mend, where);

  for (const row of release.rows) note(work, row);

  if (stored.state === "another") return unreadRecords(work, release, where);

  const settings = settingsOf(stored, bindings);
  if ("object" in settings) {
    note(work, settings);

    return done(work);
  }

  const stopped = await mended(work, install, settings, reach);
  // A stop after this run sent a release, or said why it sent none, is no run that changed nothing: its rows stand, and one more says what was not read.
  if (stopped !== undefined) {
    if (release.state === "left" || work.mode === "plan") return stopped;

    note(work, { object: "Rest of the install", state: "fail", detail: `${stopped.words} Run this again` });

    return done(work);
  }

  if (mend.addUser !== undefined) note(work, await userRow(work, stored, mend.addUser, reach.now()));

  return done(work);
}
