// A console the tests ask requests of: the dashboard tests' install, with the console built over it and helpers that send what its client would.

import type { EndLogins } from "@poplin/core/src/actions/access/sign-out";
import { parseLogin, parseLogins } from "@poplin/core/src/auth/logins";
import type { Jobs } from "@poplin/core/src/jobs/jobs";

import { createConsole } from "../../../src/console/console";
import type { DomainPlug } from "../../../src/console/domain/records";
import type { Later } from "../../../src/console/later";
import type { UsersFollow } from "../../../src/console/access/users-follow";
import type { LogsFollow } from "../../../src/console/settings/logs-follow";
import type { RulesFollow } from "../../../src/console/settings/rules-follow";
import type { UsageHost } from "../../../src/console/usage/records";
import { admit, type Identify } from "../../../src/login/admit";
import { createEntries } from "../../../src/login/entries";
import { codeCounts, FREE_LIMITS, KINDS, LOGIN_HEADER, ORIGIN, openOwned, USAGE_HOST, VERSION } from "./install";
import { hostUpdate, type UpdateHost, updateHost } from "../../api/support/update-host";

/** The header the stand-in reads the moment a login began from, in milliseconds since the epoch; left out, the login began an hour before the request. */
export const SINCE_HEADER = "Test-Login-Since";

/** The address the console is told the provider ends a login at. */
export const SIGN_OUT = "/leave";

/** What the stand-in for a provider's login refuses a request as, by the word its header holds where an email would be, and what a host tells the console each means. */
const PROVIDER_REFUSALS = { "keys-down": "unchecked", "nothing-set": "not-set-up", "": "no-proof" } as const;

/** How long before a request its login began, where the request does not say. */
const HOUR_MS = 3_600_000;

/** The files the test console answers as its client's build, under names that hold a hash as a build's do. */
const ASSETS: Readonly<Record<string, { readonly body: string; readonly type: string }>> = {
  "app-4f1c.js": { body: "// the client", type: "text/javascript; charset=utf-8" },
  "app-9d2e.css": { body: "/* the look */", type: "text/css; charset=utf-8" },
};

/** The test client as a host hands it out. */
export const CLIENT: Parameters<typeof createConsole>[0]["client"] = {
  entry: async () => ({ script: "app-4f1c.js", style: "app-9d2e.css" }),
  file: async (name) => (Object.hasOwn(ASSETS, name) ? ASSETS[name] : undefined),
};

/** A test console and what the tests reach it through. */
interface Opened {
  /** The install's helpers: `publish` makes a site, `owner` is the logged-in email. */
  readonly base: Awaited<ReturnType<typeof openOwned>>;

  /** The stand-in for the install's host: whether it holds the key an update is sent with, the newest release above the running version or `null`, what it refuses that release with, and every version it put in place. */
  readonly host: UpdateHost;

  /** The stand-in for the provider's way to end every login: `answer` is what the next try is answered, done unless a test sets a refusal, and `asked` counts the tries. */
  readonly logins: { answer: Awaited<ReturnType<EndLogins>>; asked: number };

  /** The stand-in for the project's website: `latest` is the file it publishes, `undefined` while it does not answer, as it does not until a test sets one, and `asked` counts the requests for the file. */
  readonly website: { latest: unknown; asked: number };

  /** Ask anything at all, as it is: no login, origin, or type is added. `later` is what a host holds the request open with after its answer. */
  readonly fetch: (request: Request, later?: Later) => Promise<Response>;

  /** Ask as the owner. */
  readonly get: (path: string) => Promise<Response>;

  /** Ask with no login behind the request. */
  readonly getLoggedOut: (path: string) => Promise<Response>;

  /** Send a change as the client does: JSON, from a page of the console's own origin. `headers` lay over the client's own. */
  readonly change: (path: string, body: unknown, headers?: Readonly<Record<string, string>>) => Promise<Response>;
}

