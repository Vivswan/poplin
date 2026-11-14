// The site record: the small object stored beside a site, saying who may open it, which version is live, and whether it sits in the trash.

import * as v from "valibot";

import { parseSiteId } from "../sites/ids";
import { HOLDER, MOMENT, POSITIVE, REVISION, SITE_NAME } from "./fields";
import type { RecordKind } from "./kind";

/** The number a site record of the shape below is stamped with. */
const SITE_SHAPE = 1;

/** One publish that can still be gone back to. */
const VERSION = v.strictObject({ number: POSITIVE, published: MOMENT, published_by: HOLDER });

/** What a site record holds whatever its access and its state. */
const ALWAYS = {
  shape: v.literal(SITE_SHAPE),
  revision: REVISION,
  name: SITE_NAME,
  title: v.nullable(v.pipe(v.string(), v.minLength(1))),
  search_engines: v.boolean(),
  expires: v.union([v.literal("never"), MOMENT]),
  embed_from: v.array(SITE_NAME),
  live_version: POSITIVE,
  versions: v.pipe(v.array(VERSION), v.minLength(1)),
  owner: HOLDER,
};

/** Only the admins may open the site. */
const PRIVATE = { access: v.literal("private") };

/** Anyone with the secret may open the site. No other access has a secret. */
const UNLISTED = { access: v.literal("unlisted"), secret: v.custom<string>(isSecret, "a secret is 12 lowercase base36 characters") };

/** Everyone may open the site. */
const PUBLIC = { access: v.literal("public") };

/** The site is served. */
const LIVE = { state: v.literal("live") };

/** The site sits in the trash until the moment `gone_on`. No other state has that field. */
const TRASH = { state: v.literal("trash"), gone_on: MOMENT };

/** Every site record: one strict object per access and state, so a field of another access or state is refused. */
const SITE_SCHEMA = v.pipe(
  v.variant("state", [
    v.variant("access", [
      v.strictObject({ ...ALWAYS, ...LIVE, ...PRIVATE }),
      v.strictObject({ ...ALWAYS, ...LIVE, ...UNLISTED }),
      v.strictObject({ ...ALWAYS, ...LIVE, ...PUBLIC }),
    ]),
    v.variant("access", [
      v.strictObject({ ...ALWAYS, ...TRASH, ...PRIVATE }),
      v.strictObject({ ...ALWAYS, ...TRASH, ...UNLISTED }),
      v.strictObject({ ...ALWAYS, ...TRASH, ...PUBLIC }),
    ]),
  ]),
  v.check((site) => site.versions.every((version, at) => at === 0 || version.number > (site.versions[at - 1]?.number ?? 0)), "versions are kept in ascending order, each number once"),
  v.check((site) => site.versions.some((version) => version.number === site.live_version), "live_version names a kept version"),
);

/** The site record kind. */
export const SITE: RecordKind<SiteRecord> = { name: "site", shape: SITE_SHAPE, schema: SITE_SCHEMA };

/**
 * A site record in its current shape.
 *
 * `title` is the title shown on the dashboard, `null` when none is. `expires` is `"never"` or the moment the site moves to the trash.
 *
 * `owner` and `published_by` are a token's id, or an admin's email for an upload through the dashboard. Times are milliseconds since the epoch.
 */
export type SiteRecord = v.InferOutput<typeof SITE_SCHEMA>;

// A secret has the form of a site id.
function isSecret(value: unknown): boolean {
  return typeof value === "string" && parseSiteId(value).ok;
}
