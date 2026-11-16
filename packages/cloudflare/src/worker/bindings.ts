// The Worker's environment. The first four names are the `binding` names of wrangler.jsonc; the rest are variables set on the Worker, and one secret.

import type { Job } from "@poplin/core/src/jobs/jobs";

/** What Cloudflare hands the Worker on every request. */
export interface Bindings {
  /** The one bucket that holds every site's files. */
  readonly SITES: R2Bucket;

  /** The one database that holds every site's record, the tokens, the settings, and the audit log. */
  readonly DB: D1Database;

  /** The one-minute request counts of every visitor and every site. */
  readonly MINUTE_LIMITS: RateLimit;

  /** The Workflow that runs the install's jobs. A Worker deployed without it has none, and runs each round of a job in the request that asks after it. */
  readonly JOBS?: Workflow<Job>;

  /** Where the install answers, unchecked: its domain and the public word it chose, or the account's name in its free address on an install without a domain. Setup or the OpenTofu module writes it; a Worker without it answers setup alone. */
  readonly ZONE: unknown;

  /** The first settings in their text form, unchecked: the logins, and any other setting that does not start at its default. The Worker stores them while it has no settings, and never reads them once it has. */
  readonly FIRST_SETTINGS: unknown;

  /** The Access application in front of the dashboard and of every private site, unchecked: the team's domain and the application's audience tag. Setup writes it; a Worker without it answers setup alone. */
  readonly ACCESS: unknown;

  /** The id of the Cloudflare account the Worker runs in, unchecked. Setup writes it beside the domain, and from then on acts on that account alone. */
  readonly ACCOUNT_ID: unknown;

  /** The Worker's own name, unchecked: the name its routes name and its variables are written under. */
  readonly WORKER_NAME: unknown;

  /** The key poplin keeps for the Cloudflare API, unchecked: a secret of the Worker, which no deploy names and none removes. A Worker without it holds no key. */
  readonly KEPT_KEY: unknown;
}
