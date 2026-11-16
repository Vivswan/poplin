// Whether a site an install holds is still what a publish of one folder with one set of settings would leave, so a reset keeps it and writes nothing.
//
//   the settings   who may open it, the public name, the typed title, the switches, the side of the trash and how long it stays there, the versions by their numbers, the expiry
//   the files      the entry page's own title, and every kept version: as many files and bytes as the folder holds, and each file's media type and bytes
//
// The folder is read as a publish reads it, by the CLI's own plan of one.
// Nothing here lists the bucket or writes a row: the versions are read with the site, and each file by its path.

import { DAY_MS, type SiteObject } from "@poplin/core/src/actions/site-object";
import { readExpires } from "@poplin/core/src/actions/changes";
import type { SiteAccess } from "@poplin/core/src/records/site";
import * as v from "valibot";

import type { Client, Failure } from "../../../../cli/src/client/client";
import { parseCommand } from "../../../../cli/src/commands/parse-command";
import { type PublishPlan, planPublish } from "../../../../cli/src/commands/publish";
import type { Io } from "../../../../cli/src/commands/records";
import { callUnhurried } from "../../../../cli/src/commands/upload";
import type { Stop } from "./util";

/** The code the API refuses a file with that a version does not hold. */
const NOT_FOUND = "not_found";

/** A name for the plan of a publish that is never sent: a plan of a new site needs one. */
const PLANNED = "planned";

/** What is read of a site as a backup holds it: the title of its entry page, which a listing hides behind a typed one, and what each kept version holds. */
const STORED = v.object({ site: v.object({ page_title: v.nullable(v.string()), versions: v.pipe(v.array(v.object({ number: v.number(), files: v.number(), bytes: v.number() })), v.readonly()) }) });

/** What a publish leaves of a site. */
export interface Wanted {
  /** Who may open it, with its public name where it is public. */
  readonly reach: SiteAccess;

  /** The title typed for it; `undefined` for a site that shows its entry page's own. */
  readonly title: string | undefined;

  /** Whether another site may frame it; `undefined` where the publish leaves that as it is. */
  readonly embeddable: boolean | undefined;

  /** Whether search engines may list it; `undefined` where the publish leaves that as it is. */
  readonly searchEngines: boolean | undefined;

  /** When it runs out, as the publish is told: `never`, or a span such as `7d`. */
  readonly expires: string;

  /** Whether it is in the trash. */
  readonly trashed: boolean;

  /** How many versions it keeps and the number of the newest, each published from the folder; `live` for a site whose live version alone is the folder's, whatever its number. */
  readonly versions: { readonly kept: number; readonly newest: number } | "live";

  /** The folder it is published from. */
  readonly folder: string;
}

/** An install as an admin's token reaches it. */
interface Reached {
  readonly client: Client;
  readonly io: Io;
}

/** Why a call got no answer to use, in words that quote nothing the install said. */
function stopped(what: string, failure: Failure): Stop {
  const status = "status" in failure ? ` with status ${failure.status}` : "";

  return { kind: "failed", what: `${what} (${failure.kind}${status})` };
}

/** Whether a site runs out when a publish told just now would make it: never, or within the span and more than a day away, so a kept site outlasts the day. */
function sameExpiry(expires: SiteObject["expires"], wanted: string, now: number): boolean {
  const span = readExpires(wanted, 0);
  if (span === "never" || span === undefined) return expires === span;

  if (expires === "never") return false;

  const left = expires - now;

  return left > DAY_MS && left <= span;
}

/** Whether a site keeps the versions a run of publishes leaves: every number from the newest down, as many as are kept, and no other. */
function sameNumbers(versions: SiteObject["versions"], wanted: { readonly kept: number; readonly newest: number }): boolean {
  const numbers = versions.map((version) => version.number).sort((one, other) => other - one);

  return numbers.length === wanted.kept && numbers.every((number, at) => number === wanted.newest - at);
}

