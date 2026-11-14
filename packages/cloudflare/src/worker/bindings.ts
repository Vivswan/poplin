// The Worker's environment. The names here are the `binding` names of wrangler.jsonc.

/** What Cloudflare hands the Worker on every request. */
export interface Bindings {
  /** The one bucket that holds every site's files. */
  readonly SITES: R2Bucket;

  /** The one database that holds every site's record, the tokens, the settings, and the audit log. */
  readonly DB: D1Database;

  /** The one-minute request counts of every visitor and every site. */
  readonly MINUTE_LIMITS: RateLimit;

  /** The install's zone values, unchecked: the domain, and the public word when the install chose one. */
  readonly ZONE: unknown;

  /** Every setting in its text form, unchecked: what the Worker stores while it has no settings, and never reads once it has them. */
  readonly FIRST_SETTINGS: unknown;

  /** The Access application in front of the login path and of every private site, unchecked: the team's domain and the application's audience tag. */
  readonly ACCESS: unknown;
}
