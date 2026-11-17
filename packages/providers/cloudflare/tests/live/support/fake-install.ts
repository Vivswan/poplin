// A local stand-in for a deployed install, for the self-test of the live checks: the real API and the real serving on a database and a store in memory, with a hand-written edge in front.
//
//   poplin.example.com/api...        the real API
//   poplin.example.com/...           with the login in front, a redirect off the domain to the team's login
//   poplin.example.com/data/...      from a script, with the login in front, the edge's own 401
//   poplin.example.com/...           with no login in front, the install's own refusal: 401 as JSON under /data/, a 403 anywhere else
//   *-poplin.example.com             the edge's rules, the install's own count of one visitor, then the real serving
//   *-page.example.com               the same, on an install whose routes reach the public word
//   store.example.com/<upload>       the store the install's tickets name: it takes a file as the install's own route does, or refuses every one
//   any other hostname               no answer
//
// With `noDomain`, the fake is an install on an account's free address, and no rule of a zone stands in front of it:
//
//   poplin.example.workers.dev            the dashboard, the login, and the API, as above
//   poplin-sites.example.workers.dev      every unlisted and public site, as a path: the install's own count of one visitor, then the real serving
//   poplin-private.example.workers.dev    every private site, as a path: with the login in front, a redirect to the team's login from every path of it
//
// Every answer on a site hostname names the data center it came through, as the edge's `cf-ray` does, and `/cdn-cgi/trace` there says which address the edge saw.
//
// The fake's time stands still while requests are sent and moves on only in a pause, so its two limits count as the real ones do: by the minute and by ten seconds.
// A pause is also when the fake's provider works with nobody asking: each job that was started runs one round in it, as one step.

import { createApi } from "../../../../../app/src/api/api";
import type { SiteAddresses } from "../../../../../app/src/sites/addresses";
import { pathAddresses } from "../../../../../app/src/sites/path-addresses";
import { serveSite } from "../../../../../app/src/sites/serve";
import { type ApiInstall, INSTALL_VERSION, LIMITS, openApi } from "../../../../../app/tests/api/support/install";
import { ADDRESSES } from "../../../../../app/tests/sites/support/layout";
import type { Fetch } from "../../../../../cli/src/client/client";
import type { JobRun } from "../../../scripts/live/job-run";
import type { Job, Jobs } from "../../../../../core/src/jobs/jobs";
import { runJob } from "../../../../../core/src/jobs/run-job";
import { type Hostname, parseHostname } from "../../../../../core/src/names/hostname";
import { type LiveAddresses, liveAddresses } from "../../../live/addresses";

/** The domain the fake answers under. */
export const FAKE_DOMAIN = "example.com";

/** The account's name in the free address the fake of an install without a domain answers under. */
const FAKE_ACCOUNT = "example";

/** The three hostnames of the fake of an install without a domain. */
const FREE_HOSTS = { admin: `poplin.${FAKE_ACCOUNT}.workers.dev`, sites: `poplin-sites.${FAKE_ACCOUNT}.workers.dev`, private: `poplin-private.${FAKE_ACCOUNT}.workers.dev` } as const;

/** The hostname of the store the fake's tickets name. */
const STORE_HOST = `store.${FAKE_DOMAIN}`;

/** What the install says to a request to its dashboard that no login stands behind. */
const NO_LOGIN = "No login was checked for this request. Open the dashboard's address again.";

/** Where the login in front of the install sends a stranger, before the hostname the stranger asked for. */
const LOGIN_PAGE = "https://team.cloudflareaccess.com/cdn-cgi/access/login/";

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

/** The user agents of assistants that open one page for their user, which the fake's bot block stops where it is said to. */
const ASSISTANTS = /ChatGPT-User|Perplexity-User/;

/** The paths the fake's guard rule stops: what a scanner asks for. */
const SCANNER_PATHS = /\.php$/;

/** The methods the fake's guard rule lets through. */
const READS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** How the fake differs from an install with every rule in front and no login. Every switch is off unless said. */
export interface FakeSwitches {
  /** A login stands in front of the whole admin hostname but its open paths, and of every letter p hostname. */
  readonly access?: boolean;

  /** A fault: the login in front of the admin hostname covers the path `/login` alone, as an install made before the whole hostname was guarded, so the install itself answers every other path. */
  readonly loginPathOnly?: boolean;

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

  /** The install holds no key of its provider, so a change of the users reaches no login list, and a change of the setting of the logs no provider. */
  readonly noKey?: boolean;

