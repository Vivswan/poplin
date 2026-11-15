// The owner's dashboard: the pages on the admin hostname where a logged-in admin sees and manages every site and the install's settings.
//
//   GET  /                         the sites, searched with ?q= and narrowed with ?access=, or the trash with ?view=trash
//   GET  /sites/<label>            the sites with one site's panel beside them; ?ask= opens one question in it
//   POST /sites/<label>/<change>   settings, access, rename, rollback, new-link, duplicate, cancel-copy, delete, restore, delete-forever
//   GET  /copy.js                  the one script: it copies a link to the clipboard
//   GET  /tokens                   the tokens, and where a computer's code is typed
//   GET  /tokens/allow?code=<code> one computer's login, to allow or deny
//   POST /tokens/<change>          allow, deny, revoke
//   GET  /settings                 the settings
//   POST /settings/<change>        save, sign-everyone-out
//   GET  /activity                 the audit log
//   GET  /usage                    the totals and the day's requests
//   POST /theme                    this browser's choice of scheme, kept in a cookie
//   GET  /domain                   the token form and the domain's settings; only with a domain plug
//   POST /domain/<change>          check, repair, save
//
// Every request is first asked for its session: without one the only answer is the way to the login. Every POST is then checked to come from a dashboard page.

import { readConfig } from "@poplin/core/src/actions/config";
import type { Install } from "@poplin/core/src/actions/records";
import { updateOf } from "@poplin/core/src/actions/update";
import { ALLOW_PAGE } from "@poplin/core/src/api/routes";
import type { Login } from "@poplin/core/src/auth/logins";
import { AllowanceSpent, secondsToNextDay } from "@poplin/core/src/database/driver";
import { WritesSpent } from "@poplin/core/src/storage/metered";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { NONCE, secureHeaders } from "hono/secure-headers";

import type { Counters } from "../limits/limits";
import { safeReturn } from "../login/return-path";
import { showActivity } from "./activity/activity-page";
import { COPY_SCRIPT, COPY_SCRIPT_PATH } from "./page/copy-script";
import { framePage, refusedPage } from "./page/frame";
import { noticeIn, refusalSentence } from "./page/notices";
import { themeCookie, themeOf } from "./page/theme";
import type { Change, Form, Page, Visit } from "./records";
import { importCsrfKey, mintCsrfToken } from "./security/csrf";
import { readOwnForm } from "./security/own-form";
import type { FreeLimits } from "./settings/free-limits";
import { SETTINGS_CHANGES } from "./settings/settings-changes";
import { showSettings } from "./settings/settings-page";
import { SITE_CHANGES } from "./sites/site-changes";
import { showSites } from "./sites/sites-page";
import { showAllow } from "./tokens/allow-page";
import { TOKEN_CHANGES } from "./tokens/token-changes";
import { showTokens } from "./tokens/tokens-page";
import { showUsage } from "./usage/usage-page";
import type { DomainPlug } from "./domain/records";
import { DOMAIN_CHANGES } from "./domain/domain-changes";
import { showDomain } from "./domain/domain-page";

/** The methods the dashboard answers. */
const METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST"]);

/** The `Allow` header of a refused method. */
const ALLOW = "GET, HEAD, POST";

/** The most bytes a posted form holds: room for the Settings form with a long list of logins. */
const MAX_FORM_BYTES = 1024 * 1024;

/** The query key of the login address that names where to go back to. */
const RETURN_KEY = "return";

/** The title of a dashboard whose settings cannot be read. */
const PLAIN_TITLE = "poplin";

/** What a request whose session cannot be read is taken to carry. */
const NO_SESSION = { ok: false } as const;

/** The whole answer to a failure nothing above handled: it tells nothing of the cause. */
const FAILURE = "Something went wrong.";

/** The most times a minute one visitor may look a login's code up or decide one: a person needs two, and a guesser gets no more. */
const CODES_PER_MINUTE = 20;

