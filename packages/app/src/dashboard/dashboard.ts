// The owner's dashboard: the pages on the admin hostname where a logged-in admin sees and manages every site and the install's settings.
//
//   GET  /                         the sites, or the trash with ?view=trash
//   GET  /sites/<label>            one site
//   POST /sites/<label>/<change>   settings, rollback, new-link, delete, restore, delete-forever
//   GET  /tokens                   the tokens, and where a computer's code is typed
//   GET  /tokens/allow?code=<code> one computer's login, to allow or deny
//   POST /tokens/<change>          allow, deny, revoke
//   GET  /settings                 the settings
//   POST /settings/<change>        save, sign-everyone-out
//   GET  /activity                 the audit log
//   GET  /usage                    the totals and the day's requests
//   GET  /domain                   the token form and the domain's settings; only with a domain plug
//   POST /domain/<change>          check, repair, save
//
// Every request is first asked for its session: without one the only answer is the way to the login. Every POST is then checked to come from a dashboard page.

import { readConfig } from "@poplin/core/src/actions/config";
import type { Install } from "@poplin/core/src/actions/records";
import { ALLOW_PAGE } from "@poplin/core/src/api/routes";
import type { Login } from "@poplin/core/src/auth/logins";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { NONCE, secureHeaders } from "hono/secure-headers";

import type { Counters } from "../limits/limits";
import { showActivity } from "./activity/activity-page";
import { framePage, refusedPage } from "./page/frame";
import { noticeIn } from "./page/notices";
import type { Change, Form, Page, Visit } from "./records";
import { importCsrfKey, mintCsrfToken } from "./security/csrf";
import { readOwnForm } from "./security/own-form";
import { SETTINGS_CHANGES } from "./settings/settings-changes";
import { showSettings } from "./settings/settings-page";
import { SITE_CHANGES } from "./sites/site-changes";
import { showSite } from "./sites/site-page";
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

  /** The path of the dashboard's own hostname where a login starts. */
  readonly loginPath: string;

  /** At least 32 random bytes that sign the forms' tokens, used for nothing else. */
  readonly csrfSecret: Uint8Array<ArrayBuffer>;

  /** The provider's side of the install. Left out, the dashboard has no Domain tab and answers none of its paths. */
  readonly domain?: DomainPlug;

  /** Where the tries at a login's code are counted, a minute at a time. */
  readonly counters: Pick<Counters, "takeMinute">;

  /** The key one visitor's tries are counted by: `visitorKey` of the address the host itself saw. */
  readonly visitorOf: (request: Request) => Promise<string>;
}

/** What the handlers of one request share. `tabs` says whether the frame shows the Domain tab. */
interface Shared {
  Variables: { visit: Visit; form: Form; tabs: "domain" | undefined };
}

/** Something that answers a request, as a Worker's `fetch` does. */
interface Dashboard {
  readonly fetch: (request: Request) => Promise<Response>;
}

function loginAddress(loginPath: string, url: URL, back: string): string {
  const login = new URL(loginPath, url.origin);
  login.searchParams.set(RETURN_KEY, back);

  return login.href;
}

async function respond(context: Context<Shared>, page: Page): Promise<Response> {
  const visit = context.get("visit");
  const config = await readConfig(visit.install, visit.actor);
  const title = config.ok ? config.values.dashboard_title : PLAIN_TITLE;
  const document = await framePage(page, { title, nonce: context.get("secureHeadersNonce") ?? "", notice: noticeIn(visit.url), tabs: context.get("tabs") });

  return context.html(document, page.status ?? 200);
}

function refuse(context: Context<Shared>, code: string, status: NonNullable<Page["status"]>): Promise<Response> {
  return respond(context, refusedPage({ tab: "sites", heading: "Not done", status }, { code }));
}

/** Answer a form: run the change its address names and send the browser to the page the change answers with. */
async function change<Subject extends string[]>(context: Context<Shared>, changes: Readonly<Record<string, Change<Subject>>>, name: string, ...subject: Subject): Promise<Response> {
  const wanted = Object.hasOwn(changes, name) ? changes[name] : undefined;
  if (wanted === undefined) return context.notFound();

  return context.redirect(await wanted(context.get("visit"), ...subject, context.get("form")), 303);
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
      contentSecurityPolicy: { defaultSrc: ["'none'"], styleSrc: [NONCE], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      xFrameOptions: "DENY",
      // A form of the page then carries the page's origin; a request to any other origin carries no referrer.
      referrerPolicy: "same-origin",
    }),
  );
  app.use(noStore, session, method);
  app.post("*", bodyLimit({ maxSize: MAX_FORM_BYTES, onError: (context) => refuse(context, "too_large", 413) }), fromHere);

  app.get("/", async (context) => respond(context, await showSites(context.get("visit"))));
  app.get("/sites/:site", async (context) => respond(context, await showSite(context.get("visit"), context.req.param("site"))));
  app.post("/sites/:site/:change", (context) => change(context, SITE_CHANGES, context.req.param("change"), context.req.param("site")));
  for (const path of CODE_PATHS) app.use(path, fewCodes);
  app.get("/tokens", async (context) => respond(context, await showTokens(context.get("visit"))));
  app.get(ALLOW_PAGE, async (context) => respond(context, await showAllow(context.get("visit"))));
  app.post("/tokens/:change", (context) => change(context, TOKEN_CHANGES, context.req.param("change")));
  app.get("/settings", async (context) => respond(context, await showSettings(context.get("visit"))));
  app.post("/settings/:change", (context) => change(context, SETTINGS_CHANGES, context.req.param("change")));
  app.get("/activity", async (context) => respond(context, await showActivity(context.get("visit"))));
  app.get("/usage", async (context) => respond(context, await showUsage(context.get("visit"))));

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
  app.onError(() => new Response(FAILURE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }));

  return { fetch: async (request) => app.fetch(request) };
}
