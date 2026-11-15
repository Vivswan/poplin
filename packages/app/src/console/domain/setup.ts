// The setup's own handler: the two runs a program calls on an install nobody can log in to yet, with no session behind them.
//
//   POST /setup/api/check    read every piece with the token in a JSON body, and answer the reading as JSON
//   POST /setup/api/repair   make every piece match; on an install with nothing set it also gives the install its domain and first login
//
// The setup screen sends its runs through the same two paths, so a person's press and a program's call are one run.
// The token is the only proof of ownership: the plug refuses one that does not act on the install's own account. Until one passes nothing of the install is read, so no answer can say anything of it.
// A run on an install with nothing set writes nothing to the install's own database: what it changes is at the provider, under the token's own account.
// The setup is open until somebody has logged in. Until then the first login may have been mistyped, with nobody able to log in to mend it: an email sent here, with a proven token, replaces it.
// No answer hands a sent value back: a refusal names the field and never what was in it.
// Every try is counted against the sender's address before the plug is asked, and a counter that cannot answer refuses: the setup stays shut when its guard is gone.
// A call is a try only once it is sent as JSON: one that a page of another origin made a browser send is refused uncounted, so it cannot use up the tries of the person at that address.

import type { Install } from "@poplin/core/src/actions/records";
import { storeFirstLogin } from "@poplin/core/src/actions/store-settings";
import { type Login, parseLogin } from "@poplin/core/src/auth/logins";
import { AllowanceSpent, secondsToNextDay } from "@poplin/core/src/database/driver";
import { defaultSettings, type SettingValues } from "@poplin/core/src/records/settings";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as v from "valibot";

import { hasContentType } from "../../api/body";
import type { Counters } from "../../limits/limits";
import { type DomainRun, REFUSAL_STATUS, runDomain } from "./domain-run";
import type { DomainPlug, DomainReading, FirstRun } from "./records";

/** How many runs one address may send in a minute. */
const TRIES_PER_MINUTE = 5;

/** The most bytes a run's body holds: a token, a domain, and an email. */
const MAX_BODY_BYTES = 16 * 1024;

/** What a run sent: the token, the first login, and for an install with nothing set its domain. A field that was not sent, or holds no text, is empty, and so is every field of a body that is no JSON object. */
const SENT = v.fallback(v.object({ token: v.fallback(v.string(), ""), domain: v.fallback(v.string(), ""), login: v.fallback(v.string(), "") }), { token: "", domain: "", login: "" });

/** The whole answer of a setup that is shut and of every other path. */
const NOT_FOUND = "Not found.";

/** The whole answer to a failure nothing above handled: it tells nothing of the cause. */
const FAILURE = "Something went wrong.";

/** What the setup is built from. */
interface SetupParts {
  /** The install's database, which holds the settings and takes the audit entry, and its clock. */
  readonly install: Pick<Install, "database" | "now">;

  /** The provider's side of the install, or of an install with nothing set. It must refuse a token that does not act on the install's own account. */
  readonly domain: DomainPlug | FirstRun;

  /** Whether the setup answers at all, asked on every request. `false`, or a failure to say, is a 404. */
  readonly open: () => Promise<boolean>;

  /** Where the tries of each address are counted. */
  readonly counters: Pick<Counters, "takeMinute">;

  /** What a request's tries are counted by: its sender's address, or a key made from it, as the host saw it. */
  readonly visitorOf: (request: Request) => Promise<string>;
}

/** What a run sent, as read. */
type Sent = v.InferOutput<typeof SENT>;

/** Something that answers a request. */
interface Setup {
  readonly fetch: (request: Request) => Promise<Response>;
}

/**
 * Build the answer to a program's run while the database takes no more for the day.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns status 503 with the refusal `allowance_spent` as JSON and `Retry-After` up to the next midnight UTC
 */
export function spentRun(now: number): Response {
  return Response.json({ ok: false, refusal: "allowance_spent" }, { status: 503, headers: { "Retry-After": String(secondsToNextDay(now)), "Cache-Control": "no-store" } });
}