/** The notice of each allowance of the database that is used up for the day. */
const SPENT_NOTICES = { writing: "no_more_writing", reading: "no_more_reading" } as const;

/** What a counter that cannot answer is taken to say: the minute is full, so a try at a code is refused. */
const UNCOUNTED = { ok: false } as const;

/** The addresses that take a login's code. */
const CODE_PATHS = [ALLOW_PAGE, "/tokens/deny"];

/** What a dashboard is built from. */
interface DashboardParts {
  /** The install the actions work on: its database, store, clock, and addresses. */
  readonly install: Install;

  /** Reads who a request's session names: an email that is in the logins now, or a refusal. */
  readonly readSession: (headers: Headers) => Promise<{ readonly ok: true; readonly value: Login } | { readonly ok: false }>;

  /** The version of poplin the install runs, shown at the foot of the side. */
  readonly version: string;

  /** The path of the dashboard's own hostname where a login starts. */
  readonly loginPath: string;

  /** At least 32 random bytes that sign the forms' tokens, used for nothing else. */
  readonly csrfSecret: Uint8Array<ArrayBuffer>;

  /** The provider's side of the install. Left out, the dashboard has no Domain tab and answers none of its paths. */
  readonly domain?: DomainPlug;

  /** The host's free plan, which the Settings tab warns a value above. */
  readonly freeLimits: FreeLimits;

  /** Set by a host whose install is a demo over sample data: `reset` is the address, outside the dashboard's own, that a form posts to, to start the data over. Left out, as on every real install, no page says "Demo". */
  readonly demo?: { readonly reset: string };

  /** Where the tries at a login's code are counted, a minute at a time. */
  readonly counters: Pick<Counters, "takeMinute">;

  /** The key one visitor's tries are counted by: `visitorKey` of the address the host itself saw. */
  readonly visitorOf: (request: Request) => Promise<string>;
}

/** What the handlers of one request share. `tabs` says whether the frame shows the Domain tab. */
interface Shared {
  Variables: { visit: Visit; form: Form; tabs: "domain" | undefined; version: string; demo: DashboardParts["demo"] };
}

/** Something that answers a request, as a Worker's `fetch` does. */
interface Dashboard {
  readonly fetch: (request: Request) => Promise<Response>;
}

/**
 * Build the dashboard's answer while its database takes no more reading or writing for the day, for where no page can be framed.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns status 503 in plain text that names what ran out, with `Retry-After` up to the next midnight UTC
 */
export function spentNotice(spent: AllowanceSpent, now: number): Response {
  return plainNotice(SPENT_NOTICES[spent.spent], now);
}

