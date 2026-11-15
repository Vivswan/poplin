// The console: the dashboard as an application in the browser. One shell page loads the client's script and stylesheet, and the client reads and changes the install through JSON routes under the same session.
//
//   GET  <base>/assets/<file>   the console's icon and the client's script, stylesheet, and fonts, each under a name that holds a hash of its content; no session, and a browser keeps them for good
//   GET  <base>/favicon.ico      the same icon under the name a browser asks for unbidden; no session
//   GET  <base>/data/...        what a screen shows, as JSON; each screen's routes are in its own `*-routes.ts`, chained on in `routes.ts`
//   POST <base>/data/...        one change, as JSON
//   GET  <base>/...             the shell page, whatever the path: the client draws the screen the path names
//
// A read needs the session. A change is JSON and nothing else: a page of another origin cannot send JSON with the session unless this origin lets it, which it never does. The framework's own check refuses the form a foreign page could send.

import type { Install } from "@poplin/core/src/actions/records";
import type { Rebuilding } from "@poplin/core/src/actions/start-update";
import type { Login } from "@poplin/core/src/auth/logins";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import type { DomainPlug } from "./domain/records";
import type { FreeLimits } from "./settings/free-limits";
import { hasContentType } from "../api/body";
import { type CodeTries, takesCode } from "../limits/code-tries";
import { refused, type Shared } from "./data";
import { frameOf } from "./frame-routes";
import { dataRoutes } from "./routes";
import { assetOf, type ClientFiles, ICON, KEPT_A_DAY, KEPT_FOR_GOOD, shellPage } from "./shell";
import { isSpent, spentAnswer } from "./spent";

/** The title of every page of the dashboard, the same on every install. */
const TITLE = "poplin";

/** What a request whose session cannot be read is taken to carry. */
const NO_SESSION = { ok: false } as const;

/** What a data route answers a request without a session: the client then loads the page again, which leads to the login. */
const LOGGED_OUT = { ok: false, code: "no_session", about: null, sentence: "Log in again." } as const;

/** The policy of every answer: the page runs only the console's own script and reads only this origin. Styles may also be inline: the components set their positions and sizes that way. */
export const POLICY = {
  defaultSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  imgSrc: ["'self'", "data:"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
};

/** What a console is built from. */
interface ConsoleParts extends CodeTries {
  /** The install the actions work on. */
  readonly install: Install;

  /** Reads who a request's session names. */
  readonly readSession: (headers: Headers) => Promise<{ readonly ok: true; readonly value: Login } | { readonly ok: false }>;

  /** The version of poplin the install runs. */
  readonly version: string;

  /** The path of this origin where a login starts. */
  readonly loginPath: string;

  /** The path every route of the console starts with; empty for the root. */
  readonly base: string;

  /** The client's built files. */
  readonly client: ClientFiles;

  /** The free plan's limits of whoever hosts the install: a setting above one is shown with its warning. */
  readonly freeLimits: FreeLimits;

  /** How the provider starts a rebuild of the install: which addresses it takes, and what sends the one request. The starts are counted in `counters`. */
  readonly rebuild: Omit<Rebuilding, "counters">;

  /** Set by a host that shows sample data: the path a POST resets the data at. */
  readonly demo?: { readonly reset: string };

  /** The provider's side of the install, which the Domain screen checks and repairs through; without it the console has no such screen. */
  readonly domain?: DomainPlug;
}

/** Something that answers a request, as a Worker's `fetch` does. */
interface Console {
  readonly fetch: (request: Request) => Promise<Response>;
}

/** Ask every request for its session. Without one a data route answers 401 and a page is sent to the login, to come back to the same address. */
function sessionCheck(parts: ConsoleParts): MiddlewareHandler<Shared> {
  return async (context, next) => {
    const url = new URL(context.req.url);
    const who = await parts.readSession(context.req.raw.headers).catch(() => NO_SESSION);
    if (who.ok) {
      // Every email in the logins is an admin: the console has no other view.
      context.set("asker", { install: parts.install, actor: { scope: "admin", holder: who.value } });
      context.set("email", who.value);
      context.set("domain", parts.domain);
      context.set("takesCode", () => takesCode(parts, context.req.raw, parts.install.now));
      context.set("host", { freeLimits: parts.freeLimits, rebuilding: { ...parts.rebuild, counters: parts.counters }, version: parts.version });

      return next();
    }

    if (url.pathname.startsWith(`${parts.base}/data/`)) return context.json(LOGGED_OUT, 401);

    const login = new URL(parts.loginPath, url.origin);
    login.searchParams.set("return", `${url.pathname}${url.search}`);

    return context.redirect(login.href, 302);
  };
}

/** The most bytes a change's body holds: no change of the console comes near it. */
const MOST_BODY_BYTES = 1_048_576;

/** Let a change through only when its media type is JSON, whatever parameters follow it. */
const jsonOnly: MiddlewareHandler<Shared> = async (context, next) => {
  if (!hasContentType(context.req.raw, "json")) return refused(context, { code: "not_json" });

  return next();
};

/**
 * Build the console.
 *
 * @returns a handler for every request under the console's base path. A page without a session is sent to the login, and a data route without one answers 401.
 * Its `fetch` rejects with whatever a request failed with, but for a day's allowance used up, which it answers
 */
export function createConsole(parts: ConsoleParts): Console {
  const app = new Hono<Shared>().basePath(parts.base === "" ? "/" : parts.base);

  const noStore: MiddlewareHandler<Shared> = async (context, next) => {
    await next();
    context.res.headers.set("Cache-Control", "no-store");
  };

  app.use(secureHeaders({ contentSecurityPolicy: POLICY, xFrameOptions: "DENY", referrerPolicy: "same-origin" }));

  // The client's files hold nothing of the install, so they are answered before the session is asked for.
  app.get("/assets/:name", async (context) => {
    const asset = await assetOf(parts.client, context.req.param("name"));
    if (asset === undefined) return context.notFound();

    return context.body(asset.body, 200, { "Content-Type": asset.type, "Cache-Control": KEPT_FOR_GOOD });
  });

  // A browser asks for this name unbidden, before any page says where the icon is: it gets the icon, not the page.
  app.get("/favicon.ico", (context) => context.body(ICON.body, 200, { "Content-Type": ICON.type, "Cache-Control": KEPT_A_DAY }));

  app.use(noStore, sessionCheck(parts));
  app.post("*", bodyLimit({ maxSize: MOST_BODY_BYTES, onError: (context) => refused(context, { code: "too_large" }) }), csrf(), jsonOnly);

  app.route("/data", dataRoutes);
  app.all("/data/*", (context) => refused(context, { code: "no_page" }));

  app.get("*", async (context) => {
    const { install, actor } = context.get("asker");
    const frame = await frameOf(install, actor, { version: parts.version, domain: parts.domain !== undefined });

    const boot = { ...frame, title: TITLE, base: parts.base, email: context.get("email"), version: parts.version, demo: parts.demo ?? null, domain: parts.domain !== undefined };

    return context.html(shellPage(boot, await parts.client.entry()));
  });

  // A day's allowance that is used up is answered here, in the console's words, and a refusal of the framework is its own answer. Any other failure is the host's to answer and to write down.
  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();

    if (!isSpent(error)) throw error;

    return spentAnswer(error, { path: new URL(context.req.url).pathname, base: parts.base, now: parts.install.now() });
  });

  return { fetch: async (request) => app.fetch(request) };
}
