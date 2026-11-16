// What the key poplin keeps may do: every right, by the policy it belongs to, in the name Cloudflare's list of permission groups gives it.
//
//   policy    allowed on              rights
//   account   the install's account   usage figures, the login and who it lets in, the team's domain, the budget alert
//   zone      the install's zone      reading the zone, its records, its routes, its redirect rules, and its bot switches; writing its WAF rules
//
// A group is found by its name each time a key is made, so no id of Cloudflare's is written here.

/** The right the usage figures are read with. */
export const USAGE_RIGHT = "Account Analytics Read";

/** Every policy of the key, in the order a key carries them: the scope its groups have in Cloudflare's list, its rights, and what they are allowed on, or nothing for a place the install has none of. */
const POLICIES = [
  {
    scope: "com.cloudflare.api.account",
    rights: [USAGE_RIGHT, "Access: Apps and Policies Write", "Access: Organizations, Identity Providers, and Groups Read", "Notifications Write"],
    resource: (place: KeyPlace): string | undefined => `com.cloudflare.api.account.${place.accountId}`,
  },
  {
    scope: "com.cloudflare.api.account.zone",
    rights: ["Zone Read", "Zone Settings Read", "DNS Read", "Workers Routes Read", "Zone WAF Write", "Dynamic URL Redirects Read", "Bot Management Read"],
    resource: (place: KeyPlace): string | undefined => (place.zoneId === undefined ? undefined : `com.cloudflare.api.account.zone.${place.zoneId}`),
  },
] as const;

/** Where a key acts: the install's account, and its zone on an install that has one. */
export interface KeyPlace {
  readonly accountId: string;
  readonly zoneId?: string | undefined;
}

/** A permission group as Cloudflare lists it. */
interface ListedGroup {
  readonly id?: string;
  readonly name?: string;
  readonly scopes?: readonly string[];
}

/** One policy as a new key is sent with it. */
interface KeyPolicy {
  readonly effect: "allow";
  readonly permission_groups: { readonly id: string }[];
  readonly resources: Record<string, string>;
}

/**
 * Write the policies of a key for one install.
 *
 * @param groups - every permission group Cloudflare lists for the account
 * @returns the policies, the zone's left out on an install with no zone; or the name of every right Cloudflare lists no group of that scope for, and then no policy
 */
export function keyPolicies(place: KeyPlace, groups: readonly ListedGroup[]): { readonly ok: true; readonly policies: KeyPolicy[] } | { readonly ok: false; readonly missing: string[] } {
  const missing: string[] = [];
  const policies: KeyPolicy[] = [];

  for (const { scope, rights, resource } of POLICIES) {
    const on = resource(place);
    if (on === undefined) continue;

    const found = rights.map((right) => ({ right, id: groups.find((group) => group.name === right && (group.scopes?.includes(scope) ?? true))?.id }));
    missing.push(...found.flatMap(({ right, id }) => (id === undefined ? [right] : [])));
    policies.push({ effect: "allow", permission_groups: found.flatMap(({ id }) => (id === undefined ? [] : [{ id }])), resources: { [on]: "*" } });
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, policies };
}
