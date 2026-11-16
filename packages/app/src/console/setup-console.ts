// The setup screen: the first-run page in the console's look, and once somebody has logged in the way back in when the login is broken. One page loads the client, and the client sends its run as JSON.
//
//   GET  <at>                the page that loads the client; it carries which boxes the form has and what a token must hold, and nothing of the install
//   GET  <at>/assets/<file>  the console's icon and the client's script, stylesheet, and fonts, which a browser keeps for good
//   POST <at>/data/repair    make every piece match; on an install with nothing set it also gives the install its domain and first login
//   anything else            the setup's own handler, which answers the two paths a program calls
//
// The run is a program's repair, sent by the page: it is counted against the sender's address, refused when the counter cannot answer, and reads nothing of the install before the token is proven.
// The token is in the body of its one request and nowhere else. A page that is shut answers 404 on every path and says nothing.

import { mediaTypeOf } from "@poplin/core/src/api/media-type";
import type { TokenFacts } from "@poplin/core/src/install/token-facts";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { createSetup, kindSent, type SetupForm, setupForm } from "./domain/setup";
import type { DomainReading, FirstRun } from "./domain/records";
import { POLICY } from "./console";
import { runDone, runRefusal } from "./domain-answers";
import { NOTHING_MARKED } from "./problems-routes";
import { assetOf, type ClientFiles, KEPT_FOR_GOOD, shellPage } from "./shell";

/** The page's title: it says nothing of the install. */
const TITLE = "Setup - poplin";

/** Where the setup page answers when a host names no other place. */
const SETUP_PATH = "/setup";

/** The whole answer of a page that is shut. */
const NOT_FOUND = "Not found.";

/** What the setup's own handler is built from. */
type SetupParts = Parameters<typeof createSetup>[0];

/** What the setup screen is built from: the setup page's own parts, and the client's files. */
interface SetupConsoleParts extends SetupParts {
  /** The client's built files. */
  readonly client: ClientFiles;

  /** The path the page answers at; `/setup` when left out. */
  readonly at?: string;
}

/** What the handlers of one request share: the form the setup has for it, the setup's own handler, which runs a program's call, and what a token for a run's body must be made for. */
interface SetupShared {
  Variables: { form: SetupForm; runs: (request: Request) => Promise<Response>; tokenFor: (body: unknown) => string };
}

/** What a token must hold and where one is made, as the page shows it. */
type ShownForm = Omit<TokenFacts, "tokenFor">;

/** What a run carries: the token, and beside it the first login of an install with nothing set, with its domain where it has one, or an email that corrects the first login. */
interface Sent {
  readonly token: string;
  readonly domain?: string;
  readonly login?: string;
}

/** What the setup page hands its client to start from. */
export type SetupStart = ReturnType<typeof startOf>;

/** The statuses a refused run goes out with: a refusal of the run, of a body that is no JSON or too large, and of too many tries. */
type RefusedStatus = 400 | 403 | 413 | 415 | 429 | 502 | 503;

/** What the setup page answers a program's run. */
type Answered = (Extract<DomainReading, { readonly ok: true }> & { readonly expects?: string }) | { readonly ok: false; readonly refusal: string };

/** Says what a run's body holds, for the client's types alone: the body is read by the run itself, which counts the try first. */
const carries: MiddlewareHandler<SetupShared, string, { in: { json: Sent }; out: { json: Sent } }> = async (_context, next) => next();

function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** What a token must hold and where one is made, and nothing else of whatever carries it. */
function formOf({ tokenRights, tokenLink, tokenOptional, tokenNote }: TokenFacts): ShownForm {
  return { tokenRights, tokenLink, tokenOptional, tokenNote };
}

/**
 * What the page hands its client to start from: on an install with nothing set a token's form for each kind of install a person can choose, and on a set one the one form of its kind.
 * `repair` is the page of an install somebody has logged in to, and says that one thing of it.
 */
