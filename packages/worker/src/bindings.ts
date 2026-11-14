// The Worker's environment. The names here are the `binding` names of wrangler.jsonc.

/** What Cloudflare hands the Worker on every request. */
export interface Bindings {
  /** The one bucket that holds every site and every record. */
  readonly SITES: R2Bucket;
}
