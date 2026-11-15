// The setup screen: the first-run page in the console's look, shown before anyone has logged in. One page loads the client, and the client sends each run as JSON.
//
//   GET  <at>                the page that loads the client; it carries which boxes the form has and what a token must hold, and nothing of the install
//   GET  <at>/assets/<file>  the client's script, stylesheet, and fonts, which a browser keeps for good
//   POST <at>/data/check     read every piece with the token in the body
//   POST <at>/data/repair    make every piece match; on an install with nothing set it also gives the install its domain and first login
//   anything else            the setup's own handler, which answers the two paths a program calls
//
// Every run is the setup page's own run of a program's call: it is counted against the sender's address, refused when the counter cannot answer, and reads nothing of the install before the token is proven.
// The token is in the body of its one request and nowhere else. While the page is shut every path answers 404 and says nothing.

import { mediaTypeOf } from "@poplin/core/src/api/media-type";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { createSetup } from "./domain/setup";
import type { DomainReading } from "./domain/records";
import type { DomainRun } from "./domain/domain-run";
import { POLICY } from "./console";
import { runDone, runRefusal } from "./domain-answers";
import { type ClientFiles, KEPT_FOR_GOOD, shellPage } from "./shell";

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

/** What the handlers of one request share: the setup's own handler, which runs a program's call. */
interface SetupShared {
  Variables: { runs: (request: Request) => Promise<Response> };
}

/** What a run carries: the token, and beside it the domain and the first login of an install with nothing set, or an email that corrects the first login. */
interface Sent {
  readonly token: string;
  readonly domain?: string;
  readonly login?: string;
}

/** The statuses a refused run goes out with: a refusal of the run, of a body that is no JSON or too large, and of too many tries. */
type RefusedStatus = 400 | 403 | 413 | 415 | 429 | 502 | 503;

/** What the setup page answers a program's run. */
type Answered = (Extract<DomainReading, { readonly ok: true }> & { readonly expects?: string }) | { readonly ok: false; readonly refusal: string };

/** Says what a run's body holds, for the client's types alone: the body is read by the run itself, which counts the try first. */
const carries: MiddlewareHandler<SetupShared, string, { in: { json: Sent }; out: { json: Sent } }> = async (_context, next) => next();

function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Send a run to the setup's own handler as a program's call, and answer what it read as the screen draws it. */
async function ran(context: Context<SetupShared>, run: DomainRun) {
  const answered = await context.get("runs")(new Request(new URL(`${SETUP_PATH}/api/${run}`, context.req.url), context.req.raw));

  // A page that is shut, or a failure, answers in plain words that say nothing: they go out as they are.
  if (mediaTypeOf(answered.headers.get("Content-Type")) !== "application/json") return context.text(await answered.text(), answered.status === 404 ? 404 : 500);

  const read = (await answered.json()) as Answered;
  if (read.ok) return context.json({ ...runDone(run, read), expects: read.expects ?? null }, 200);

  const wait = answered.headers.get("Retry-After");

  return context.json(runRefusal(read.refusal), answered.status as RefusedStatus, wait === null ? {} : { "Retry-After": wait });
}

/** The setup screen's two runs. */
const setupRoutes = new Hono<SetupShared>().post("/check", carries, (context) => ran(context, "check")).post("/repair", carries, (context) => ran(context, "repair"));

/** The type the setup screen's calls are checked against. */
export type SetupRoutes = typeof setupRoutes;

/**
 * Build the setup screen over the setup's own handler.
 *
 * @returns a handler for the page, the client's files, and the two runs; every other request goes to the setup's own handler. While `open` answers `false`, or fails to say, every path is a 404 that says nothing
 */
export function createSetupConsole(parts: SetupConsoleParts): { readonly fetch: (request: Request) => Promise<Response> } {
  // The gate below asks whether the page is open, once a request, before anything reaches the page's own handler: that one is told yes.
  const setup = createSetup({ ...parts, open: async () => true });
  const at = parts.at ?? SETUP_PATH;
  const { tokenRights, tokenLink, tokenOptional, tokenNote } = parts.domain;
  const start = { boxes: "plugFor" in parts.domain ? "first" : "login", form: { tokenRights, tokenLink, tokenOptional, tokenNote } };
  const app = new Hono<SetupShared>();

  const gate: MiddlewareHandler<SetupShared> = async (context, next) => {
    // Asked inside a promise, so a question that throws before it answers is a shut page too.
    const open = await Promise.resolve()
      .then(() => parts.open())
      .catch(() => false);
    if (!open) return notFound();

    context.set("runs", setup.fetch);
    await next();
    // A file of the client says itself how long a browser keeps it; nothing else is kept.
    if (!context.res.headers.has("Cache-Control")) context.res.headers.set("Cache-Control", "no-store");
  };

  app.use(secureHeaders({ contentSecurityPolicy: POLICY, xFrameOptions: "DENY", referrerPolicy: "same-origin" }), gate);

  app.get(at, async (context) =>
    context.html(shellPage({ base: at, email: "", title: TITLE, version: "", update: null, starts: false, demo: null, domain: false, domainNote: null, setup: start }, await parts.client.entry())),
  );
  app.get(`${at}/assets/:name`, async (context) => {
    const asset = await parts.client.file(context.req.param("name"));
    if (asset === undefined) return notFound();

    return context.body(asset.body, 200, { "Content-Type": asset.type, "Cache-Control": KEPT_FOR_GOOD });
  });
  app.route(`${at}/data`, setupRoutes);
  app.all("*", (context) => setup.fetch(context.req.raw));

  return { fetch: async (request) => app.fetch(request) };
}
