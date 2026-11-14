// The setup page: the Domain tab's table and form for an install nobody can log in to yet, with no session behind it.
//
//   GET  /setup          the token form, and nothing about the install
//   POST /setup/check    the table, read with the pasted token
//   POST /setup/repair   the table, after making every object match
//
// The pasted token is the only proof of ownership: the plug refuses one that does not act on the install's own account. Until one passes nothing of the install is read, so no answer can say anything of it.
// Every post is counted against the sender's address first, and a counter that cannot answer refuses: the page stays shut when its guard is gone.

import type { Install } from "@poplin/core/src/actions/records";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { NONCE, secureHeaders } from "hono/secure-headers";

import type { Counters } from "../../limits/limits";
import { framePage, refusedPage } from "../page/frame";
import type { Form, Page } from "../records";
import { importCsrfKey, mintCsrfToken } from "../security/csrf";
import { readOwnForm } from "../security/own-form";
import type { DomainPlug, ReadSettings } from "./records";
import { REFUSAL_STATUS, runDomain } from "./domain-run";
import { domainBody } from "./domain-table";

/** The page's title and heading: neither says anything of the install. */
const TITLE = "poplin";

/** The one page. */
const PLACE = { tab: "domain", heading: "Setup" } as const;

/** How many posts one address may send in a minute. */
const TRIES_PER_MINUTE = 5;

/** The most bytes a posted form holds: a token and the form's own token. */
const MAX_FORM_BYTES = 16 * 1024;

/** Who the forms' tokens are made for: the page has no session to bind them to. */
const CSRF_NAME = "setup";

/** The whole answer of a page that is shut and of every other path. */
const NOT_FOUND = "Not found.";

/** The whole answer to a failure nothing above handled: it tells nothing of the cause. */
const FAILURE = "Something went wrong.";

/** What the setup page is built from. */
interface SetupParts {
  /** The install's database, which holds the settings and takes the audit entry, and its clock. */
  readonly install: Pick<Install, "database" | "now">;

  /** The provider's side of the install. It must refuse a token that does not act on the install's own account. */
  readonly domain: DomainPlug;

  /** Whether the page answers at all, asked on every request. `false`, or a failure to say, is a 404. */
  readonly open: () => Promise<boolean>;

  /** Where the tries of each address are counted. */
  readonly counters: Pick<Counters, "takeMinute">;

  /** What a request's tries are counted by: its sender's address, or a key made from it, as the host saw it. */
  readonly visitorOf: (request: Request) => Promise<string>;

  /** At least 32 random bytes that sign the forms' tokens, used for nothing else. */
  readonly csrfSecret: Uint8Array<ArrayBuffer>;
}

/** What the handlers of one request share. */
interface Shared {
  Variables: { csrf: string; form: Form };
}

/** Something that answers a request. */
interface Setup {
  readonly fetch: (request: Request) => Promise<Response>;
}

function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function respond(context: Context<Shared>, page: Page): Promise<Response> {
  const document = await framePage(page, { title: TITLE, nonce: context.get("secureHeadersNonce") ?? "", tabs: "none" });

  return context.html(document, page.status ?? 200);
}

function refuse(context: Context<Shared>, code: string, status: NonNullable<Page["status"]>): Promise<Response> {
  return respond(context, refusedPage({ ...PLACE, status }, { code }));
}

/**
 * Build the setup page.
 *
 * @returns a handler for `/setup` and the two paths under it; every other path, and every path while `open` answers `false`, is a 404 that says nothing
 * @throws {RangeError} the CSRF secret is under 32 bytes
 */
export function createSetup(parts: SetupParts): Setup {
  const csrfKey = importCsrfKey(parts.csrfSecret);
  const app = new Hono<Shared>();

  const gate: MiddlewareHandler<Shared> = async (context, next) => {
    // Asked inside a promise, so a question that throws before it answers is a shut page too.
    const open = await Promise.resolve()
      .then(() => parts.open())
      .catch(() => false);
    if (!open) return notFound();

    context.set("csrf", await mintCsrfToken({ key: await csrfKey, email: CSRF_NAME, now: parts.install.now() }));
    await next();
    context.res.headers.set("Cache-Control", "no-store");
  };

  const counted: MiddlewareHandler<Shared> = async (context, next) => {
    const request = context.req.raw;
    const take = async () =>
      parts.counters.takeMinute({ scope: "visitor", key: `setup:${await parts.visitorOf(request)}`, limit: TRIES_PER_MINUTE }, parts.install.now());
    const taken = await take().catch(() => ({ ok: false }));
    if (!taken.ok) return refuse(context, "too_many_tries", 429);

    return next();
  };

  const fromHere: MiddlewareHandler<Shared> = async (context, next) => {
    const sent = await readOwnForm(context.req.raw, { key: await csrfKey, email: CSRF_NAME, now: parts.install.now() });
    if (!sent.ok) return refuse(context, sent.code, sent.status);

    context.set("form", sent.form);

    return next();
  };

  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], styleSrc: [NONCE], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      xFrameOptions: "DENY",
    }),
  );
  app.use(gate);

  app.get("/setup", (context) =>
    respond(context, { ...PLACE, body: domainBody({ csrf: context.get("csrf"), tokenLabel: parts.domain.tokenLabel, path: "/setup" }) }),
  );

  app.post(
    "/setup/:run",
    counted,
    bodyLimit({ maxSize: MAX_FORM_BYTES, onError: (context) => refuse(context, "too_large", 413) }),
    fromHere,
    async (context) => {
      const run = context.req.param("run");
      if (run !== "check" && run !== "repair") return notFound();

      // The settings are handed over as a question the plug asks once the token is proven. The audit entry names the first login: no session says who pasted the token.
      const settings = (): ReturnType<ReadSettings> => parts.install.database.readSettings();
      const reading = await runDomain(parts.domain, parts.install, { run, token: context.get("form").get("token") ?? "", settings, from: "setup" });
      const body = domainBody({ csrf: context.get("csrf"), tokenLabel: parts.domain.tokenLabel, path: "/setup", ran: { run, reading } });
      if (reading.ok) return respond(context, { ...PLACE, body });

      return respond(context, { ...PLACE, body, status: REFUSAL_STATUS[reading.refusal] });
    },
  );

  app.notFound(() => notFound());
  app.onError(() => new Response(FAILURE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }));

  return { fetch: async (request) => app.fetch(request) };
}
