// A local stand-in for a deployed install, for the self-test of the live checks: the real API and the real serving on a database and a store in memory, with a hand-written edge in front.
//
//   poplin.example.com/api...        the real API
//   poplin.example.com/login         the login: a redirect off the domain with the login in front, a 403 without
//   poplin.example.com/...           a redirect to the login
//   *-poplin.example.com             the edge's rules, then the real serving
//   *-page.example.com               the same, on an install whose routes reach the public word
//   any other hostname               no answer

import { serveSite } from "../../../packages/app/src/sites/serve";
import { openApi } from "../../../packages/app/tests/api/support/install";
import { ADDRESSES } from "../../../packages/app/tests/sites/support/layout";
import type { Fetch } from "../../../packages/cli/src/client/client";

/** The domain the fake answers under. */
export const FAKE_DOMAIN = "example.com";

/** The admin hostname. */
const ADMIN_HOST = `poplin.${FAKE_DOMAIN}`;

/** Where the login in front of the install sends a stranger. */
const LOGIN_PAGE = "https://team.example.net/login";

/** The most requests the fake's own limit lets one minute hold. */
const OWN_LIMIT = 120;

/** The most requests the fake's rate rule lets through. */
const RULE_LIMIT = 300;

/** The headers of the fake's own refusals. */
const REFUSAL_HEADERS = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };

/** The user agents the fake's bot block stops. */
const CRAWLERS = /GPTBot/;

/** The paths the fake's guard rule stops: what a scanner asks for. */
const SCANNER_PATHS = /\.php$/;

/** The methods the fake's guard rule lets through. */
const READS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** How the fake differs from an install with every rule in front and no login. Every switch is off unless said. */
export interface FakeSwitches {
  /** A login stands in front of the login path and of every letter p hostname. */
  readonly access?: boolean;

  /** No route reaches the public word's hostnames. */
  readonly noPublicRoute?: boolean;

  /** The zone holds no guard rule and no redirect rule: every request reaches the install. */
  readonly noGuards?: boolean;

  /** A fault: a letter p address opens for a request with no login behind it. */
  readonly leaksPrivate?: boolean;
}

/** A fake install: what sends a request to it, and an admin's token. */
interface Fake {
  readonly fetch: Fetch;
  readonly token: string;
}

/** The zone's redirect rule: plain http moves to https, on every hostname of the install. */
function toHttps(url: URL): Response | undefined {
  if (url.protocol !== "http:") return undefined;

  return new Response(null, { status: 301, headers: { Location: `https://${url.host}${url.pathname}` } });
}

function refusal(status: number, text: string, extra: Readonly<Record<string, string>> = {}): Response {
  return new Response(text, { status, headers: { ...REFUSAL_HEADERS, ...extra } });
}

/**
 * Open a fake install with no site.
 *
 * @returns the fake; a request to a hostname it does not answer on rejects, as one to a hostname with no server does
 */
export async function openFake(switches: FakeSwitches = {}): Promise<Fake> {
  const install = await openApi();
  const settings = await install.database.readSettings();
  if (settings === undefined) throw new Error("the fake install has no settings");

  let siteRequests = 0;

  // The zone's rules on a site hostname: the guard rule, the bot block, the rate rule. Then the install's own count of one visitor.
  const edge = (request: Request, url: URL): Response | undefined => {
    const guarded = switches.noGuards !== true;
    if (guarded && (!READS.has(request.method) || SCANNER_PATHS.test(url.pathname))) return new Response("blocked", { status: 403 });

    if (CRAWLERS.test(request.headers.get("User-Agent") ?? "")) return new Response("blocked", { status: 403 });

    siteRequests += 1;
    if (siteRequests > RULE_LIMIT) return new Response("error code: 1015", { status: 429 });

    if (siteRequests > OWN_LIMIT) return refusal(429, "Too many requests. Try again in 60 seconds.\n", { "Retry-After": "60" });

    return undefined;
  };

  // The login in front of every letter p hostname: a stranger never reaches the install there.
  const login = (url: URL): Response | undefined => {
    const addressed = ADDRESSES.resolve(url);
    const gated = switches.access === true && addressed.kind === "site" && addressed.letter === "p";

    return gated ? refusal(302, "", { Location: LOGIN_PAGE }) : undefined;
  };

  const answerSite = async (request: Request, url: URL): Promise<Response> => {
    const stopped = edge(request, url) ?? login(url);
    if (stopped !== undefined) return stopped;

    return serveSite(request, {
      database: install.database,
      store: install.store,
      settings,
      addresses: ADDRESSES,
      identify: async () => ({ ok: switches.leaksPrivate === true }),
      now: () => install.clock.now,
    });
  };

  const answerAdmin = (request: Request, url: URL): Promise<Response> | Response => {
    if (url.pathname.startsWith("/api/")) return install.api.fetch(request);

    if (url.pathname !== "/login") return refusal(302, "", { Location: `https://${ADMIN_HOST}/login` });

    return switches.access === true ? refusal(302, "", { Location: LOGIN_PAGE }) : refusal(403, "Forbidden\n");
  };

  const fetch: Fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const secured = switches.noGuards === true ? undefined : toHttps(url);
    if (secured !== undefined) return secured;

    if (url.hostname === ADMIN_HOST) return answerAdmin(request, url);

    const reached = ADDRESSES.isSiteHost(url.hostname) && !(switches.noPublicRoute === true && !url.hostname.endsWith(`-poplin.${FAKE_DOMAIN}`));
    if (!reached) throw new TypeError("no server answers on this hostname");

    return answerSite(request, url);
  };

  return { fetch, token: install.tokens.admin };
}
