// Who may act on a site: the two scopes a credential can carry and the one decision made from them.

import type { Holder } from "../records/fields";

/** What a credential is allowed to reach; there is no third value. */
export type Scope = "publisher" | "admin";

/** Whoever presents a credential. `holder` is the token's id, or the email behind a session. */
export type Actor = { readonly scope: Scope; readonly holder: Holder };

/**
 * Decide whether an actor may read or change a site.
 *
 * @param owner - the holder that made the site
 * @returns `true` for an admin and for the site's owner. Making a new site needs no decision: every actor may
 */
export function mayReachSite(actor: Actor, owner: Holder): boolean {
  return actor.scope === "admin" || owner === actor.holder;
}