/** Whether a site's own record is what the publish leaves: every setting the publish sets, the side of the trash, and the newest version live. A site in the trash is that only while it stays there for more than a day, as one trashed just now does. */
function sameSettings(site: SiteObject, wanted: Wanted, now: number): boolean {
  const publicName = wanted.reach.access === "public" ? wanted.reach.public_name : null;
  const newest = Math.max(...site.versions.map((version) => version.number));

  return (
    site.access === wanted.reach.access &&
    site.public_name === publicName &&
    site.title_typed === (wanted.title !== undefined) &&
    (wanted.title === undefined || site.title === wanted.title) &&
    (wanted.embeddable === undefined || site.embeddable === wanted.embeddable) &&
    (wanted.searchEngines === undefined || site.search_engines === wanted.searchEngines) &&
    (site.state === "trash") === wanted.trashed &&
    (site.gone_on === undefined || site.gone_on - now > DAY_MS) &&
    (wanted.versions === "live" || sameNumbers(site.versions, wanted.versions)) &&
    site.live_version === newest &&
    sameExpiry(site.expires, wanted.expires, now)
  );
}

/** Whether one version holds a file as the folder holds it: under the same path, with the same media type and the same bytes. */
async function sameFile(reached: Reached, at: { readonly site: string; readonly version: number }, file: PublishPlan["files"][number]): Promise<boolean | Stop> {
  const stored = await callUnhurried(reached.io, () => reached.client.download({ ...at, path: file.path }));
  if (!stored.ok && stored.failure.kind === "refused" && stored.failure.code === NOT_FOUND) return false;

  if (!stored.ok) return stopped("the install did not hand out a file of a site", stored.failure);

  const [held, local] = await Promise.all([new Response(stored.value.body).bytes(), new Response(file.open()).bytes()]);

  return stored.value.contentType === file.contentType && Buffer.from(held).equals(local);
}

/** What a publish of a folder would send: its files, their bytes together, and the entry page's own title; `undefined` for a folder no publish takes, or once the run is stopped. */
async function planOf(folder: string, stopped: AbortSignal): Promise<PublishPlan | undefined> {
  const asked = parseCommand(["publish", folder, "--name", PLANNED]);
  if (asked.kind !== "publish" || asked.target.kind !== "create") return undefined;

  const planned = await planPublish({ ...asked, target: asked.target }, stopped);

  return planned.ok ? planned.plan : undefined;
}

/** Whether the site stores the folder's page title, and the versions asked about each hold the folder's files and no other: the counts say that none is beside them, and each file is read. */
async function sameFiles(reached: Reached, site: SiteObject, wanted: Wanted): Promise<boolean | Stop> {
  const folder = await planOf(wanted.folder, reached.io.stopped);
  if (reached.io.stopped.aborted) return stopped("the run was stopped while a folder was read", { kind: "stopped" });

  if (folder === undefined) return { kind: "failed", what: "a folder a site is published from could not be read" };

  const stored = await callUnhurried(reached.io, () => reached.client.call(STORED, (api) => api.export.sites[":site"].$get({ param: { site: site.id }, query: { all_versions: "true" } })));
  if (!stored.ok) return stopped("the install did not show the versions of a site", stored.failure);

  if (stored.value.site.page_title !== (folder.manifest.page_title ?? null)) return false;

  const versions = stored.value.site.versions.filter((version) => wanted.versions !== "live" || version.number === site.live_version);
  if (versions.some((version) => version.files !== folder.files.length || version.bytes !== folder.bytes)) return false;

  for (const version of versions) {
    for (const file of folder.files) {
      const same = await sameFile(reached, { site: site.id, version: version.number }, file);
      if (same !== true) return same;
    }
  }

  return true;
}

/**
 * Say whether a site of an install is what a publish would leave in its place.
 *
 * @param site - the site as a listing of the install answers it
 * @param now - the moment its expiry is counted from, in milliseconds
 * @returns `true` only for a site that differs in no setting, no version, and no byte of a file; or why the install could not be asked
 */
export async function isSameSite(reached: Reached, site: SiteObject, wanted: Wanted, now: number): Promise<boolean | Stop> {
  if (!sameSettings(site, wanted, now)) return false;

  return sameFiles(reached, site, wanted);
}
