// What each key poplin keeps may do: every right, by the policy it belongs to, in the name Cloudflare's list of permission groups gives it.
//
//   key      policy    allowed on                rights
//   kept     account   the install's account     usage figures, the login and who it lets in, the team's domain, the budget alert, and the Worker's code: an update the install takes by itself
//   kept     zone      the install's zone        reading the zone, its records, its routes, its redirect rules, and its bot switches; writing its WAF rules
//   upload   bucket    the install's one bucket  reading, writing, listing, and deleting its objects: Cloudflare has no narrower group that writes
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

/** The scope of a bucket's permission groups, and what the resource of one bucket starts with. */
const BUCKET_SCOPE = "com.cloudflare.edge.r2.bucket";

/** The jurisdiction Cloudflare names a bucket of none by, in the resource of a policy. */
const NO_JURISDICTION = "default";

/** Every policy of the kept key, in the order a key carries them: the scope its groups have in Cloudflare's list, its rights, and what they are allowed on, or nothing for a place the install has none of. */
const KEPT_POLICIES = [
  {
    scope: ACCOUNT_SCOPE,
    rights: [USAGE_RIGHT, "Access: Apps and Policies Write", "Access: Organizations, Identity Providers, and Groups Read", "Notifications Write", "Workers Scripts Write"],
    resource: (place) => `${ACCOUNT_SCOPE}.${place.accountId}`,
  },
  {
    scope: "com.cloudflare.api.account.zone",
    rights: ["Zone Read", "Zone Settings Read", "DNS Read", "Workers Routes Read", "Zone WAF Write", "Dynamic URL Redirects Read", "Bot Management Read"],
    resource: (place) => (place.zoneId === undefined ? undefined : `com.cloudflare.api.account.zone.${place.zoneId}`),
  },
] as const satisfies readonly Policy[];

/** The one policy of the upload key. Cloudflare takes its resource at the top of the policy, never under the account's. */
const UPLOAD_POLICIES: readonly Policy[] = [
  {
    scope: BUCKET_SCOPE,
    rights: ["Workers R2 Storage Bucket Item Write"],
    resource: (place) => (place.bucket === undefined ? undefined : `${BUCKET_SCOPE}.${place.accountId}_${place.bucket.jurisdiction ?? NO_JURISDICTION}_${place.bucket.name}`),
  },
];

/** The bucket an install keeps its files in: its name, and its jurisdiction where it was made in one. */
export interface Bucket {
  readonly name: string;
  readonly jurisdiction?: string | undefined;
}

/** A right of the kept key, in the name Cloudflare's list of permission groups gives it. */
export type KeyRight = (typeof KEPT_POLICIES)[number]["rights"][number];

/** Where a key acts: the install's account, its zone on an install that has one, and its bucket for a key of the bucket. */
export interface KeyPlace {
  readonly accountId: string;
  readonly zoneId?: string | undefined;
  readonly bucket?: Bucket | undefined;
}

/** One policy of a key before it is written for an install. */
interface Policy {
  readonly scope: string;
  readonly rights: readonly string[];
  readonly resource: (place: KeyPlace) => string | undefined;
}

/** A permission group as Cloudflare lists it. */
export interface ListedGroup {
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

/** The policies of one key, or the name of every right Cloudflare lists no group of that scope for, and then no policy. */
export type KeyPolicies = { readonly ok: true; readonly policies: KeyPolicy[] } | { readonly ok: false; readonly missing: string[] };

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

function written(table: readonly Policy[], place: KeyPlace, groups: readonly ListedGroup[]): KeyPolicies {
  const missing: string[] = [];
  const policies: KeyPolicy[] = [];

  for (const { scope, rights, resource } of table) {
    const on = resource(place);
    if (on === undefined) continue;

    const found = rights.map((right) => ({ right, id: groups.find((group) => group.name === right && (group.scopes?.includes(scope) ?? true))?.id }));
    missing.push(...found.flatMap(({ right, id }) => (id === undefined ? [right] : [])));
    policies.push({ effect: "allow", permission_groups: found.flatMap(({ id }) => (id === undefined ? [] : [{ id }])), resources: { [on]: "*" } });
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, policies };
}

/**
 * Write the policies of the kept key for one install.
 *
 * @param groups - every permission group Cloudflare lists for the account
 * @returns the policies, the zone's left out on an install with no zone
 */
export function keyPolicies(place: KeyPlace, groups: readonly ListedGroup[]): KeyPolicies {
  return written(KEPT_POLICIES, place, groups);
}

/**
 * Write the one policy of the upload key for one install: the objects of its one bucket, and nothing else of the account.
 *
 * @param place - the install's account and its bucket
 * @param groups - every permission group Cloudflare lists for the account
 * @returns the policy; none for a place that names no bucket
 */
export function uploadKeyPolicies(place: KeyPlace, groups: readonly ListedGroup[]): KeyPolicies {
  return written(UPLOAD_POLICIES, place, groups);
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
