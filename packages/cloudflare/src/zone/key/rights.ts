// What the key poplin keeps may do: every right, by the policy it belongs to, in the name Cloudflare's list of permission groups gives it.
//
//   policy    allowed on              rights
//   account   the install's account   usage figures, the login and who it lets in, the team's domain, the budget alert, and the Worker's code: an update the install takes by itself
//   zone      the install's zone      reading the zone, its records, its routes, its redirect rules, and its bot switches; writing its WAF rules
//
// Cloudflare takes the right to write a Worker for a whole account alone: a key limited to one Worker is refused on every call, so the key can replace any Worker of the account.
// A group is found by its name each time a key is made, so no id of Cloudflare's is written here.
//
// A token carries a right where a policy that allows it reaches the place the key acts on, in one of the forms Cloudflare writes a resource:
//
//   the place itself            { "<scope>.<id>": "*" }
//   every place of the scope    { "<scope>.*": "*" }
//   every zone of the account   { "com.cloudflare.api.account.<account id>": { "com.cloudflare.api.account.zone.*": "*" } }

/** The right the usage figures are read with. */
export const USAGE_RIGHT = "Account Analytics Read";

/** The scope of an account's own permission groups, and what every resource of an account starts with. */
const ACCOUNT_SCOPE = "com.cloudflare.api.account";

/** Every policy of the key, in the order a key carries them: the scope its groups have in Cloudflare's list, its rights, and what they are allowed on, or nothing for a place the install has none of. */
const POLICIES = [
  {
    scope: ACCOUNT_SCOPE,
    rights: [USAGE_RIGHT, "Access: Apps and Policies Write", "Access: Organizations, Identity Providers, and Groups Read", "Notifications Write", "Workers Scripts Write"],
    resource: (place: KeyPlace): string | undefined => `${ACCOUNT_SCOPE}.${place.accountId}`,
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

/** One policy of a token as Cloudflare lists it. */
interface ListedPolicy {
  readonly effect?: string;
  readonly permission_groups?: readonly { readonly id?: string }[];
  readonly resources?: Readonly<Record<string, unknown>>;
}

/** Whether a listed policy's resources reach `on`, a place of a key, by the table at the top of this file. */
function reaches(resources: Readonly<Record<string, unknown>>, on: string, place: KeyPlace): boolean {
  const every = `${on.slice(0, on.lastIndexOf("."))}.*`;
  if (resources[on] === "*" || resources[every] === "*") return true;

  const within = resources[`${ACCOUNT_SCOPE}.${place.accountId}`];

  return typeof within === "object" && within !== null && (within as Readonly<Record<string, unknown>>)[every] === "*";
}

/**
 * Say that Cloudflare lists no group for some rights of a key, as a failed step is told.
 *
 * @param missing - the name of every such right
 */
export function noGroup(missing: readonly string[]): { readonly ok: false; readonly failure: "no-group"; readonly message: string } {
  return { ok: false, failure: "no-group", message: `Cloudflare lists no permission group named ${missing.join(", ")}` };
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

/**
 * Say whether a token carries every right of a key where the key acts.
 *
 * @param wanted - the policies of a key for `place`, as `keyPolicies` writes them
 * @param carried - the policies of the token, as Cloudflare lists them
 * @returns whether each wanted group is in a policy of the token that allows it on the wanted place. A group allowed on another account or zone, on one Worker alone, or named in a policy that denies, is not carried
 */
export function carriesRights(place: KeyPlace, wanted: readonly KeyPolicy[], carried: readonly ListedPolicy[]): boolean {
  const allowedOn = (on: string): Set<string | undefined> => {
    const reaching = carried.filter((policy) => policy.effect === "allow" && reaches(policy.resources ?? {}, on, place));

    return new Set(reaching.flatMap((policy) => (policy.permission_groups ?? []).map((group) => group.id)));
  };

  return wanted.every((policy) => {
    const allowed = Object.keys(policy.resources).map(allowedOn);

    return policy.permission_groups.every((group) => allowed.every((ids) => ids.has(group.id)));
  });
}
