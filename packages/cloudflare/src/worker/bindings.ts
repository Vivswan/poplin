// The Worker's environment. The names here are the `binding` names of wrangler.jsonc.

/** What Cloudflare hands the Worker on every request. */
export interface Bindings {
  /** The one bucket that holds every site's files. */
  readonly SITES: R2Bucket;

  /** The one database that holds every site's record, the tokens, the settings, and the audit log. */
  readonly DB: D1Database;

  /** The one-minute request counts of every visitor and every site. */
  readonly MINUTE_LIMITS: RateLimit;

  /** The zone values of an install with a domain, unchecked: the domain, and the public word when the install chose one. Absent on a Worker bound to no zone. */
  readonly ZONE: unknown;

  /** Every setting in its text form, unchecked: what the Worker stores while it has no settings. Absent on a Worker that setup gives its settings. */
  readonly FIRST_SETTINGS: unknown;

  /** The Access application in front of the login path, unchecked: the team's domain and the application's audience tag. */
  readonly ACCESS: unknown;
}