function startOf(
  domain: SetupParts["domain"],
  form: SetupForm,
): { readonly boxes: "first"; readonly forms: Readonly<Record<keyof FirstRun["forms"], ShownForm>> } | { readonly boxes: "login" | "repair"; readonly form: ShownForm } {
  if (!("plugFor" in domain)) return { boxes: form === "repair" ? "repair" : "login", form: formOf(domain) };

  return { boxes: "first", forms: { domain: formOf(domain.forms.domain), "no-domain": formOf(domain.forms["no-domain"]) } };
}

/** Send a repair to the setup's own handler as a program's call, and answer what it did as the screen draws it. */
async function repaired(context: Context<SetupShared>) {
  // The run reads the body itself. A copy is kept for the one refusal whose sentence hangs on what was sent.
  const sent = context.req.raw.clone();
  const answered = await context.get("runs")(new Request(new URL(`${SETUP_PATH}/api/repair`, context.req.url), context.req.raw));

  // A page that is shut, or a failure, answers in plain words that say nothing: they go out as they are.
  if (mediaTypeOf(answered.headers.get("Content-Type")) !== "application/json") return context.text(await answered.text(), answered.status === 404 ? 404 : 500);

  const read = (await answered.json()) as Answered;
  if (read.ok) return context.json({ ...runDone("repair", read, false), expects: read.expects ?? null }, 200);

  const wait = answered.headers.get("Retry-After");

  // Only a run that read its body refuses the token, so the copy is read for that refusal alone.
  const tokenFor = read.refusal === "token" ? context.get("tokenFor")(await sent.json().catch(() => undefined)) : "";

  return context.json(runRefusal(read.refusal, tokenFor), answered.status as RefusedStatus, wait === null ? {} : { "Retry-After": wait });
}

/** The setup screen's one run. */
const setupRoutes = new Hono<SetupShared>().post("/repair", carries, (context) => repaired(context));

/** The type the setup screen's call is checked against. */
export type SetupRoutes = typeof setupRoutes;

/**
 * Build the setup screen over the setup's own handler.
 *
 * @returns a handler for the page, the client's files, and the run; every other request goes to the setup's own handler. A setup that is shut, as `setupForm` says, is a 404 on every path that says nothing
 */
export function createSetupConsole(parts: SetupConsoleParts): { readonly fetch: (request: Request) => Promise<Response> } {
  const at = parts.at ?? SETUP_PATH;
  const { domain } = parts;
  const tokenFor = (body: unknown): string => ("plugFor" in domain ? domain.forms[kindSent(body)].tokenFor : domain.tokenFor);
  const app = new Hono<SetupShared>();

  const gate: MiddlewareHandler<SetupShared> = async (context, next) => {
    const form = await setupForm(parts);
    if (form === undefined) return notFound();

    // Whether anybody has logged in is asked once a request, here: the setup's own handler is told what was answered.
    const loggedIn = form === "repair";
    context.set("form", form);
    context.set("runs", createSetup({ ...parts, loggedIn: async () => loggedIn }).fetch);
    context.set("tokenFor", tokenFor);
    await next();
    // A file of the client says itself how long a browser keeps it; nothing else is kept.
    if (!context.res.headers.has("Cache-Control")) context.res.headers.set("Cache-Control", "no-store");
  };

  app.use(secureHeaders({ contentSecurityPolicy: POLICY, xFrameOptions: "DENY", referrerPolicy: "same-origin" }), gate);

  app.get(at, async (context) => {
    const frame = { update: null, starts: false, back: null, signOut: null, domainNote: null, ...NOTHING_MARKED };

    return context.html(shellPage({ base: at, email: "", title: TITLE, version: "", demo: null, domain: false, ...frame, setup: startOf(domain, context.get("form")) }, await parts.client.entry()));
  });
  app.get(`${at}/assets/:name`, async (context) => {
    const asset = await assetOf(parts.client, context.req.param("name"));
    if (asset === undefined) return notFound();

    return context.body(asset.body, 200, { "Content-Type": asset.type, "Cache-Control": KEPT_FOR_GOOD });
  });
  app.route(`${at}/data`, setupRoutes);
  app.all("*", (context) => context.get("runs")(context.req.raw));

  return { fetch: async (request) => app.fetch(request) };
}
