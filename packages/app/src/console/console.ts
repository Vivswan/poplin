// The console: the dashboard as an application in the browser. One shell page loads the client's script and stylesheet, and the client reads and changes the install through JSON routes.
//
//   GET  <base>/assets/<file>   the console's icon and the client's script, stylesheet, and fonts, each under a name that holds a hash of its content; a browser keeps them for good
//   GET  <base>/favicon.ico      the same icon under the name a browser asks for unbidden
//   GET  <base>/data/...        what a screen shows, as JSON; each screen's routes are in its own `*-routes.ts`, chained on in `routes.ts`
//   POST <base>/data/...        one change, as JSON
//   GET  <base>/...             the shell page, whatever the path: the client draws the screen the path names
//
// Every request is asked who it is from, a file of the client included, and the console keeps no answer: the next request is asked again.
// A change, and a read of the data too, is also refused when its headers name any page but this origin's own: a browser counts every site of the install as the same site as the dashboard and sends the login along.
// A change is JSON and nothing else, which a page of another origin cannot send unless this origin lets it, and it never does.

import type { Install } from "@poplin/core/src/actions/records";
import type { EndLogins } from "@poplin/core/src/actions/sign-out";
import type { SelfUpdate } from "@poplin/core/src/actions/start-update";
import { inlineJobs } from "@poplin/core/src/jobs/inline-jobs";
import type { Jobs } from "@poplin/core/src/jobs/jobs";
import type { Login } from "@poplin/core/src/auth/logins";
import type { Actor } from "@poplin/core/src/auth/scopes";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import type { DomainPlug } from "./domain/records";
import type { UsageHost } from "./usage/records";
import type { FreeLimits } from "./settings/free-limits";
import { hasContentType } from "../api/body";
import { type CodeTries, takesCode } from "../limits/code-tries";
import { refused, type Shared } from "./data";
import { frameOf } from "./frame-routes";
import { dataRoutes } from "./routes";
import { assetOf, type ClientFiles, ICON, KEPT_A_DAY, KEPT_FOR_GOOD, shellPage } from "./shell";
import { isSpent, spentAnswer } from "./spent";
import type { UsersFollow } from "./access/users-follow";
import { holding, type Later } from "./later";
import type { RulesFollow } from "./settings/rules-follow";

/** The title of every page of the dashboard, the same on every install. */
const TITLE = "poplin";

/** What a request that is not admitted is answered, by why. Only `no-proof` is 401 on a data route, which the client takes as a login that ended: no other refusal may be, or a removed user's page would load without end. */
const REFUSALS = {
  "no-proof": { data: 401, page: 403, code: "no_login", sentence: "No login was checked for this request. Open the dashboard's address again." },
  "not-a-user": { data: 403, page: 403, code: "not_a_user", sentence: "This email is not a user of this install." },
  unchecked: { data: 503, page: 503, code: "login_unchecked", sentence: "The login cannot be checked right now. Try again." },
  "not-set-up": { data: 503, page: 503, code: "login_not_set_up", sentence: "The login is not set up yet. Finish the setup of this install first." },
} as const;

/** How long a client waits before it asks again after a login that could not be checked, in seconds. */
const CHECK_AGAIN_SECONDS = "60";

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

/**
 * Who a request is from, with the moment the provider's login began, or why nobody is admitted.
 * `no-proof` is a request no login vouches for, `unchecked` a login that cannot be checked right now, and `not-set-up` an install with no login in front of it yet.
 */
type Admitted = { readonly ok: true; readonly actor: Actor & { readonly holder: Login }; readonly since: number } | { readonly ok: false; readonly refusal: keyof typeof REFUSALS };

/** What a console is built from. */
interface ConsoleParts extends CodeTries {
  /** The install the actions work on. */
  readonly install: Install;

  /** Decides who a request is from, by the login it carries and the install's users as they are now. It is asked on every request. */
  readonly admit: (headers: Headers) => Promise<Admitted>;

  /** Told of every page an admitted person opens, with the moment the provider's login began: one Activity line per login is written from it. */
  readonly entered: (who: { readonly email: Login; readonly since: number }) => Promise<void>;

  /** The version of poplin the install runs. */
  readonly version: string;

  /** The path every route of the console starts with; empty for the root. */
  readonly base: string;

  /** The client's built files. */
  readonly client: ClientFiles;

  /** The free plan's limits of whoever hosts the install: a setting above one is shown with its warning. */
  readonly freeLimits: FreeLimits;

  /** The host's side of the Usage screen: the free plan's limits no setting holds, the host's own pages of figures, and those figures where the host reads them. */
  readonly usage: UsageHost;

  /** What takes a release and puts it in place of the running code. The starts are counted in `counters`. */
  readonly update: SelfUpdate;

  /** Set by a host that shows sample data: the path a POST resets the data at. */
  readonly demo?: { readonly reset: string };

  /** The provider's side of the install, which the Domain screen checks and repairs through; without it the console has no such screen. */
  readonly domain?: DomainPlug;

  /** The provider's side of the users: a change of them is carried there by itself. Without it a change waits for a repair on the Domain screen. */
  readonly follow?: UsersFollow;

  /** Ends every login of the dashboard at the provider. Without it nobody can be signed out here. */
  readonly endLogins?: EndLogins;

  /** The provider's side of the domain's rules: a change of a setting they are written from is carried there by itself. Without it such a change waits for a repair on the Domain screen. */
  readonly rules?: RulesFollow;

  /** The host's background work, which runs the rounds of a copy after its first request's. Without it the client's own requests run them, one each. */
  readonly jobs?: Jobs;
}

