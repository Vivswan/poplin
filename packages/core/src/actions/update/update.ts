// The notice of a newer release: what the install last learned from the project's website, set beside the version it runs.

import gt from "semver/functions/gt";
import * as v from "valibot";

import { OWN_SCHEMA } from "../../database/open";
import { isPlainVersion, UPDATE_NEWS, type UpdateCheck, type UpdateNews } from "../../records/update";
import type { SettingValues } from "../../records/settings";
import { WAY_BACK } from "./go-back";
import type { Install } from "../records";

/** A release newer than the running version, as an answer holds it. */
export const UPDATE_NOTICE = v.object({
  /** The version the install runs. */
  current: UPDATE_NEWS.entries.version,

  /** The newest released version. */
  newest: UPDATE_NEWS.entries.version,

  /** The UTC date the newest version came out, such as `2026-12-01`. */
  released: UPDATE_NEWS.entries.released,

  /** The address of its release notes. */
  notes: UPDATE_NEWS.entries.notes,

  /** Whether its schema differs from this install's own, so that updating to it changes the database, which no older poplin can read afterwards. */
  database: v.boolean(),
});

/** What an install answers about updating: the version it runs, the newer release it knows of or `null`, whether its host holds the key an update is sent with, and the version it can go back to or `null`. */
export const UPDATE_STATE = v.object({ version: v.string(), update: v.nullable(UPDATE_NOTICE), key: v.boolean(), back: v.nullable(WAY_BACK) });

/** A release newer than the running version. */
export type Update = Readonly<v.InferOutput<typeof UPDATE_NOTICE>>;

/**
 * Pick the release of a kept check that is newer than the running version. Nothing is read.
 *
 * @param current - the version the install runs
 * @returns the release, or `undefined` when none is known, the newest known is not strictly newer, or either version is not of the form `1.2.3`
 */
export function newerRelease(check: Pick<UpdateCheck, "news"> | undefined, current: string): UpdateNews | undefined {
  const news = check?.news ?? null;
  if (news === null) return undefined;

  if (!isPlainVersion(news.version) || !isPlainVersion(current) || !gt(news.version, current)) return undefined;

  return news;
}

/**
 * Whether a release's schema differs from the one this code keeps its database at.
 *
 * @returns `true` for a release that changes the database when it starts, which is never started by the install itself
 */
export function changesDatabase(release: Pick<UpdateNews, "schema">): boolean {
  return release.schema !== OWN_SCHEMA;
}

/**
 * Pick the release an install shows as newer than the running version, from what it has read already. Nothing is read.
 *
 * @param current - the version the install runs
 * @returns the newer release, or `undefined` when none is known, the newest known is not strictly newer, either version is not of the form `1.2.3`, or `update_check` is off or not stored
 */
export function updateIn(read: { readonly settings: Pick<SettingValues, "update_check"> | undefined; readonly updateCheck: Pick<UpdateCheck, "news"> | undefined }, current: string): Update | undefined {
  if (read.settings?.update_check !== true) return undefined;

  const newer = newerRelease(read.updateCheck, current);
  if (newer === undefined) return undefined;

  return { current, newest: newer.version, released: newer.released, notes: newer.notes, database: changesDatabase(newer) };
}

/**
 * Say whether a newer poplin than the running one is out, from what the install last learned. Nothing is fetched: it reads the database once at most.
 *
 * @param current - the version the install runs
 * @param known - the settings, from a caller that has read them already; read here in one step with the last asking when neither it nor the install holds them
 * @returns the newer release, or `undefined` when none is known, the newest known is not strictly newer, either version is not of the form `1.2.3`, or `update_check` is off
 */
export async function updateOf(install: Pick<Install, "database" | "knownSettings">, current: string, known?: Pick<SettingValues, "update_check">): Promise<Update | undefined> {
  const settings = known ?? install.knownSettings;
  if (settings === undefined) return updateIn(await install.database.readSettingsAndUpdateCheck(), current);

  if (!settings.update_check) return undefined;

  return updateIn({ settings, updateCheck: await install.database.readUpdateCheck() }, current);
}
