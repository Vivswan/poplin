// A local stand-in for a deployed install, for the self-test of the live checks: the real API and the real serving on a database and a store in memory, with a hand-written edge in front.
//
//   poplin.example.com/api...        the real API
//   poplin.example.com/setup...      the install's own 404: its setup page is shut
//   poplin.example.com/...           with the login in front, a redirect off the domain to the team's login
//   poplin.example.com/login         with no login in front, a 403
//   poplin.example.com/...           with no login in front, the install's own redirect to its login path
//   *-poplin.example.com             the edge's rules, the install's own count of one visitor, then the real serving
//   *-page.example.com               the same, on an install whose routes reach the public word
//   any other hostname               no answer
//
// Every answer on a site hostname names the data center it came through, as the edge's `cf-ray` does, and `/cdn-cgi/trace` there says which address the edge saw.
//
// The fake's time stands still while requests are sent and moves on only in a pause, so its two limits count as the real ones do: by the minute and by ten seconds.

import { serveSite } from "../../../packages/app/src/sites/serve";
import { openApi } from "../../../packages/app/tests/api/support/install";
import { ADDRESSES } from "../../../packages/app/tests/sites/support/layout";
import type { Fetch } from "../../../packages/cli/src/client/client";

/** The domain the fake answers under. */
export const FAKE_DOMAIN = "example.com";

/** The admin hostname. */
const ADMIN_HOST = `poplin.${FAKE_DOMAIN}`;

/** Where the login in front of the install sends a stranger. */
const LOGIN_PAGE = `https://team.cloudflareaccess.com/cdn-cgi/access/login/${ADMIN_HOST}`;

/** The most requests the fake's own limit lets one minute hold. */
const OWN_LIMIT = 120;

/** How long the fake's own limit counts over, in milliseconds. */
const OWN_WINDOW_MS = 60_000;

/** The most requests the fake's rate rule lets through. */
const RULE_LIMIT = 300;

/** How long the fake's rate rule counts over, in milliseconds. */
const RULE_WINDOW_MS = 10_000;

/** How late a request enters the own count of an install whose count lags, in milliseconds. */
const LAG_MS = 1000;

/** How late a request enters the count of a rate rule whose count lags, in milliseconds. */
const RULE_LAG_MS = 3000;

/** The data centers the fake answers from: the first alone, or the first two or all four in turn for a visitor whose requests are spread. */
const CENTERS = ["AAA", "BBB", "CCC", "DDD"] as const;

/** How many addresses the requests of a visitor with several leave from, in turn. */
const ADDRESSES_IN_TURN = 4;

/** The path on which the edge itself says what it saw of a request. */
const TRACE_PATH = "/cdn-cgi/trace";

/** The address the fake's edge sees a visitor's requests come from: one kept for documents, which no computer has. A visitor with several has it with other last numbers. */
const VISITOR = "192.0.2.7";

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
  /** A login stands in front of the whole admin hostname but its open paths, and of every letter p hostname. */
  readonly access?: boolean;

  /** A fault: the login in front of the admin hostname covers the login path alone, so the install itself answers every other path. */
  readonly loginPathOnly?: boolean;

  /** A fault: the login in front of the admin hostname covers the setup page's path too. */
  readonly setupBehindLogin?: boolean;

  /** No route reaches the public word's hostnames. */
  readonly noPublicRoute?: boolean;

  /** The zone holds no guard rule and no redirect rule: every request reaches the install. */
  readonly noGuards?: boolean;

  /** A fault: a letter p address opens for a request with no login behind it. */
  readonly leaksPrivate?: boolean;

  /** The install's own count of a visitor takes a request in a second late, as a count kept per location and caught up in the background does. */
  readonly lateCount?: boolean;

  /** A fault: the install counts no visitor, so it has no limit of its own. */
  readonly noOwnLimit?: boolean;

  /** The rate rule's count takes a request in three seconds late, as the edge's does: it starts to block some seconds after the request past its limit. */
  readonly lateRule?: boolean;

  /** A fault: the zone holds no rate rule, on a run not told so. */
  readonly noRateRule?: boolean;

  /** One visitor's requests reach this many data centers in turn, and the rate rule counts in each for itself, as the edge's does. */
  readonly spread?: 2 | 4;

  /** One visitor's requests leave from four addresses in turn, and the rate rule counts each for itself, as the edge's does. */
  readonly manyAddresses?: boolean;
}

