// What an install holds and answers, written down while the older build runs it and read again once this commit's build does.
//
//   fill      three sites, one of each access, the private one with a second version; one setting changed; one more user
//   read      each site as its holder is shown it, as a stranger is answered at its address, and by the files of its every version; every setting; the log
//   compare   what differs, in words that hold no name, no address, and no value of a setting
//   publish   one more site once this commit's build runs: shown to its holder, answered to a stranger as the site of its access from before, and stored with its files
//
// The older build's command line fills and reads first, and this commit's reads after: a field the older answer held must be in the newer one, unchanged.

import { isDeepStrictEqual } from "node:util";
import * as v from "valibot";

import { readEntryName } from "../../../cli/src/backup/layout";
import { readZip } from "../../../cli/tests/backup/support/zips";
import type { Bench, LiveSite } from "../live/records";

/** The accesses of the sites an upgrade publishes, in order: the first gets a second version. */
const ACCESSES = ["private", "unlisted", "public"] as const;

/** The fields of a site a holder is shown that an update must leave as they were. */
const SITE_FIELDS = ["id", "label", "name", "public_name", "title", "access", "url", "addresses", "search_engines", "embeddable", "expires", "versions", "live_version", "bytes", "files", "state"] as const;

/** The setting an upgrade changes, and the value it gives it: another than a new install's. */
const CHANGED = { key: "versions_kept", value: 5 } as const;

/** The user an upgrade adds: an address nobody can log in with. */
const USER = "upgrade-check@example.com";

/** The site an upgrade publishes after the update: open to whoever has its link, as one of the sites from before is. */
const AFTER = { access: "unlisted", text: "<p>a page from after the update</p>" } as const;

/** The entry of the log a start of an update writes. */
const UPDATE_ENTRY = "update_started";

/** The log as the API answers it, as far as an upgrade reads it. */
const LOG = v.object({ entries: v.array(v.looseObject({ seq: v.number(), action: v.string(), detail: v.record(v.string(), v.unknown()) })) });

/** Every setting, as `poplin config` prints them. */
const SETTINGS = v.object({ values: v.record(v.string(), v.unknown()) });

/** A site as `poplin show` prints it. */
const SHOWN = v.object({ site: v.record(v.string(), v.unknown()) });

/** The value of a command an upgrade reads nothing of. */
const ANY = v.record(v.string(), v.unknown());

/** The sites as `poplin list` prints them. */
const LISTED = v.object({ sites: v.array(v.unknown()) });

/** The command line and the stranger's requests of one build, on the install. */
export type Desk = Pick<Bench, "admin" | "visit" | "cli" | "publish" | "folder" | "scratchFile">;

/** One entry of the log. */
type Entry = v.InferOutput<typeof LOG>["entries"][number];

/** What a stranger is answered at a site's address: the status, and of a page that was served the digest of its bytes and its media type. */
interface Visit {
  readonly status: number;
  readonly digest: string | undefined;
  readonly type: string | undefined;
}

/** One site as a reading holds it: what its holder is shown, what a stranger is answered, and the digest of each file of each version a backup of it holds. */
interface SiteRead {
  readonly access: LiveSite["access"];
  readonly shown: Readonly<Record<string, unknown>>;
  readonly visit: Visit;
  readonly stored: Readonly<Record<string, string>>;
}

/** An install as one reading holds it. */
export interface Reading {
  readonly sites: readonly SiteRead[];
  readonly listed: number;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly log: readonly Entry[];
}

/** Run one command that must work, and read its value. */
async function ask<Value>(desk: Desk, schema: v.GenericSchema<unknown, Value>, ...words: readonly string[]): Promise<Value> {
  const ran = await desk.cli(...words);
  const value = v.safeParse(schema, ran.value);
  if (ran.code !== 0 || !value.success) throw new Error(`poplin ${words[0]} exited ${ran.code}, with a value an upgrade cannot read`);

  return value.output;
}

