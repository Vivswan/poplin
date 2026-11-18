// The login methods an install's users log in with, each an identity provider of the account's Zero Trust:
//
//   Cloudflare     a member of the Cloudflare account logs in with that account
//   One-time PIN   Cloudflare mails a code to the email a person types
//   Passkeys       a person who proved the email once saves a passkey, and logs in with it alone from then on
//
// Without the last two the login page offers only the methods the account has, and a user who is no member of those cannot log in.
//
//   the account has a method of the type, under any name   left as it is: it may serve the owner's other applications
//   the account has no One-time PIN, or no Passkeys        made, under the name above
//   the account has no Cloudflare                          no step: the account comes with one, so one that is gone was removed
//
// They are the account's, not the install's: nothing removes them.

import { BaseIdentityProviders, type IdentityProviderCreateParams } from "cloudflare/resources/zero-trust/identity-providers/identity-providers";
import { BaseOrganizations } from "cloudflare/resources/zero-trust/organizations/organizations";
import { type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import { applySteps, type Mode, reportOf, type Synced } from "../../sync";

/** The method of the account's own members, by the name its row has: poplin makes none, and an install is whole without it. */
export const CLOUDFLARE_METHOD = INSTALL_OBJECTS.cloudflareMethod;

/** The method no install is whole without, by the name its row has. */
export const CODE_METHOD = INSTALL_OBJECTS.codeMethod;

/** The method an account may be refused, by the name its row has: an install is whole without it. */
export const PASSKEY_METHOD = INSTALL_OBJECTS.passkeyMethod;

/** Each method, in the order of its row: its name, Cloudflare's type of its identity provider, and the configuration one that poplin makes is sent with; `undefined` for the one poplin never makes. */
const METHODS = [
  { name: CLOUDFLARE_METHOD, type: "cloudflare", config: undefined },
  { name: CODE_METHOD, type: "onetimepin", config: {} },
  { name: PASSKEY_METHOD, type: "passkeys", config: { login_page_auto_prompt: INSTALL_OBJECTS.passkeyPrompt } },
] as const;

/** The name of a method. */
type MethodName = (typeof METHODS)[number]["name"];

/** The id of each method the account has, by the method's name. */
export type HeldMethods = Readonly<Partial<Record<MethodName, string>>>;

/** An identity provider as the account has it now. */
interface AccountMethod {
  readonly id?: string;
  readonly type?: string;
}

/** What making sure of the methods came to, with the ids of the ones the account has now. */
export type SyncedMethods = Synced & { readonly held: HeldMethods };

/**
 * Name the methods the guarded application's page is to offer.
 *
 * @param held - the methods the account has, as its list was read: an application is written with these and no other, so it never names one that is gone
 * @param pending - what stands for a method the account lacks and a repair makes: `""` in a check, and left out after a run, which names only what stands
 * @returns the ids in the order of the methods; none on an account with none of them, whose application then offers every method the account has
 */
export function offeredMethods(held: HeldMethods, pending?: ""): string[] {
  return METHODS.flatMap(({ name, config }) => held[name] ?? (config === undefined ? undefined : pending) ?? []);
}

/**
 * Find poplin's login methods among the account's identity providers, each by its type.
 *
 * Cloudflare answers a key with no right to the identity providers an empty list, and no refusal. An empty list is believed only once the team is read, which the same right allows.
 *
 * @returns the id of each one the account has, or the refusal of a key that may not read them
 */
export async function readLoginMethods(connection: Connection, accountId: string): Promise<CloudflareResult<HeldMethods>> {
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseIdentityProviders(api).list({ account_id: accountId })));
  if (!listed.ok) return listed;

  const methods: readonly AccountMethod[] = listed.value;
  if (methods.length === 0) {
    const team = await callCloudflare(connection, (api) => new BaseOrganizations(api).list({ account_id: accountId }));
    if (!team.ok) return team;
  }

  const found = METHODS.map(({ name, type }) => [name, methods.find((method) => method.type === type && method.id !== undefined)?.id] as const);

  return { ok: true, value: Object.fromEntries(found.filter(([, id]) => id !== undefined)) };
}

/**
 * Make sure the account has the login methods poplin makes, and find the one it does not.
 *
 * @param mode - `plan` reads the account's identity providers and sends no change
 * @returns one step a method, under its name: left where the account has one of the type, else created, and none for the one poplin never makes where the account has none.
 * A refusal is a value with the report of what was done before it, and `held` has the methods that stand whatever came of the run
 */
export async function syncLoginMethods(connection: Connection, accountId: string, mode: Mode): Promise<SyncedMethods> {
  const read = await readLoginMethods(connection, accountId);
  if (!read.ok) return { ...read, report: reportOf([]), held: {} };

  const held: Partial<Record<MethodName, string>> = { ...read.value };
  const steps = METHODS.flatMap((method) => {
    if (held[method.name] !== undefined) return { kind: "leave", subject: method.name } as const;

    return method.config === undefined ? [] : ({ kind: "create", subject: method.name, method } as const);
  });
  const synced = await applySteps(
    steps,
    async ({ method }) => {
      // @ts-expect-error The SDK's types lack the type of the passkeys' identity provider and its configuration.
      const body: IdentityProviderCreateParams = { account_id: accountId, name: method.name, type: method.type, config: method.config };
      const made = await callCloudflare(connection, (api) => new BaseIdentityProviders(api).create(body));
      if (made.ok && made.value.id !== undefined) held[method.name] = made.value.id;
      if (made.ok || made.failure !== "refused") return made;

      // Cloudflare takes one method of a type an account: a refusal for one a list had not shown yet leaves it standing.
      const again = await readLoginMethods(connection, accountId);
      const id = again.ok ? again.value[method.name] : undefined;
      if (id === undefined) return made;

      held[method.name] = id;

      return { ok: true, value: undefined };
    },
    mode,
  );

  return { ...synced, held };
}
