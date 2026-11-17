// Show: one site, as its owner or an admin sees it.

import type { Actor } from "../../auth/scopes";
import { dayOf } from "../../records/views";
import { nameTokens } from "../access/manage-tokens";
import { reachSite } from "../access/reach";
import type { Install, Refused } from "../records";
import { type SiteAnswer, siteObject } from "./site-object";

/** One site, and the note of each token that published a kept version of it, by the token's id. */
type SiteAnswerWithNames = SiteAnswer & { readonly names: Readonly<Record<string, string>> };

/** Why a site is not shown. */
type NotShown = Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed">;

/** Read one site with its views and, when asked for, its publishers' notes: in one question for a reference that holds the site's id, and in one more each for a public name. */
async function readSite(install: Install, actor: Actor, reference: string, publishers: boolean): Promise<SiteAnswerWithNames | NotShown> {
  const reached = await reachSite(install, actor, reference, { publishers });
  if (!reached.ok) return reached;

  const { site, settings, signed, beside } = reached;
  const views = beside?.views ?? (await install.database.readViews([site.id], dayOf(signed.at))).get(site.id) ?? null;
  const shown = siteObject(site, install, settings.trash_days, views);
  if (beside !== undefined || !publishers) return { ok: true, before: shown, site: shown, names: Object.fromEntries(beside?.publishers ?? []) };

  const named = await nameTokens(
    install,
    actor,
    site.versions.map((version) => version.published_by),
  );

  return { ok: true, before: shown, site: shown, names: named.ok ? named.names : {} };
}

/**
 * Read one site, in the trash or not, with about how often its pages were opened. Nothing changes, so `before` and `site` are the same.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 */
export async function getSite(install: Install, actor: Actor, reference: string): Promise<SiteAnswer | NotShown> {
  const read = await readSite(install, actor, reference, false);
  if (!read.ok) return read;

  const { names: unasked, ...shown } = read;

  return shown;
}

/**
 * Read one site as `getSite` does and, for an admin, name whoever published its kept versions: what a screen writes where a token published something.
 *
 * @returns the site, with `names` holding the note of each such token that has one, by the token's id, removed or not; no name for anyone but an admin
 */
export async function getSiteWithNames(install: Install, actor: Actor, reference: string): Promise<SiteAnswerWithNames | NotShown> {
  return readSite(install, actor, reference, actor.scope === "admin");
}