/** Something that answers a request, as a host's `fetch` handler does. */
interface Console {
  readonly fetch: (request: Request, later?: Later) => Promise<Response>;
}

/** Ask every request who it is from. One that is not admitted reads nothing of the install: a data route answers the refusal as JSON, and any other path as one plain sentence. */
function admitted(parts: ConsoleParts): MiddlewareHandler<Shared> {
  return async (context, next) => {
    const who = await parts.admit(context.req.raw.headers);
    if (who.ok) {
      context.set("asker", { install: parts.install, actor: who.actor });
      context.set("email", who.actor.holder);
      context.set("since", who.since);
      context.set("domain", parts.domain);
      context.set("follow", parts.follow);
      context.set("endLogins", parts.endLogins);
      context.set("rules", parts.rules);
      context.set("takesCode", () => takesCode(parts, context.req.raw, parts.install.now));
      context.set("host", { freeLimits: parts.freeLimits, updating: { self: parts.update, counters: parts.counters }, version: parts.version, usage: parts.usage, jobs: parts.jobs ?? inlineJobs });

      return next();
    }

    const { data, page, code, sentence } = REFUSALS[who.refusal];
    context.header("Cache-Control", "no-store");
    if (who.refusal === "unchecked") context.header("Retry-After", CHECK_AGAIN_SECONDS);

    if (new URL(context.req.url).pathname.startsWith(`${parts.base}/data/`)) return context.json({ ok: false, code, about: null, sentence }, data);

    return context.text(`${sentence}\n`, page);
  };
}

/** The most bytes a change's body holds: no change of the console comes near it. */
const MOST_BODY_BYTES = 1_048_576;

/**
 * Refuse a request that a header a browser wrote says a page of another origin sent, a site of the same install included. One with neither header goes on: one host hands a page's request over before the browser wrote them.
 *
 * @param typed - whether a request no page sent goes on too: an address a person typed, which a browser marks `none`
 */
function ownPageOnly(typed: boolean): MiddlewareHandler<Shared> {
  return async (context, next) => {
    const site = context.req.header("Sec-Fetch-Site");
    const origin = context.req.header("Origin");
    const own = site === undefined || site === "same-origin" || (typed && site === "none");
    if (!own || (origin !== undefined && origin !== new URL(context.req.url).origin)) return context.text("Forbidden", 403);

    return next();
  };
}

/** Let a change through only when its media type is JSON, whatever parameters follow it. */
const jsonOnly: MiddlewareHandler<Shared> = async (context, next) => {
  if (!hasContentType(context.req.raw, "json")) return refused(context, { code: "not_json" });

  return next();
};

/**
 * Build the console.
 *
 * @returns a handler for every request under the console's base path. A request that is not admitted gets a refusal and nothing of the install:
 * 401 from a data route and 403 from a page with no login behind it, 403 for an email that is no user, 503 while the login cannot be checked.
 * Its `fetch` rejects with whatever a request failed with, but for a day's allowance used up, which it answers. Given what the host holds a request open with, work an answer is not held for runs on past it
 */
export function createConsole(parts: ConsoleParts): Console {
  const app = new Hono<Shared>().basePath(parts.base === "" ? "/" : parts.base);

  const noStore: MiddlewareHandler<Shared> = async (context, next) => {
    await next();
    context.res.headers.set("Cache-Control", "no-store");
  };

  app.use(secureHeaders({ contentSecurityPolicy: POLICY, xFrameOptions: "DENY", referrerPolicy: "same-origin" }));

  app.use(admitted(parts));

  app.get("/assets/:name", async (context) => {
    const asset = await assetOf(parts.client, context.req.param("name"));
    if (asset === undefined) return context.notFound();

    return context.body(asset.body, 200, { "Content-Type": asset.type, "Cache-Control": KEPT_FOR_GOOD });
  });

  // A browser asks for this name unbidden, before any page says where the icon is: it gets the icon, not the page.
  app.get("/favicon.ico", (context) => context.body(ICON.body, 200, { "Content-Type": ICON.type, "Cache-Control": KEPT_A_DAY }));

  app.use(noStore);
  app.post("*", bodyLimit({ maxSize: MOST_BODY_BYTES, onError: (context) => refused(context, { code: "too_large" }) }), ownPageOnly(false), jsonOnly);

  // A browser sends the login along with a request of a site's page, so no data is read for one: nothing but the browser would keep the answer from that page.
  app.use("/data/*", ownPageOnly(true));

  app.route("/data", dataRoutes);
  app.all("/data/*", (context) => refused(context, { code: "no_page" }));

  app.get("*", async (context) => {
    const { install, actor } = context.get("asker");
    await parts.entered({ email: context.get("email"), since: context.get("since") });
    const asked = { version: parts.version, domain: parts.domain?.words.thing, selfCarried: parts.follow?.holdsKey() === true, keyed: parts.update.holdsKey() };
    const frame = await frameOf(install, actor, asked);

    const boot = { ...frame, title: TITLE, base: parts.base, email: context.get("email"), version: parts.version, demo: parts.demo ?? null, domain: parts.domain !== undefined };

    return context.html(shellPage(boot, await parts.client.entry()));
  });

  // A day's allowance that is used up is answered here, in the console's words, and a refusal of the framework is its own answer. Any other failure is the host's to answer and to write down.
  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();

    if (!isSpent(error)) throw error;

    return spentAnswer(error, { path: new URL(context.req.url).pathname, base: parts.base, now: parts.install.now() });
  });

  return { fetch: async (request, later) => app.fetch(request, holding(later)) };
}
