// The login in front of the install put back with the key poplin keeps: the two Access applications with their policies, then the variable the Worker checks a login's token against. It is the code a repair runs for those pieces.
//
//   every piece stands                      nothing written
//   a piece is missing or differs           written, under "Access: Apps and Policies Write" and "Workers Scripts Write"
//   Access is switched off for the account  access_off: only a click at Cloudflare switches it on
//   Cloudflare names no team for the login  no_team, and the variable is left as it was
//   the account has no login method that    no_login_method, once the rest is repaired: the key may read the methods and make none.
//   mails a code                            One without passkeys is no refusal: the application then offers the code alone
//   the key is absent, refused, lacks       the key's own refusal
//   the right, or no answer came
//
// A repair that stopped has kept what it wrote before, and says so beside its refusal.
// No record, route, rule, or database is read or changed: the key holds no right to write those, and a repair with a token does.
// No answer carries the key or a text Cloudflare sent.

import type { KeyRefusal } from "@poplin/app/src/console/key/records";
import { type Login, parseLogins } from "@poplin/core/src/auth/logins";
import type { Hostname } from "@poplin/core/src/names/hostname";
import { isAccessOff, readLoginFacts, syncAccess } from "./access";
import { CODE_METHOD, type HeldMethods, offeredMethods, readLoginMethods } from "./login-method";
import type { CloudflareResult } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import type { Report } from "../../sync";
import { syncVariables } from "../variables/variables";
import { type KeptKey, keyed } from "../../key/kept-key";

/** Cloudflare's name of the right the applications and their policies are read and written under. */
const ACCESS_RIGHT = "Access: Apps and Policies Write";

/** Cloudflare's name of the right the team's domain and the account's login methods are read under. */
const TEAM_RIGHT = "Access: Organizations, Identity Providers, and Groups Read";

/** Cloudflare's name of the right the Worker's variables are read and written under. */
const WORKER_RIGHT = "Workers Scripts Write";

/** Where the login stands: the account, the Worker, the dashboard's hostname, and what the login guards as the private sites. */
interface LoginPlace {
  readonly accountId: string;
  readonly script: string;
  readonly adminHost: Hostname;
  readonly privateSites: string;
}

/** What a repair of the login came to. */
interface Repaired {
  /** The name of every piece the repair wrote: of the applications and policies those it made and then those it changed, and the variable last. */
  readonly wrote: readonly string[];

  /** Whether the policy that lets the install's users through is among them. */
  readonly users: boolean;

  /** How many requests the repair sent, each try of one counted: those to Cloudflare, and the one the SDK asks itself before its first form. */
  readonly calls: number;

  /** Why the repair stopped; left out where the login stands as the users ask. `bad_users` is stored users that are no list of emails, and `no_login_method` an account with no method that mails a code, which the key may not make: the rest was repaired. */
  readonly refusal?: KeyRefusal | "access_off" | "no_team" | "bad_users" | "no_login_method";
}

/** The install's way to put its own login back. */
export interface LoginRepair {
  /** Whether the install holds a key to repair with. No call to Cloudflare. */
  holdsKey(): boolean;

  /** Make the login match the given users. It throws for nothing Cloudflare answers, and no answer holds the key. */
  repair(emails: readonly Login[]): Promise<Repaired>;
}

/** The names of what a step of a repair wrote, whether it finished or stopped. */
function written(report: Report): string[] {
  return [...report.created, ...report.changed];
}

/** The key with every request it sends counted in `sent`. */
function countingKey(key: KeptKey, sent: { calls: number }): KeptKey {
  const send = key.connection.fetch ?? ((input, init) => fetch(input, init));

  return {
    connection: {
      ...key.connection,
      fetch: (input, init) => {
        sent.calls += 1;

        return send(input, init);
      },
    },
  };
}

/** Read the account's login methods with the key. An account whose Access is off answers this read as it answers the applications', which say so: it has none to name. */
function heldMethods(key: KeptKey | undefined, accountId: string): ReturnType<typeof keyed<HeldMethods>> {
  return keyed(key, TEAM_RIGHT, async (connection): Promise<CloudflareResult<HeldMethods>> => {
    const read = await readLoginMethods(connection, accountId);

    return !read.ok && isAccessOff(read) ? { ok: true, value: {} } : read;
  });
}

