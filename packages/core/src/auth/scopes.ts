// Who may act on a site: the two scopes a credential can carry and the one decision made from them.

/** What a credential is allowed to reach; there is no third value. */
export type Scope = "publisher" | "admin";

/** `publish` creates a site or replaces it in place; `manage` is every other verb on an existing site. */
export type SiteAction = "publish" | "manage";

/** Whoever presents a credential. `holder` is the token's id, or the email behind a session. */
export type Actor = { readonly scope: Scope; readonly holder: string };

/** Why an action was refused: the name belongs to someone else, or the site is not the actor's. */
type ScopeRefusal = "taken" | "not-owner";

/** Whether the action may go ahead, or why not. */
export type Verdict = { readonly ok: true } | { readonly ok: false; readonly refusal: ScopeRefusal };

/**
 * Read a scope from stored or sent text.
 *
 * @returns the scope, or `undefined` for anything but the two exact lowercase words
 */
export function parseScope(raw: string): Scope | undefined {
  if (raw === "publisher" || raw === "admin") return raw;

  return undefined;
}

/**
 * Decide whether an actor may do an action to a site.
 *
 * @param owner - the holder that created the site, or `undefined` when no site has the name yet
 * @returns the verdict; it says nothing on whether the site exists, so an admin managing a missing site is allowed here
 */
export function decideSiteAction(actor: Actor, action: SiteAction, owner: string | undefined): Verdict {
  if (actor.scope === "admin") return { ok: true };

  if (owner === actor.holder) return { ok: true };

  if (action === "manage") return { ok: false, refusal: "not-owner" };

  if (owner !== undefined) return { ok: false, refusal: "taken" };

  return { ok: true };
}
