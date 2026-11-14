// The Worker's environment. The names here are the `binding` names of wrangler.jsonc.

/** What Cloudflare hands the Worker on every request. */
export interface Bindings {
  /** The one bucket that holds every site's files. */
  readonly SITES: R2Bucket;

  /** The one database that holds every site's record, the tokens, the settings, and the audit log. */
  readonly DB: D1Database;

  /** The one-minute request counts of every visitor and every site. */
  readonly MINUTE_LIMITS: RateLimit;
}
