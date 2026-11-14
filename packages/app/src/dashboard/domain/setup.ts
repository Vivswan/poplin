// The setup page: the Domain tab's table and form for an install nobody can log in to yet, with no session behind it.
//
//   GET  /setup          the token form, and nothing about the install; on an install with nothing set, two boxes more: its domain and its first login
//   POST /setup/check    the table, read with the pasted token
//   POST /setup/repair   the table, after making every object match
//   POST /setup/api/check, /setup/api/repair   the same two runs for a program: the token in a JSON body, the reading as JSON
//
// The pasted token is the only proof of ownership: the plug refuses one that does not act on the install's own account. Until one passes nothing of the install is read, so no answer can say anything of it.
// A run on an install with nothing set writes nothing to the install's own database: what it changes is at the provider, under the token's own account.
// No answer hands a typed value back: every box of the form comes back empty, and a refusal names the box and never what was in it.
// Every post is counted against the sender's address first, and a counter that cannot answer refuses: the page stays shut when its guard is gone.

import type { Install } from "@poplin/core/src/actions/records";
import { parseLogin } from "@poplin/core/src/auth/logins";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { NONCE, secureHeaders } from "hono/secure-headers";

import type { Counters } from "../../limits/limits";
import { framePage, refusedPage } from "../page/frame";
import type { Form, Page } from "../records";
import { importCsrfKey, mintCsrfToken } from "../security/csrf";
import { readOwnForm } from "../security/own-form";
import type { DomainPlug, DomainReading, FirstRun } from "./records";
import { type DomainRun, REFUSAL_STATUS, runDomain } from "./domain-run";
import { domainBody } from "./domain-table";

/** The page's title and heading: neither says anything of the install. */
const TITLE = "poplin";

/** The one page. */
const PLACE = { tab: "domain", heading: "Setup" } as const;

/** How many posts one address may send in a minute. */
const TRIES_PER_MINUTE = 5;

/** The most bytes a posted form holds: a token, a domain, an email, and the form's own token. */
const MAX_FORM_BYTES = 16 * 1024;

/** Who the forms' tokens are made for: the page has no session to bind them to. */
const CSRF_NAME = "setup";

/** The content type a program sends its token in. A page of another origin cannot post it without the browser asking first, so the two paths need no form token. */
const JSON_TYPE = "application/json";

/** The whole answer of a page that is shut and of every other path. */
const NOT_FOUND = "Not found.";

/** The whole answer to a failure nothing above handled: it tells nothing of the cause. */
const FAILURE = "Something went wrong.";

/** What the setup page is built from. */
interface SetupParts {
  /** The install's database, which holds the settings and takes the audit entry, and its clock. */
  readonly install: Pick<Install, "database" | "now">;

  /** The provider's side of the install, or of an install with nothing set. It must refuse a token that does not act on the install's own account. */
  readonly domain: DomainPlug | FirstRun;

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

/** What a form or a program sent: the token, and for an install with nothing set its domain and its first login. A field that was not sent is empty. */
interface Sent {
  readonly token: string;
  readonly domain: string;
  readonly login: string;
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

/** Count one try against the sender's address, for a page's form and a program's call alike, and say whether it fits the minute. A counter that cannot answer refuses it. */
async function fits(parts: SetupParts, request: Request): Promise<boolean> {
  const take = async (): Promise<{ readonly ok: boolean }> =>
    parts.counters.takeMinute({ scope: "visitor", key: `setup:${await parts.visitorOf(request)}`, limit: TRIES_PER_MINUTE }, parts.install.now());

  return (await take().catch(() => ({ ok: false }))).ok;
}

/** Read what a program's call sent: `undefined` for a body that is not sent as JSON, and an empty text for each field the JSON holds no text for. */
async function sentBy(request: Request): Promise<Sent | undefined> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== JSON_TYPE) return undefined;

  const body: unknown = await request.json().catch(() => undefined);
  const fields: Readonly<Record<string, unknown>> = typeof body === "object" && body !== null ? { ...body } : {};
  const text = (name: string): string => (typeof fields[name] === "string" ? fields[name] : "");

