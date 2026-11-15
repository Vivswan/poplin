// A console the tests ask requests of: the dashboard tests' install, with the console built over it and helpers that send what its client would.

import { importSessionKey } from "@poplin/core/src/auth/cookie";
import { parseLogins } from "@poplin/core/src/auth/logins";

import { createConsole } from "../../../src/console/console";
import type { DomainPlug } from "../../../src/dashboard/domain/records";
import { readSession } from "../../../src/login/session";
import { codeCounts, FREE_LIMITS, ORIGIN, openDashboard, VERSION } from "../../dashboard/support/install";

/** The one host the test console's provider starts rebuilds at. */
export const REBUILD_HOST = "rebuilds.example.com";

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
  readonly base: Awaited<ReturnType<typeof openDashboard>>;

  /** Every address the provider was asked to start a rebuild at, in order. */
  readonly rebuilds: readonly string[];

  /** Ask anything at all, as it is: no session, origin, or type is added. */
  readonly fetch: (request: Request) => Promise<Response>;

  /** Ask as the owner. */
  readonly get: (path: string) => Promise<Response>;

  /** Ask with no session. */
  readonly getLoggedOut: (path: string) => Promise<Response>;

  /** Send a change as the client does: JSON, from a page of the console's own origin. `headers` lay over the client's own. */
  readonly change: (path: string, body: unknown, headers?: Readonly<Record<string, string>>) => Promise<Response>;
}

/**
 * Open a console over a fresh install with one login.
 *
 * @param base - the path the console sits under; the root when left out
 * @param domain - the provider's side of the install; left out, the console has no Domain screen
 */
export async function openConsole(base = "", domain?: DomainPlug): Promise<Opened> {
  const opened = await openDashboard();
  const { database } = opened.install;

  // As a host would: the key and the logins are read on every request.
  const sessionOf: Parameters<typeof createConsole>[0]["readSession"] = async (headers) => {
    const stored = await database.readSigningKey();
    const logins = parseLogins((await database.readSettings())?.logins ?? []);
    if (stored === undefined || !logins.ok) return { ok: false };

    return readSession(headers, { key: await importSessionKey(stored), logins: logins.value, now: opened.clock.now });
  };
  const rebuilds: string[] = [];
  const startRebuild = async (address: string): Promise<Response> => {
    rebuilds.push(address);

    return new Response(null, { status: 204 });
  };
  const built = createConsole({
    install: opened.install,
    version: VERSION,
    readSession: sessionOf,
    loginPath: "/login",
    base,
    client: CLIENT,
    freeLimits: FREE_LIMITS,
    rebuild: { accepts: (address) => address.hostname === REBUILD_HOST, fetch: startRebuild },
    demo: { reset: "/reset" },
    domain,
    ...codeCounts(opened.counters),
  });
  const client = { Cookie: opened.cookie, Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };

  return {
    base: opened,
    rebuilds,
    fetch: (request) => built.fetch(request),
    get: (path) => built.fetch(new Request(`${ORIGIN}${base}${path}`, { headers: { Cookie: opened.cookie } })),
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