/** The notice of a day's allowance that is used up, in plain text, with `Retry-After` up to the next midnight UTC. */
function plainNotice(code: string, now: number): Response {
  const headers = { "Retry-After": String(secondsToNextDay(now)), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

  return new Response(`${refusalSentence(code)}\n`, { status: 503, headers });
}

/** The notice a failure is told with when it is a day's allowance used up: the database's, or the store's writes and listings. None for any other failure. */
function spentCode(error: unknown): string | undefined {
  if (error instanceof WritesSpent) return "allowance_spent";

  return error instanceof AllowanceSpent ? SPENT_NOTICES[error.spent] : undefined;
}

function loginAddress(loginPath: string, url: URL, back: string): string {
  const login = new URL(loginPath, url.origin);
  login.searchParams.set(RETURN_KEY, back);

  return login.href;
}

/** The path a page can be opened at again, without its query, which may hold a login's code. The answer to a form has none of its own: it is the page the form was on, one step up. */
function shownAt(context: Context<Shared>): string {
  const { pathname } = context.get("visit").url;
  if (context.req.method === "GET" || context.req.method === "HEAD") return pathname;

  return pathname.slice(0, pathname.lastIndexOf("/")) || "/";
}

async function respond(context: Context<Shared>, page: Page): Promise<Response> {
  const visit = context.get("visit");
  const config = await readConfig(visit.install, visit.actor);
  const title = config.ok ? config.values.dashboard_title : PLAIN_TITLE;
  const notice = page.ownNotice === true ? undefined : noticeIn(visit.url);
  const version = context.get("version");
  const running = { version, update: await updateOf(visit.install, version, config.ok ? config.values : undefined) };
  const theme = { chosen: themeOf(context.req.header("Cookie")), back: shownAt(context) };
  const look = { title, nonce: context.get("secureHeadersNonce") ?? "", notice, csrf: visit.csrf, tabs: context.get("tabs"), running, theme, demo: context.get("demo") };
  const document = await framePage(page, look);

  return context.html(document, page.status ?? 200);
}

function refuse(context: Context<Shared>, code: string, status: NonNullable<Page["status"]>): Promise<Response> {
  return respond(context, refusedPage({ tab: "sites", heading: "Not done", status }, { code }));
}

/** Answer a failure nothing above handled. A database or a store whose allowance for the day is used up is told as a notice, and any other failure tells nothing of its cause. */
async function answerFailure(error: unknown, context: Context<Shared>, now: number): Promise<Response> {
  const code = spentCode(error);
  if (code === undefined) return new Response(FAILURE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  // The frame reads the settings, which a database that gives no more reading cannot: the notice then goes out in plain text.
  const framed = await refuse(context, code, 503).catch(() => undefined);
  if (framed === undefined) return plainNotice(code, now);

  framed.headers.set("Retry-After", String(secondsToNextDay(now)));

  return framed;
}

/** Answer a form: run the change its address names and send the browser to the page the change answers with. */
async function change<Subject extends string[]>(context: Context<Shared>, changes: Readonly<Record<string, Change<Subject>>>, name: string, ...subject: Subject): Promise<Response> {
  const wanted = Object.hasOwn(changes, name) ? changes[name] : undefined;
  if (wanted === undefined) return context.notFound();

  return context.redirect(await wanted(context.get("visit"), ...subject, context.get("form")), 303);
}

/** Keep the scheme a form chose in the browser's cookie, and send the browser back to the page the form was on. */
function chooseTheme(context: Context<Shared>): Response {
  const form = context.get("form");
  context.header("Set-Cookie", themeCookie(form.get("theme")));

  return context.redirect(safeReturn(form.get("back")), 303);
}

/** Count one try at a login's code against its visitor's minute, and say whether it fits. A counter that cannot answer refuses the try. */
async function takesCode(parts: DashboardParts, request: Request): Promise<boolean> {
  const take = async (): Promise<{ readonly ok: boolean }> =>
    parts.counters.takeMinute({ scope: "visitor", key: `login-code:${await parts.visitorOf(request)}`, limit: CODES_PER_MINUTE }, parts.install.now());

  return (await take().catch(() => UNCOUNTED)).ok;
}

/**
 * Build the dashboard.
 *
 * @returns a handler for every request to the admin hostname's dashboard paths. It answers nothing but a redirect to the login before the session is checked
 * @throws {RangeError} the CSRF secret is under 32 bytes
 */
export function createDashboard(parts: DashboardParts): Dashboard {
  const csrfKey = importCsrfKey(parts.csrfSecret);
  const app = new Hono<Shared>();

  const noStore: MiddlewareHandler<Shared> = async (context, next) => {
    await next();
    context.res.headers.set("Cache-Control", "no-store");
  };

  const session: MiddlewareHandler<Shared> = async (context, next) => {
    const url = new URL(context.req.url);
    const reading = context.req.method === "GET" || context.req.method === "HEAD";
    // A session that cannot be read is no session: the answer is the way to the login, never a page that says so.
    const who = await parts.readSession(context.req.raw.headers).catch(() => NO_SESSION);
    if (!who.ok) return context.redirect(loginAddress(parts.loginPath, url, reading ? `${url.pathname}${url.search}` : "/"), reading ? 302 : 303);

    // Every email in the logins is an admin: the dashboard has no other view.
    const actor = { scope: "admin", holder: who.value } as const;
    const csrf = await mintCsrfToken({ key: await csrfKey, email: who.value, now: parts.install.now() });
    context.set("visit", { install: parts.install, actor, url, csrf, login: loginAddress(parts.loginPath, url, "/") });
    context.set("tabs", parts.domain === undefined ? undefined : "domain");
    context.set("version", parts.version);
    context.set("demo", parts.demo);

    return next();
  };

  const method: MiddlewareHandler<Shared> = async (context, next) => {
    if (METHODS.has(context.req.method)) return next();

    const refused = await refuse(context, "bad_method", 405);
    refused.headers.set("Allow", ALLOW);

    return refused;
  };

  const fromHere: MiddlewareHandler<Shared> = async (context, next) => {
    const sent = await readOwnForm(context.req.raw, { key: await csrfKey, email: context.get("visit").actor.holder, now: parts.install.now() });
    if (!sent.ok) return refuse(context, sent.code, sent.status);

    context.set("form", sent.form);

    return next();
  };

  const fewCodes: MiddlewareHandler<Shared> = async (context, next) => {
    if (!(await takesCode(parts, context.req.raw))) return refuse(context, "too_many_tries", 429);

    return next();
  };

  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], styleSrc: [NONCE], scriptSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      xFrameOptions: "DENY",
      // A form of the page then carries the page's origin; a request to any other origin carries no referrer.
      referrerPolicy: "same-origin",
    }),
  );
  app.use(noStore, session, method);
  app.post("*", bodyLimit({ maxSize: MAX_FORM_BYTES, onError: (context) => refuse(context, "too_large", 413) }), fromHere);

  app.get(COPY_SCRIPT_PATH, (context) => context.body(COPY_SCRIPT, 200, { "Content-Type": "text/javascript; charset=utf-8" }));
  app.get("/", async (context) => respond(context, await showSites(context.get("visit"))));
  app.get("/sites/:site", async (context) => respond(context, await showSites(context.get("visit"), context.req.param("site"))));
  app.post("/sites/:site/:change", (context) => change(context, SITE_CHANGES, context.req.param("change"), context.req.param("site")));
  for (const path of CODE_PATHS) app.use(path, fewCodes);
  app.get("/tokens", async (context) => respond(context, await showTokens(context.get("visit"))));
  app.get(ALLOW_PAGE, async (context) => respond(context, await showAllow(context.get("visit"))));
  app.post("/tokens/:change", (context) => change(context, TOKEN_CHANGES, context.req.param("change")));
  app.get("/settings", async (context) => respond(context, await showSettings(context.get("visit"), parts.freeLimits)));
  app.post("/settings/:change", (context) => change(context, SETTINGS_CHANGES, context.req.param("change")));
  app.get("/activity", async (context) => respond(context, await showActivity(context.get("visit"))));
  app.get("/usage", async (context) => respond(context, await showUsage(context.get("visit"))));
  app.post("/theme", chooseTheme);

  const { domain } = parts;
  if (domain !== undefined) {
    app.get("/domain", async (context) => respond(context, await showDomain(context.get("visit"), domain)));
    app.post("/domain/:change", async (context) => {
      const run = context.req.param("change");
      if (run !== "check" && run !== "repair") return change(context, DOMAIN_CHANGES, run);

      // A run answers with the page itself: a redirect could not carry the table, and the token is gone once the answer is sent.
      return respond(context, await showDomain(context.get("visit"), domain, { run, form: context.get("form") }));
    });
  }

  app.notFound((context) => refuse(context, "no_page", 404));
  app.onError((error, context) => answerFailure(error, context, parts.install.now()));

  return { fetch: async (request) => app.fetch(request) };
}