/** Read every setting of an install, by its key. */
export async function settingsOf(desk: Desk): Promise<Readonly<Record<string, unknown>>> {
  return (await ask(desk, SETTINGS, "config")).values;
}

/**
 * Fill an install the older build runs: publish the sites, change one setting, and let one more user in.
 *
 * @param settings - the settings as they are, which `putBack` is given afterwards
 * @returns the sites
 */
export async function fill(desk: Desk, settings: Readonly<Record<string, unknown>>): Promise<LiveSite[]> {
  const sites: LiveSite[] = [];
  for (const access of ACCESSES) sites.push(await desk.publish({ access, text: `<p>a ${access} page from before the update</p>` }));

  const [first] = sites;
  if (first !== undefined) await ask(desk, ANY, "publish", desk.folder("<p>the second version, from before the update</p>"), "--site", first.id);

  await ask(desk, ANY, "config", CHANGED.key, String(CHANGED.value));
  await ask(desk, ANY, "config", "users", [...v.parse(v.array(v.string()), settings.users), USER].join(","));

  return sites;
}

/** Put the two settings an upgrade changed back as they were. */
export async function putBack(desk: Desk, settings: Readonly<Record<string, unknown>>): Promise<void> {
  await ask(desk, ANY, "config", CHANGED.key, String(settings[CHANGED.key]));
  await ask(desk, ANY, "config", "users", v.parse(v.array(v.string()), settings.users).join(","));
}