/** Write the two applications and their policies with the key, and note in `wrote` what was written; `off` for an account whose Access is switched off. */
function writeAccess(key: KeptKey | undefined, accountId: string, desired: Parameters<typeof syncAccess>[2], wrote: string[]): ReturnType<typeof keyed<"made" | "off">> {
  return keyed(key, ACCESS_RIGHT, async (connection): Promise<CloudflareResult<"made" | "off">> => {
    const synced = await syncAccess(connection, accountId, desired, "apply");
    wrote.push(...written(synced.report));
    if (synced.ok) return { ok: true, value: "made" };

    return isAccessOff(synced) ? { ok: true, value: "off" } : synced;
  });
}

/** Write the variable the Worker checks a login's token against with the key, and note in `wrote` what was written. */
function writeVariable(key: KeptKey | undefined, worker: Pick<LoginPlace, "accountId" | "script">, wanted: Parameters<typeof syncVariables>[2], wrote: string[]): ReturnType<typeof keyed<undefined>> {
  return keyed(key, WORKER_RIGHT, async (connection): Promise<CloudflareResult<undefined>> => {
    const synced = await syncVariables(connection, worker, wanted, "apply");
    wrote.push(...written(synced.report));

    return synced.ok ? { ok: true, value: undefined } : synced;
  });
}

/**
 * Write the login with the key: the applications with their policies, then the variable the Worker checks a login's token against, read from the application.
 *
 * @param wrote - gets the name of every piece that was written, whether the writing finished or stopped
 * @returns why the writing stopped, or `undefined` once the login stands
 */
async function writeLogin(key: KeptKey | undefined, place: LoginPlace, desired: Parameters<typeof syncAccess>[2], wrote: string[]): Promise<Repaired["refusal"]> {
  const { accountId, script } = place;
  const access = await writeAccess(key, accountId, desired, wrote);
  if (!access.ok) return access.refusal;

  if (access.value === "off") return "access_off";

  const facts = await keyed(key, TEAM_RIGHT, (connection) => readLoginFacts(connection, accountId));
  if (!facts.ok) return facts.refusal;

  const login = facts.value;
  if (login === undefined) return "no_team";

  const wanted = [{ name: INSTALL_OBJECTS.accessBinding, value: { team_domain: login.teamDomain, audience: login.audience } }];
  const variable = await writeVariable(key, { accountId, script }, wanted, wrote);

  return variable.ok ? undefined : variable.refusal;
}

/**
 * Make the install's way to repair its own login.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers every repair `no_key` and calls nothing
 * @returns the login's side at Cloudflare. A repair that stopped at the variable has left the applications standing
 */
export function createLoginRepair(key: KeptKey | undefined, place: LoginPlace): LoginRepair {
  const { accountId, adminHost, privateSites } = place;

  return {
    holdsKey: () => key !== undefined,

    async repair(emails) {
      const wrote: string[] = [];
      const sent = { calls: 0 };
      const counting = key === undefined ? undefined : countingKey(key, sent);
      const ended = (refusal: Repaired["refusal"]): Repaired => ({ wrote, users: wrote.includes(INSTALL_OBJECTS.accessPolicy), calls: sent.calls, ...(refusal === undefined ? {} : { refusal }) });

      const users = parseLogins(emails);
      if (!users.ok) return ended("bad_users");

      const held = await heldMethods(counting, accountId);
      if (!held.ok) return ended(held.refusal);

      const refusal = await writeLogin(counting, place, { hostname: adminHost, users: users.value, privateSites, methods: offeredMethods(held.value) }, wrote);
      // On an account with no method that mails a code no user gets one, though the rest of the login stands.
      const noCode = held.value[CODE_METHOD] === undefined ? "no_login_method" : undefined;

      return ended(refusal ?? noCode);
    },
  };
}