/** The tests' stand-in for a provider's login: it vouches for the email the request's header names, and refuses a header that holds one of its own words or no email. */
const identify: Identify<string> = async (headers, now) => {
  const named = headers.get(LOGIN_HEADER) ?? "";
  const email = parseLogin(named);
  if (!email.ok) return { ok: false, refusal: Object.hasOwn(PROVIDER_REFUSALS, named) ? named : "" };

  return { ok: true, value: email.value, since: Number(headers.get(SINCE_HEADER) ?? now - HOUR_MS) };
};

/** What a test console is opened with, each part as `openConsole` says it. */
interface Parts {
  readonly base: string;
  readonly domain?: DomainPlug;
  readonly usage: UsageHost;
  readonly follow?: UsersFollow;
  readonly rules?: RulesFollow;
  readonly jobs?: Jobs;
  readonly logs?: LogsFollow;
  readonly kind: (typeof KINDS)[keyof typeof KINDS];
}

/**
 * Open a console over a fresh install with one login, whose sites are hostnames.
 *
 * @param base - the path the console sits under; the root when left out
 * @param domain - the provider's side of the install; left out, the console has no Domain screen
 * @param sides - the host's side of the Usage screen, the provider's sides of the users, of the domain's rules and of the install's logs, and the host's background work; one left out is a host that reads no figures of its own, or has no such side
 */
export async function openConsole(base = "", domain?: DomainPlug, sides: Partial<Pick<Parts, "usage" | "follow" | "rules" | "jobs" | "logs">> = {}): Promise<Opened> {
  return openWith({ base, usage: USAGE_HOST, kind: KINDS.hostname, ...(domain === undefined ? {} : { domain }), ...sides });
}

/** Open a console at the root over a fresh install of one kind, with one login and no provider's side. */
export async function openConsoleOf(kind: Parts["kind"]): Promise<Opened> {
  return openWith({ base: "", usage: USAGE_HOST, kind });
}

async function openWith({ base, domain, usage, follow, rules, jobs, logs, kind }: Parts): Promise<Opened> {
  const opened = await openOwned(kind.addresses);
  const { database } = opened.install;

  // As a host would: the users are read on every request.
  const admitOf: Parameters<typeof createConsole>[0]["admit"] = async (headers) => {
    const users = parseLogins((await database.readSettings())?.users ?? []);
    if (!users.ok) return { ok: false, refusal: "no-proof" };

    const who = await admit(headers, { identify, users: users.value, now: opened.clock.now });
    if (who.ok) return who;

    return { ok: false, refusal: who.refusal === "not-a-user" ? who.refusal : PROVIDER_REFUSALS[who.refusal as keyof typeof PROVIDER_REFUSALS] };
  };
  const logins: Opened["logins"] = { answer: { ok: true }, asked: 0 };
  const website: Opened["website"] = { latest: undefined, asked: 0 };
  const host = updateHost("1.1.0");
  const built = createConsole({
    install: opened.install,
    version: VERSION,
    layout: kind.layout,
    admit: admitOf,
    entered: createEntries(opened.install, () => undefined),
    base,
    client: CLIENT,
    freeLimits: FREE_LIMITS,
    usage,
    update: hostUpdate(host),
    latest: {
      fetch: async () => {
        website.asked += 1;

        return website.latest === undefined ? new Response(null, { status: 503 }) : Response.json(website.latest);
      },
    },
    demo: { reset: "/reset" },
    signOut: SIGN_OUT,
    domain,
    ...(follow === undefined ? {} : { follow }),
    endLogins: async () => {
      logins.asked += 1;

      return logins.answer;
    },
    ...(rules === undefined ? {} : { rules }),
    ...(jobs === undefined ? {} : { jobs }),
    ...(logs === undefined ? {} : { logs }),
    ...codeCounts(opened.counters),
  });
  const client = { ...opened.proof, Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };

  return {
    base: opened,
    logins,
    website,
    host,
    fetch: (request, later) => built.fetch(request, later),
    get: (path) => built.fetch(new Request(`${ORIGIN}${base}${path}`, { headers: opened.proof })),
    getLoggedOut: (path) => built.fetch(new Request(`${ORIGIN}${base}${path}`)),
    change: (path, body, headers = {}) =>
      built.fetch(
        new Request(`${ORIGIN}${base}${path}`, {
          method: "POST",
          headers: { ...client, ...headers },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
  };
}