function digestOf(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Ask a site's address as a stranger. */
async function visitOf(desk: Desk, address: string): Promise<Visit> {
  const answer = await desk.visit(address);
  const bytes = await answer.bytes();
  if (answer.status !== 200) return { status: answer.status, digest: undefined, type: undefined };

  return { status: 200, digest: digestOf(bytes), type: answer.headers.get("Content-Type") ?? undefined };
}

/** Export a site with every version, with its holder's token, and answer the digest of each file by its version and its path. */
async function storedOf(desk: Desk, site: LiveSite): Promise<Record<string, string>> {
  const zip = desk.scratchFile(`upgrade-${site.id}.zip`);
  await ask(desk, ANY, "export", site.id, "--all-versions", "--out", zip, "--overwrite");
  const stored: Record<string, string> = {};

  for (const [name, content] of await readZip(zip)) {
    const entry = readEntryName(name);
    if (entry?.kind === "file") stored[`version ${entry.version}, ${entry.path}`] = digestOf(content);
  }

  return stored;
}

/**
 * Read an install: each site, the settings, and the log.
 *
 * @param token - an admin's token, which the log is read with
 * @throws {Error} a command failed, or the log was not answered: the token no longer works, or the install does not answer
 */
export async function readInstall(desk: Desk, token: string, sites: readonly LiveSite[]): Promise<Reading> {
  const read: SiteRead[] = [];
  for (const site of sites) read.push({ access: site.access, shown: (await ask(desk, SHOWN, "show", site.id)).site, visit: await visitOf(desk, site.url), stored: await storedOf(desk, site) });

  const listed = (await ask(desk, LISTED, "list")).sites.length;
  const settings = await settingsOf(desk);
  const answered = await desk.visit(`${desk.admin}/api/audit`, { headers: { Authorization: `Bearer ${token}` } });
  const log = v.safeParse(LOG, await answered.json().catch(() => undefined));
  if (answered.status !== 200 || !log.success) throw new Error(`the log was answered with status ${answered.status}, to the token made before the update`);

  return { sites: read, listed, settings, log: log.output.entries };
}

/**
 * Publish one more site, and ask for it as its holder, as a stranger, and by a backup of it.
 *
 * @param before - the install as it was read before the update: a stranger is answered at the new site as at the site of the same access from then
 * @returns the site, and what is wrong with it: none for one that is shown as itself, answered, and stored with the page it was published with
 * @throws {Error} the publish or the backup failed
 */
export async function publishAfter(desk: Desk, before: Reading): Promise<{ readonly site: LiveSite; readonly faults: readonly string[] }> {
  const site = await desk.publish(AFTER);
  const shown = await desk.cli("show", site.id);
  const visit = await visitOf(desk, site.url);
  const like = before.sites.find((read) => read.access === AFTER.access)?.visit;
  const page = digestOf(new TextEncoder().encode(AFTER.text));
  const told = v.safeParse(SHOWN, shown.value);
  const faults = [
    ...(shown.code === 0 && told.success && told.output.site.id === site.id ? [] : [`poplin show exited ${shown.code}, or showed another site`]),
    ...(visit.status === like?.status && visit.type === like.type ? [] : [`a stranger is answered ${visit.status} at it, and ${like?.status ?? "nothing"} at the ${AFTER.access} site from before the update, or another media type`]),
    ...(visit.digest === undefined || visit.digest === page ? [] : ["a stranger is answered another page than the one published"]),
    ...(Object.values(await storedOf(desk, site)).includes(page) ? [] : ["a backup of it does not hold the page published"]),
  ];

  return { site, faults };
}

/** What differs between the sites of two readings: one line a site, by its place and its access. */
export function siteFaults(before: Reading, after: Reading): string[] {
  const faults = before.sites.flatMap((was, place) => {
    const is = after.sites[place];
    const fields = SITE_FIELDS.filter((field) => !isDeepStrictEqual(was.shown[field], is?.shown[field]));
    const served = isDeepStrictEqual(was.visit, is?.visit) ? [] : [`a stranger was answered ${was.visit.status} and is answered ${is?.visit.status}${was.visit.status === is?.visit.status ? ", with other bytes or another media type" : ""}`];
    const files = isDeepStrictEqual(was.stored, is?.stored) ? [] : [`the files of its versions are not the ${Object.keys(was.stored).length} it held, byte for byte`];
    const told = [...fields.map((field) => `its ${field} changed`), ...served, ...files];

    return told.length === 0 ? [] : [`site ${place + 1} (${was.access}): ${told.join(", ")}`];
  });

  return before.listed === after.listed ? faults : [...faults, `the install listed ${before.listed} sites and lists ${after.listed}`];
}

/** The settings of the older reading that the newer one holds otherwise, or not at all, and whether the two an upgrade changed are in it: by their keys alone. */
export function settingFaults(before: Reading, after: Reading): string[] {
  const moved = Object.keys(before.settings).filter((key) => !isDeepStrictEqual(before.settings[key], after.settings[key]));
  const users = v.safeParse(v.array(v.string()), after.settings.users);
  const lost = [
    ...(after.settings[CHANGED.key] === CHANGED.value ? [] : [`${CHANGED.key} is not the value it was given`]),
    ...(users.success && users.output.includes(USER) ? [] : ["the user that was added is not among the users"]),
  ];

  return [...moved.map((key) => `${key} changed`), ...lost];
}

/**
 * What is wrong with the log after an update: an entry from before it that is gone, and the entry of the update itself.
 *
 * @param update - the version the install ran, and the one it took
 */
export function logFaults(before: Reading, after: Reading, update: { readonly from: string; readonly to: string }): string[] {
  const held = new Map(after.log.map((entry) => [entry.seq, entry]));
  const gone = before.log.filter((entry) => !isDeepStrictEqual(held.get(entry.seq), entry)).length;
  const known = new Set(before.log.map((entry) => entry.seq));
  const started = after.log.some((entry) => !known.has(entry.seq) && entry.action === UPDATE_ENTRY && entry.detail.from === update.from && entry.detail.to === update.to);

  return [...(gone === 0 ? [] : [`${gone} of the ${before.log.length} entries from before the update are gone or changed`]), ...(started ? [] : [`no ${UPDATE_ENTRY} entry names the update`])];
}
