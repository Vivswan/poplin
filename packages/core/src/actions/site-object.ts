// The site object: the one shape in which every action answers with a site.

import type { PublicName, SiteName } from "../names/names";
import type { Holder } from "../records/fields";
import type { SettingValues } from "../records/settings";
import type { Site } from "../records/site";
import type { SiteId } from "../sites/ids";
import { type SiteLabel, siteLabel } from "../sites/labels";
import type { Install } from "./records";

/** How many milliseconds a day holds. */
export const DAY_MS = 86_400_000;

/**
 * A site as a caller sees it. Times are milliseconds since the epoch.
 *
 * `url` is the one address to hand to a person: the public one for a public site, the label's otherwise. `gone_on` is when a site in the trash is deleted for good, and is absent outside the trash.
 */
export interface SiteObject {
  readonly id: SiteId;
  readonly label: SiteLabel;
  readonly name: SiteName;
  readonly public_name: PublicName | null;
  readonly title: string | null;
  readonly access: Site["access"];
  readonly url: string;
  readonly addresses: { readonly site: string; readonly public: string | null };
  readonly search_engines: boolean;
  readonly embeddable: boolean;
  readonly expires: "never" | number;
  readonly versions: readonly { readonly number: number; readonly published: number; readonly published_by: Holder }[];
  readonly live_version: number;
  readonly state: Site["state"];
  readonly gone_on?: number;
}

/**
 * An action done. `site` is the site after it, and `before` the site as the action found it: `null` when the action made the site.
 *
 * `before` is read when the action starts, a moment ahead of the change itself.
 */
export interface SiteAnswer {
  readonly ok: true;
  readonly before: SiteObject | null;
  readonly site: SiteObject;
}

/**
 * Build the site object of a stored site.
 *
 * @param trashDays - the install's `trash_days` setting
 */
export function siteObject(site: Site, install: Pick<Install, "addressOf">, trashDays: number): SiteObject {
  const label = siteLabel(site.name, site.id);
  const publicName = site.access === "public" ? site.public_name : null;
  const addresses = { site: install.addressOf(label), public: publicName === null ? null : install.addressOf(publicName) };

  const object: SiteObject = {
    id: site.id,
    label,
    name: site.name,
    public_name: publicName,
    title: site.title,
    access: site.access,
    url: addresses.public ?? addresses.site,
    addresses,
    search_engines: site.search_engines,
    embeddable: site.embeddable,
    expires: site.expires,
    versions: site.versions.map((version) => ({ number: version.number, published: version.published_at, published_by: version.published_by })),
    live_version: site.live_version,
    state: site.state,
  };
  if (site.state !== "trash") return object;

  return { ...object, gone_on: site.trashed_at + trashDays * DAY_MS };
}

/**
 * Build the answer of an action on a site.
 *
 * @param sites - the site as the action found it, `null` for a site the action made, and the site after the action
 */
export function siteAnswer(sites: { readonly before: Site | null; readonly after: Site }, install: Pick<Install, "addressOf">, settings: SettingValues): SiteAnswer {
  const before = sites.before === null ? null : siteObject(sites.before, install, settings.trash_days);

  return { ok: true, before, site: siteObject(sites.after, install, settings.trash_days) };
}