/** A fake install: what sends a request to it, an admin's token, and the pause that moves its time on. */
interface Fake {
  readonly fetch: Fetch;
  readonly token: string;
  readonly pause: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** A data center of the fake. */
type Center = (typeof CENTERS)[number];

/** How a request reached the fake's edge: through which data center, and from which address. */
interface Path {
  readonly center: Center;
  readonly source: string;
}

/** The zone's redirect rule: plain http moves to https, on every hostname of the install. */
function toHttps(url: URL): Response | undefined {
  if (url.protocol !== "http:") return undefined;

  return new Response(null, { status: 301, headers: { Location: `https://${url.host}${url.pathname}` } });
}

function refusal(status: number, text: string, extra: Readonly<Record<string, string>> = {}): Response {
  return new Response(text, { status, headers: { ...REFUSAL_HEADERS, ...extra } });
}

function isSetupPath(pathname: string): boolean {
  return pathname === "/setup" || pathname.startsWith("/setup/");
}

/** Whether the login in front of the admin hostname stops a path that is not the API's: every one but the setup page's, unless a fault moves it. */
function behindLogin(switches: FakeSwitches, pathname: string): boolean {
  if (switches.access !== true) return false;

  if (isSetupPath(pathname)) return switches.setupBehindLogin === true;

  return pathname === "/login" || switches.loginPathOnly !== true;
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

  // When each request the rules let through came, on the fake's own time, and by which path.
  const arrivals: (Path & { readonly at: number })[] = [];
  let time = 0;
  let asked = 0;

  // How many requests came in a stretch of time: by one path, or by any.
  const arrivedIn = (from: number, to: number, path?: Path): number =>
    arrivals.filter((arrival) => arrival.at > from && arrival.at <= to && (path === undefined || (arrival.center === path.center && arrival.source === path.source))).length;

  // The path a request comes by: the next data center in turn for a visitor whose requests are spread, and the next address for one with several.
  const route = (): Path => {
    const center = CENTERS[asked % (switches.spread ?? 1)] ?? CENTERS[0];
    const source = switches.manyAddresses === true ? VISITOR.replace(/\d+$/, String(asked % ADDRESSES_IN_TURN)) : VISITOR;
    asked += 1;

    return { center, source };
  };

  // How far each count runs behind the requests.
  const ruleLag = switches.lateRule === true ? RULE_LAG_MS : 0;
  const ownLag = switches.lateCount === true ? LAG_MS : 0;

  // The zone's rules on a site hostname: the guard rule, the bot block, the rate rule. Then the install's own count of one visitor.
  const edge = (request: Request, url: URL, path: Path): Response | undefined => {
    const guarded = switches.noGuards !== true;
    if (guarded && (!READS.has(request.method) || SCANNER_PATHS.test(url.pathname))) return new Response("blocked", { status: 403 });

    if (CRAWLERS.test(request.headers.get("User-Agent") ?? "")) return new Response("blocked", { status: 403 });

    arrivals.push({ at: time, ...path });
    if (switches.noRateRule !== true && arrivedIn(time - ruleLag - RULE_WINDOW_MS, time - ruleLag, path) > RULE_LIMIT) return new Response("error code: 1015", { status: 429 });

    if (switches.noOwnLimit !== true && arrivedIn(time - OWN_WINDOW_MS, time - ownLag) > OWN_LIMIT) return refusal(429, "Too many requests. Try again in 60 seconds.\n", { "Retry-After": "60" });

    return undefined;
  };

  // The login in front of every letter p hostname: a stranger never reaches the install there.
  const login = (url: URL): Response | undefined => {
    const addressed = ADDRESSES.resolve(url);
    const gated = switches.access === true && addressed.kind === "site" && addressed.letter === "p";

    return gated ? refusal(302, "", { Location: LOGIN_PAGE }) : undefined;
  };

  const answerSite = async (request: Request, url: URL, path: Path): Promise<Response> => {
    if (url.pathname === TRACE_PATH) return new Response(`ip=${path.source}\ncolo=${path.center}\n`);

    const stopped = edge(request, url, path) ?? login(url);
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

    if (behindLogin(switches, url.pathname)) return refusal(302, "", { Location: LOGIN_PAGE });

    if (isSetupPath(url.pathname)) return refusal(404, "Not found.\n");

    return url.pathname === "/login" ? refusal(403, "Forbidden\n") : refusal(302, "", { Location: `https://${ADMIN_HOST}/login` });
  };

  const fetch: Fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const secured = switches.noGuards === true ? undefined : toHttps(url);
    if (secured !== undefined) return secured;

    if (url.hostname === ADMIN_HOST) return answerAdmin(request, url);

    const reached = ADDRESSES.isSiteHost(url.hostname) && !(switches.noPublicRoute === true && !url.hostname.endsWith(`-poplin.${FAKE_DOMAIN}`));
    if (!reached) throw new TypeError("no server answers on this hostname");

    const path = route();
    const answer = await answerSite(request, url, path);
    const marked = new Response(answer.body, answer);
    marked.headers.set("cf-ray", `${asked.toString(16)}-${path.center}`);

    return marked;
  };

  const pause = async (ms: number): Promise<void> => {
    time += ms;
  };

  return { fetch, token: install.tokens.admin, pause, now: () => time };
}