  /** The install has no domain: it answers on three hosts of an account's free address, every site is a path, and no rule of a zone stands in front. */
  readonly noDomain?: boolean;

  /** A fault: the install lets the origin a request names read every answer it gives on the dashboard's hostname. The login's own redirect does so on any install. */
  readonly grantsOrigin?: boolean;

  /** A fault: a site's hostname answers the API's paths as the dashboard's hostname does. */
  readonly apiOnSiteHosts?: boolean;

  /** The install's provider runs no job, on a run not told so: each request that asks after a copy copies its next files, and the provider holds no job to read. */
  readonly noJobs?: boolean;

  /** The install holds no upload key: it hands out tickets of its own route alone. */
  readonly noUploadKey?: boolean;

  /** A fault: the store refuses every ticket the install hands out for it. */
  readonly storeRefuses?: boolean;

  /** A fault: the zone's bot block stops an assistant that opens one page for its user, as it stops a crawler. */
  readonly stopsAssistants?: boolean;

  /** The store fails on the first file it is sent, as a store that is busy for a moment does, and takes every one after it. */
  readonly storeStumbles?: boolean;
}

/** A fake install: what sends a request to it, its addresses as a stranger types them, an admin's token, the login list and the jobs its provider holds, whether that provider keeps its logs, and the pause that moves its time on. */
interface Fake {
  readonly fetch: Fetch;
  readonly addresses: LiveAddresses;
  readonly token: string;
  readonly loginList: () => Promise<readonly string[]>;
  readonly logsKept: () => Promise<boolean>;
  readonly jobRun: (upload: string) => Promise<JobRun>;
  readonly pause: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** Where a fake answers: the hostname of its dashboard, the layout of its sites, its API, the same addresses as a stranger types them, and the one host of every private site in a layout that has one. */
interface Place {
  readonly adminHost: string;
  readonly sites: SiteAddresses;
  readonly api: Pick<ApiInstall["api"], "fetch">;
  readonly typed: LiveAddresses;
  readonly privateHost: string | undefined;
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

/** An answer that lets an origin read it, with the visitor's cookies sent along; the answer as it is for no origin. */
function granting(answered: Response, origin: string | null): Response {
  if (origin === null) return answered;

  const open = new Response(answered.body, answered);
  open.headers.set("Access-Control-Allow-Origin", origin);
  open.headers.set("Access-Control-Allow-Credentials", "true");

  return open;
}

/**
 * The login's own answer to a stranger on a path it stands in front of, as the real one gives it: a question before a change is refused outright, a script's call is answered 401, and a page is sent on to the team's login.
 *
 * The redirect lets the origin a request names read it, with the visitor's cookies: it holds nothing of the install.
 */
function atLogin(request: Request, loginPage: string): Response {
  if (request.method === "OPTIONS") return refusal(403, "Forbidden\n");

  if (request.headers.get("X-Requested-With") === "XMLHttpRequest") return refusal(401, "Unauthorized\n");

  return granting(refusal(302, "", { Location: loginPage }), request.headers.get("Origin"));
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Whether the login in front of the admin hostname stops a path that is not the API's. */
function behindLogin(switches: FakeSwitches, pathname: string): boolean {
  if (switches.access !== true) return false;

  return pathname === "/login" || switches.loginPathOnly !== true;
}

/** Check a hostname the fake wrote by hand; a refusal is a mistake in the fake. */
function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the fake's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

/**
 * The place of a fake without a domain: the test install's database, store, tokens, and users behind an API that writes each site's address as a path.
 *
 * The hosts are written here by hand, and not taken from the addresses the checks type, so a check that typed another host would get no answer.
 *
 * @param jobs - the provider's background work; left out, a provider that runs no job
 */
function freeAddressPlace(install: ApiInstall, jobs: Jobs | undefined): Place {
  const sites = pathAddresses({ sitesHost: hostOf(FREE_HOSTS.sites), privateHost: hostOf(FREE_HOSTS.private) });
  const api = createApi({
    database: install.database,
    store: install.store,
    now: () => install.clock.now,
    addressOf: sites.addressOf,
    publicAddressOf: sites.publicAddressOf,
    reservedNames: sites.reservedNames,
    readToken: (id) => install.database.getToken(id),
    limits: LIMITS,
    version: INSTALL_VERSION,
    layout: { kind: "path", sites_host: FREE_HOSTS.sites, private_host: FREE_HOSTS.private },
    counters: install.counters,
    visitorOf: async () => "one-visitor",
    follow: {
      where: "Example Cloud",
      holdsKey: () => install.users.takes,
      push: async (users) => {
        install.users.pushed.push(users);

        return install.users.takes ? { ok: true } : { ok: false, refusal: "no_key" };
      },
    },
    logs: {
      holdsKey: () => true,
      push: async (kept) => {
        install.logs.pushed.push(kept);

        return { ok: true };
      },
    },
    update: { holdsKey: () => false, ready: async () => ({ ok: false, code: "no_key" }) },
    ...(jobs === undefined ? {} : { jobs }),
    direct: () => install.direct.tickets,
  });

  return { adminHost: FREE_HOSTS.admin, sites, api, typed: liveAddresses({ kind: "account address", account: FAKE_ACCOUNT }), privateHost: FREE_HOSTS.private };
}

/**
 * Open a fake install with no site.
 *
 * @returns the fake; a request to a hostname it does not answer on rejects, as one to a hostname with no server does
 */
export async function openFake(switches: FakeSwitches = {}): Promise<Fake> {
  // The fake's provider keeps each job it was handed, with how many steps it ran: one that was stopped is told as failed.
  const runs = new Map<string, { readonly job: Job; steps: number; state: JobRun["state"] }>();
  const jobs: Jobs = {
    background: true,
    start: async (job) => void runs.set(job.upload, { job, steps: 0, state: "running" }),
    stop: async (job) => {
      const run = runs.get(job.upload);
      if (run?.state === "running") run.state = "failed";
    },
  };
  const held = switches.noJobs === true ? undefined : jobs;
  const install = await openApi({}, LIMITS, undefined, held);
  const settings = await install.database.readSettings();
  if (settings === undefined) throw new Error("the fake install has no settings");

  const place: Place =
    switches.noDomain === true
      ? freeAddressPlace(install, held)
      : { adminHost: `poplin.${FAKE_DOMAIN}`, sites: ADDRESSES, api: install.api, typed: liveAddresses({ kind: "domain", domain: FAKE_DOMAIN }), privateHost: undefined };
  // The rules of a zone: an install without a domain has no zone, so none of them stands in front of it.
  const zone = switches.noDomain !== true;
  const loginPage = `${LOGIN_PAGE}${place.adminHost}`;

  // The fake's provider takes every change of the users, unless a fault says the install holds no key: its list is then the one of the first settings for good.
  install.users.takes = switches.noKey !== true;
  const loginList = async (): Promise<readonly string[]> => (install.users.takes ? (install.users.pushed.at(-1) ?? settings.users) : settings.users);
  // The fake's provider keeps the logs as the last change of their setting says, and on an install that holds no key as the first settings say, for good.
  const logsKept = async (): Promise<boolean> => (install.users.takes ? (install.logs.pushed.at(-1) ?? settings.provider_logs) : settings.provider_logs);

  // The fake's upload key: each ticket names the store, with the headers of the install's own route, which the store hands the file on to.
  if (switches.noUploadKey !== true) {
    install.direct.tickets = {
      issue: async (upload, files) =>
        files.map(({ file }) => {
          const url = `https://${STORE_HOST}/${upload.id}?${new URLSearchParams({ path: file.path })}`;

          return { path: file.path, url, method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Length": String(file.size) }, expires: upload.expires };
        }),
    };
  }

  // The store takes a file sent with no login, as a signed address is: it hands the bytes to the install's own route under the fake's own token.
  let stumbled = switches.storeStumbles !== true;
  const answerStore = (request: Request, url: URL): Promise<Response> | Response => {
    if (!stumbled) {
      stumbled = true;

      return new Response("<Error><Code>ServiceUnavailable</Code></Error>", { status: 503 });
    }

    if (switches.storeRefuses === true || request.headers.has("Authorization")) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });

    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${install.tokens.admin}`);

    return place.api.fetch(new Request(`https://${place.adminHost}/api/uploads${url.pathname}/file${url.search}`, { method: request.method, headers, body: request.body, duplex: "half" } as RequestInit));
  };

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

  // The user agents the zone's bot block stops.
  const stoppedAgents = switches.stopsAssistants === true ? [CRAWLERS, ASSISTANTS] : [CRAWLERS];

  // The zone's rules on a site hostname: the guard rule, the bot block, the rate rule. Then the install's own count of one visitor.
  const edge = (request: Request, url: URL, path: Path): Response | undefined => {
    const guarded = zone && switches.noGuards !== true;
    if (guarded && (!READS.has(request.method) || SCANNER_PATHS.test(url.pathname))) return new Response("blocked", { status: 403 });

    if (zone && stoppedAgents.some((agents) => agents.test(request.headers.get("User-Agent") ?? ""))) return new Response("blocked", { status: 403 });

    arrivals.push({ at: time, ...path });
    if (zone && switches.noRateRule !== true && arrivedIn(time - ruleLag - RULE_WINDOW_MS, time - ruleLag, path) > RULE_LIMIT) return new Response("error code: 1015", { status: 429 });

    if (switches.noOwnLimit !== true && arrivedIn(time - OWN_WINDOW_MS, time - ownLag) > OWN_LIMIT) return refusal(429, "Too many requests. Try again in 60 seconds.\n", { "Retry-After": "60" });

    return undefined;
  };

  // The login in front of every address of a private site: a stranger never reaches the install there. Without a domain that is one host, whatever the path.
  const login = (url: URL): Response | undefined => {
    const addressed = place.sites.resolve(url);
    const privateAddress = place.privateHost === undefined ? addressed.kind === "site" && addressed.letter === "p" : url.hostname === place.privateHost;

    return switches.access === true && privateAddress ? refusal(302, "", { Location: loginPage }) : undefined;
  };

  const answerSite = async (request: Request, url: URL, path: Path): Promise<Response> => {
    if (url.pathname === TRACE_PATH) return new Response(`ip=${path.source}\ncolo=${path.center}\n`);

    const stopped = edge(request, url, path) ?? login(url);
    if (stopped !== undefined) return stopped;

    return serveSite(request, {
      database: install.database,
      store: install.store,
      settings,
      addresses: place.sites,
      identify: async () => ({ ok: switches.leaksPrivate === true }),
      now: () => install.clock.now,
    });
  };

  // The login's own answer on the dashboard's hostname, or none for a request it lets through. The edge answers a script's call itself, where it sends a page on to the team's login.
  const stoppedAtLogin = (request: Request, url: URL): Response | undefined =>
    !isApiPath(url.pathname) && behindLogin(switches, url.pathname) ? atLogin(request, loginPage) : undefined;

  // What the install itself answers there, to a request the login let through or that met none.
  const answerAdmin = (request: Request, url: URL): Promise<Response> | Response => {
    if (isApiPath(url.pathname)) return place.api.fetch(request);

    // As the install refuses a request no login stands behind.
    if (url.pathname.startsWith("/data/")) return Response.json({ ok: false, code: "no_login", about: null, sentence: NO_LOGIN }, { status: 401, headers: REFUSAL_HEADERS });

    return refusal(403, `${NO_LOGIN}\n`);
  };

  // What the two faults of the hostnames and the zone's redirect rule come to, said once for every request.
  const redirects = zone && switches.noGuards !== true;
  const grantedOf = (request: Request): string | null => (switches.grantsOrigin === true ? request.headers.get("Origin") : null);
  const asApi = (url: URL): boolean => switches.apiOnSiteHosts === true && url.pathname.startsWith("/api/");

  const fetch: Fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const secured = redirects ? toHttps(url) : undefined;
    if (secured !== undefined) return secured;

    // The fault of an install that lets an origin read its answers is in the install's own alone: the login's are none of its.
    if (url.hostname === place.adminHost) return stoppedAtLogin(request, url) ?? granting(await answerAdmin(request, url), grantedOf(request));

    if (url.hostname === STORE_HOST) return answerStore(request, url);

    const reached = place.sites.isSiteHost(url.hostname) && !(switches.noPublicRoute === true && !url.hostname.endsWith(`-poplin.${FAKE_DOMAIN}`));
    if (!reached) throw new TypeError("no server answers on this hostname");

    if (asApi(url)) return place.api.fetch(request);

    const path = route();
    const answer = await answerSite(request, url, path);
    const marked = new Response(answer.body, answer);
    marked.headers.set("cf-ray", `${asked.toString(16)}-${path.center}`);

    return marked;
  };

  const pause = async (ms: number): Promise<void> => {
    time += ms;

    for (const run of [...runs.values()].filter((held) => held.state === "running")) {
      run.steps += 1;
      if ((await runJob(install.install, run.job)) === "done") run.state = "done";
    }
  };

  const jobRun = async (upload: string): Promise<JobRun> => {
    const run = runs.get(upload);
    if (run === undefined) throw new Error("the fake's provider holds no job of this upload");

    return { state: run.state, steps: run.steps };
  };

  return { fetch, addresses: place.typed, token: install.tokens.admin, loginList, logsKept, jobRun, pause, now: () => time };
}
