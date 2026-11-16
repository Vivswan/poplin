// The login in front of the install put back with the key poplin keeps: the two Access applications with their policies, then the variable the Worker checks a login's token against. It is the code a repair runs for those pieces.
//
//   every piece stands                      nothing written
//   a piece is missing or differs           written, under "Access: Apps and Policies Write" and "Workers Scripts Write"
//   Access is switched off for the account  access_off: only a click at Cloudflare switches it on
//   Cloudflare names no team for the login  no_team, and the variable is left as it was
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
import type { CloudflareResult } from "../../client";
import { INSTALL_OBJECTS } from "../../install-objects";
import type { Report } from "../../sync";
import { syncVariables } from "../variables/variables";
import { type KeptKey, keyed } from "../../key/kept-key";

/** Cloudflare's name of the right the applications and their policies are read and written under. */
const ACCESS_RIGHT = "Access: Apps and Policies Write";

/** Cloudflare's name of the right the team's domain is read under. */
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

  /** Why the repair stopped; left out where the login stands as the users ask. `bad_logins` is stored logins that are no list of emails. */
  readonly refusal?: KeyRefusal | "access_off" | "no_team" | "bad_logins";
}

/** The install's way to put its own login back. */
export interface LoginRepair {
  /** Whether the install holds a key to repair with. No call to Cloudflare. */
  holdsKey(): boolean;

  /** Make the login match the given users. It throws for nothing Cloudflare answers, and no answer holds the key. */
  repair(logins: readonly Login[]): Promise<Repaired>;
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

/**
 * Make the install's way to repair its own login.
 *
 * @param key - the kept key, or `undefined` on an install that holds none, which answers every repair `no_key` and calls nothing
 * @returns the login's side at Cloudflare. A repair that stopped at the variable has left the applications standing
 */
export function createLoginRepair(key: KeptKey | undefined, place: LoginPlace): LoginRepair {
  const { accountId, script, adminHost, privateSites } = place;

  return {
    holdsKey: () => key !== undefined,

    async repair(logins) {
      const wrote: string[] = [];
      const sent = { calls: 0 };
      const counting = key === undefined ? undefined : countingKey(key, sent);
      const ended = (): Omit<Repaired, "refusal"> => ({ wrote, users: wrote.includes(INSTALL_OBJECTS.accessPolicy), calls: sent.calls });
      const stopped = (refusal: NonNullable<Repaired["refusal"]>): Repaired => ({ ...ended(), refusal });

      const users = parseLogins(logins);
      if (!users.ok) return stopped("bad_logins");

      const access = await keyed(counting, ACCESS_RIGHT, async (connection): Promise<CloudflareResult<"made" | "off">> => {
        const synced = await syncAccess(connection, accountId, { hostname: adminHost, logins: users.value, privateSites }, "apply");
        wrote.push(...written(synced.report));
        if (synced.ok) return { ok: true, value: "made" };

        return isAccessOff(synced) ? { ok: true, value: "off" } : synced;
      });
      if (!access.ok) return stopped(access.refusal);

      if (access.value === "off") return stopped("access_off");

      const facts = await keyed(counting, TEAM_RIGHT, (connection) => readLoginFacts(connection, accountId));
      if (!facts.ok) return stopped(facts.refusal);

      const login = facts.value;
      if (login === undefined) return stopped("no_team");

      const wanted = [{ name: INSTALL_OBJECTS.accessBinding, value: { team_domain: login.teamDomain, audience: login.audience } }];
      const variable = await keyed(counting, WORKER_RIGHT, async (connection): Promise<CloudflareResult<undefined>> => {
        const synced = await syncVariables(connection, { accountId, script }, wanted, "apply");
        wrote.push(...written(synced.report));

        return synced.ok ? { ok: true, value: undefined } : synced;
      });

      return variable.ok ? ended() : stopped(variable.refusal);
    },
  };
}
