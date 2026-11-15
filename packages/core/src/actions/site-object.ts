// The site object: the one shape in which every action answers with a site.

import * as v from "valibot";

import { COUNT, HOLDER, MOMENT, POSITIVE, PUBLIC_NAME, SITE_ID, SITE_LABEL, SITE_NAME } from "../records/fields";
import type { SettingValues } from "../records/settings";
import { ACCESSES, type Site } from "../records/site";
import { SITE_VIEWS, type SiteViews } from "../records/views";
import { siteLabel } from "../sites/labels";
import type { Install } from "./records";

/** How many milliseconds a day holds. */
export const DAY_MS = 86_400_000;

/** A site as an answer holds it. */
export const SITE_OBJECT = v.object({
  id: SITE_ID,
  label: SITE_LABEL,
  name: SITE_NAME,
  public_name: v.nullable(PUBLIC_NAME),
  title: v.nullable(v.string()),
  title_typed: v.boolean(),
  access: v.picklist(ACCESSES),
  url: v.string(),
  addresses: v.object({ site: v.string(), public: v.nullable(v.string()) }),
  search_engines: v.boolean(),
  embeddable: v.boolean(),
  expires: v.union([v.literal("never"), MOMENT]),
  versions: v.pipe(v.array(v.object({ number: POSITIVE, published: MOMENT, published_by: HOLDER })), v.readonly()),
  live_version: POSITIVE,
  bytes: COUNT,
  files: COUNT,
  updated: MOMENT,
  state: v.picklist(["live", "trash"]),
  views: v.nullable(SITE_VIEWS),
  gone_on: v.optional(MOMENT),
});

/** What an action on one site answers: the site as the action found it, and the site after it. */
export const SITE_ANSWER = v.object({ before: v.nullable(SITE_OBJECT), site: SITE_OBJECT });

/**
 * A site as a caller sees it. Times are milliseconds since the epoch.
 *
 * `url` is the one address to hand to a person: the public one for a public site, the label's otherwise.
 * The label's address carries a letter for the access, so it changes when a site turns private or stops being private. `bytes` and `files` sum the kept versions, and `updated` is when the site last changed.
 * `gone_on` is when a site in the trash is deleted for good, and is absent outside the trash.
 * `title` is the typed title, and the entry page's own while none is typed; `title_typed` says which.
 * `views` is about how often the site's pages were opened, today and over the last seven UTC days: estimates from a sample, never exact counts. Only showing and listing read them; every other answer has `null`.
 */
export type SiteObject = Readonly<v.InferOutput<typeof SITE_OBJECT>>;

/**
 * An action done. `site` is the site after it, and `before` the site as the action found it: `null` when the action made the site.
 *
 * `before` is read when the action starts, a moment ahead of the change itself.
 */
export type SiteAnswer = { readonly ok: true } & Readonly<v.InferOutput<typeof SITE_ANSWER>>;

/**
 * Build the site object of a stored site.
 *
 * @param trashDays - the install's `trash_days` setting
 * @param views - the site's page views as the database counted them, `null` when they were not read
 */
export function siteObject(site: Site, install: Pick<Install, "addressOf" | "publicAddressOf">, trashDays: number, views: SiteViews | null = null): SiteObject {
  const label = siteLabel(site.name, site.id);
  const publicName = site.access === "public" ? site.public_name : null;
  const addresses = { site: install.addressOf(label, site.access), public: publicName === null ? null : install.publicAddressOf(publicName) };

  const object: SiteObject = {
    id: site.id,
    label,
    name: site.name,
    public_name: publicName,
    title: site.title ?? site.page_title,
    title_typed: site.title !== null,
    access: site.access,
    url: addresses.public ?? addresses.site,
    addresses,
    search_engines: site.search_engines,
    embeddable: site.embeddable,
    expires: site.expires,
    versions: site.versions.map((version) => ({ number: version.number, published: version.published_at, published_by: version.published_by })),
    live_version: site.live_version,
    bytes: site.versions.reduce((sum, version) => sum + version.bytes, 0),
    files: site.versions.reduce((sum, version) => sum + version.files, 0),
    updated: site.updated_at,
    state: site.state,
    views,
  };
  if (site.state !== "trash") return object;

  return { ...object, gone_on: site.trashed_at + trashDays * DAY_MS };
}

/**
 * Build the answer of an action on a site.
 *
 * @param sites - the site as the action found it, `null` for a site the action made, and the site after the action
 */
export function siteAnswer(sites: { readonly before: Site | null; readonly after: Site }, install: Pick<Install, "addressOf" | "publicAddressOf">, settings: SettingValues): SiteAnswer {
  const before = sites.before === null ? null : siteObject(sites.before, install, settings.trash_days);

  return { ok: true, before, site: siteObject(sites.after, install, settings.trash_days) };
}