  return { token: text("token"), domain: text("domain"), login: text("login") };
}

/** The domain as it was meant: a person types capitals and a space after it, and a domain has neither. */
function typedDomain(sent: Sent): string {
  return sent.domain.trim().toLowerCase();
}

/**
 * Run the plug once for what was sent.
 *
 * On an install with nothing set the plug is made for the typed domain and login, its settings are the defaults of such an install, and the run is not recorded: no value of it is stored here.
 */
async function runFor(parts: SetupParts, run: DomainRun, sent: Sent): Promise<DomainReading> {
  const { domain, install } = parts;
  if (!("plugFor" in domain)) return runDomain(domain, install, { run, token: sent.token, settings: () => install.database.readSettings(), from: "setup" });

  const login = parseLogin(sent.login);
  if (!login.ok) return { ok: false, refusal: "bad_login" };

  const plug = domain.plugFor({ domain: typedDomain(sent), login: login.value });
  if (plug === undefined) return { ok: false, refusal: "bad_domain" };

  const settings = async (): Promise<ReturnType<typeof defaultSettings>> => defaultSettings({ installer: login.value, hostname: typedDomain(sent) });

  return runDomain(plug, install, { run, token: sent.token, settings, from: "setup", unrecorded: true });
}

/**
 * Build the setup page.
 *
 * @returns a handler for `/setup`, the two paths under it, and the two a program calls; every other path, and every path while `open` answers `false`, is a 404 that says nothing
 * @throws {RangeError} the CSRF secret is under 32 bytes
 */
export function createSetup(parts: SetupParts): Setup {
  const csrfKey = importCsrfKey(parts.csrfSecret);
  const { tokenLabel, tokenRights, tokenLink, tokenByHand, tokenNote } = parts.domain;
  const asks = { tokenLabel, tokenRights, tokenLink, tokenByHand, tokenNote };
  const nothingSet = "plugFor" in parts.domain;
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
    if (!(await fits(parts, context.req.raw))) return refuse(context, "too_many_tries", 429);

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
      // A form of the page then carries the page's origin; a request to any other origin carries no referrer.
      referrerPolicy: "same-origin",
    }),
  );
  app.use(gate);

  app.get("/setup", (context) =>
    respond(context, { ...PLACE, body: domainBody({ csrf: context.get("csrf"), ...asks, nothingSet, path: "/setup" }) }),
  );

  app.post(
    "/setup/:run",
    counted,
    bodyLimit({ maxSize: MAX_FORM_BYTES, onError: (context) => refuse(context, "too_large", 413) }),
    fromHere,
    async (context) => {
      const run = context.req.param("run");
      if (run !== "check" && run !== "repair") return notFound();

      const form = context.get("form");
      const sent = { token: form.get("token") ?? "", domain: form.get("domain") ?? "", login: form.get("login") ?? "" };
      const reading = await runFor(parts, run, sent);
      const body = domainBody({ csrf: context.get("csrf"), ...asks, nothingSet, path: "/setup", ran: { run, reading } });
      if (reading.ok) return respond(context, { ...PLACE, body });

      return respond(context, { ...PLACE, body, status: REFUSAL_STATUS[reading.refusal] });
    },
  );

  app.post("/setup/api/:run", bodyLimit({ maxSize: MAX_FORM_BYTES, onError: (context) => context.json({ ok: false, refusal: "too_large" }, 413) }), async (context) => {
    const run = context.req.param("run");
    if (run !== "check" && run !== "repair") return notFound();

    if (!(await fits(parts, context.req.raw))) return context.json({ ok: false, refusal: "too_many_tries" }, 429);

    const sent = await sentBy(context.req.raw);
    if (sent === undefined) return context.json({ ok: false, refusal: "not_json" }, 415);

    const reading = await runFor(parts, run, sent);

    return context.json(reading, reading.ok ? 200 : REFUSAL_STATUS[reading.refusal]);
  });

  app.notFound(() => notFound());
  app.onError(() => new Response(FAILURE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }));

  return { fetch: async (request) => app.fetch(request) };
}