function notFound(): Response {
  return new Response(NOT_FOUND, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Count one try against the sender's address, and say whether it fits the minute. A counter that cannot answer refuses it. */
async function fits(parts: SetupParts, request: Request): Promise<boolean> {
  const take = async (): Promise<{ readonly ok: boolean }> =>
    parts.counters.takeMinute({ scope: "visitor", key: `setup:${await parts.visitorOf(request)}`, limit: TRIES_PER_MINUTE }, parts.install.now());

  return (await take().catch(() => ({ ok: false }))).ok;
}

/** The domain as it was meant: a person types capitals and a space after it, and a domain has neither. */
function typedDomain(sent: Sent): string {
  return sent.domain.trim().toLowerCase();
}

/**
 * Read the settings a run on a set install is made to match, with the first login corrected where an email was sent.
 *
 * The plug asks for the settings only once the token is proven for the install's own account, so nothing is stored, and nothing of the install is read, for anybody else.
 * A repair stores the sent email as the only login. A check stores nothing, and shows what such a repair would change.
 */
async function settingsWith(install: SetupParts["install"], run: DomainRun, login: Login | undefined): Promise<SettingValues> {
  const stored = await install.database.readSettings();
  if (stored === undefined) throw new Error("the install has no settings, which every install stores before it answers a request");

  if (login === undefined) return stored;

  if (run === "check") return { ...stored, logins: [login] };

  const corrected = await storeFirstLogin(install, login);

  return corrected.ok ? corrected.values : stored;
}

/**
 * Run the plug once for what was sent.
 *
 * On an install with nothing set the plug is made for the sent domain and login, its settings are the defaults of such an install, and the run is not recorded: no value of it is stored here.
 * On a set install an email is taken as the correction of the first login, and an empty one keeps the stored one.
 */
async function runOnce(parts: SetupParts, run: DomainRun, sent: Sent): Promise<DomainReading> {
  const { domain, install } = parts;
  // A token pasted into the email's box is no email: it is refused before the plug is asked, so it is never stored as a login or answered back.
  if (sent.token !== "" && sent.login.toLowerCase().includes(sent.token.toLowerCase())) return { ok: false, refusal: "bad_login" };

  if (!("plugFor" in domain)) {
    const typed = sent.login.trim() === "" ? undefined : parseLogin(sent.login);
    if (typed?.ok === false) return { ok: false, refusal: "bad_login" };

    return runDomain(domain, install, { run, token: sent.token, settings: () => settingsWith(install, run, typed?.value), from: "setup" });
  }

  const login = parseLogin(sent.login);
  if (!login.ok) return { ok: false, refusal: "bad_login" };

  const plug = domain.plugFor({ domain: typedDomain(sent), login: login.value });
  if (plug === undefined) return { ok: false, refusal: "bad_domain" };

  const settings = async (): Promise<ReturnType<typeof defaultSettings>> => defaultSettings({ installer: login.value });

  return runDomain(plug, install, { run, token: sent.token, settings, from: "setup", unrecorded: true });
}

/** Run the plug once for what was sent. A database whose allowance for the day is used up is the refusal `allowance_spent`, whatever the plug did before the database was asked. */
async function runFor(parts: SetupParts, run: DomainRun, sent: Sent): Promise<DomainReading> {
  try {
    return await runOnce(parts, run, sent);
  } catch (error) {
    if (error instanceof AllowanceSpent) return { ok: false, refusal: "allowance_spent" };

    throw error;
  }
}

/**
 * Build the setup's own handler.
 *
 * @returns a handler for the two paths a program calls; every other path, and every path while `open` answers `false`, is a 404 that says nothing
 */
export function createSetup(parts: SetupParts): Setup {
  const boxes = "plugFor" in parts.domain ? "first" : "login";

  // Said only after a run the plug took, so only to a token proven for the install's own account.
  const expects = async (reading: DomainReading): Promise<string | undefined> =>
    reading.ok && boxes === "login" ? (await parts.install.database.readSettings())?.logins.join(", ") : undefined;
  const app = new Hono();

  const gate: MiddlewareHandler = async (context, next) => {
    // Asked inside a promise, so a question that throws before it answers is a shut setup too.
    const open = await Promise.resolve()
      .then(() => parts.open())
      .catch(() => false);
    if (!open) return notFound();

    await next();
    context.res.headers.set("Cache-Control", "no-store");
  };

  app.use(gate);

  app.post("/setup/api/:run", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (context) => context.json({ ok: false, refusal: "too_large" }, 413) }), async (context) => {
    const run = context.req.param("run");
    if (run !== "check" && run !== "repair") return notFound();

    // Before the count: a call in any other type is one a page of another origin could have made a browser send, and JSON is one it cannot send unasked.
    if (!hasContentType(context.req.raw, "json")) return context.json({ ok: false, refusal: "not_json" }, 415);

    if (!(await fits(parts, context.req.raw))) return context.json({ ok: false, refusal: "too_many_tries" }, 429);

    const reading = await runFor(parts, run, v.parse(SENT, await context.req.raw.json().catch(() => undefined)));
    if (!reading.ok && reading.refusal === "allowance_spent") return spentRun(parts.install.now());

    if (!reading.ok) return context.json(reading, REFUSAL_STATUS[reading.refusal]);

    return context.json({ ...reading, expects: await expects(reading) });
  });

  app.notFound(() => notFound());
  app.onError(() => new Response(FAILURE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }));

  return { fetch: async (request) => app.fetch(request) };
}
