// The setup's own handler: the two runs a program calls with no login behind them, on an install nobody can log in to yet, or no longer.
//
//   POST /setup/api/check    read every piece with the token in a JSON body, and answer the reading as JSON
//   POST /setup/api/repair   make every piece match; on an install with nothing set it also gives the install where it answers and its first login
//
//   the install                 the form    what a run takes
//   nothing set                 first       the token, the first login, and the domain of an install that has one
//   set, nobody ever logged in  login       the token, and an email that corrects the first login
//   set, somebody has           repair      the token, and an email to add as a user; only a repair: the way back in when the login in front is broken
//   nothing set, somebody has   none        every path is a 404
//
// The setup screen sends its repair through the second path, so a person's press and a program's call are one run.
// The token is the only proof of ownership: the plug refuses one that does not act on the install's own account. Until one passes nothing of the install is read, so no answer can say anything of it.
// A run on an install with nothing set writes nothing to the install's own database: what it changes is at the provider, under the token's own account.
// Until somebody has logged in the first login may have been mistyped, with nobody able to log in to mend it: an email sent here, with a proven token, replaces it.
// After that an email sent with a proven token is added as one more user, for a person whose mailbox is lost. It takes no login away.
// No answer hands a sent value back: a refusal names the field and never what was in it.
// Every try is counted against the sender's address before the plug is asked, and a counter that cannot answer refuses: the setup stays shut when its guard is gone.
// A call is a try only once it is sent as JSON: one that a page of another origin made a browser send is refused uncounted, so it cannot use up the tries of the person at that address.

import type { Install } from "@poplin/core/src/actions/records";
import { storeFirstLogin, storeOneMoreLogin } from "@poplin/core/src/actions/store-settings";
import { type Login, parseLogin } from "@poplin/core/src/auth/logins";
import { AllowanceSpent, secondsToNextDay } from "@poplin/core/src/database/driver";
import { defaultSettings, type SettingValues } from "@poplin/core/src/records/settings";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as v from "valibot";

import { hasContentType } from "../../api/body";
import type { Counters } from "../../limits/limits";
import { type DomainRun, REFUSAL_STATUS, runDomain } from "./domain-run";
import type { DomainPlug, DomainReading, FirstChoice, FirstRun } from "./records";

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

  /** Whether anybody has ever logged in, asked on every request. A failure to say is a 404. */
  readonly loggedIn: () => Promise<boolean>;

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

/** Which form the setup has, by the table at the top of this file. */
export type SetupForm = "first" | "login" | "repair";

/** What the handlers of one request share: the form the setup has for it. */
interface Shared {
  Variables: { form: SetupForm };
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

/** The kind a run on an install with nothing set is for, from what it sent: an install under the domain it names, or one without a domain when it names none. */
function kindOf(sent: Sent): FirstChoice["kind"] {
  return typedDomain(sent) === "" ? "no-domain" : "domain";
}

/**
 * Say which kind of install a run on an install with nothing set is for.
 *
 * @param body - the run's body as it was sent, of any shape
 * @returns `domain` for a body that names one, and `no-domain` for any other
 */
export function kindSent(body: unknown): FirstChoice["kind"] {
  return kindOf(v.parse(SENT, body));
}

/**
 * Say which form the setup has now.
 *
 * @returns the form, or `undefined` for a setup that is shut: an install with nothing set that somebody has logged in to, and one that fails to say whether anybody has
 */
export async function setupForm(parts: Pick<SetupParts, "domain" | "loggedIn">): Promise<SetupForm | undefined> {
  // Asked inside a promise, so a question that throws before it answers is a shut setup too.
  const loggedIn = await Promise.resolve()
    .then(() => parts.loggedIn())
    .catch(() => undefined);
  if (loggedIn === undefined) return undefined;

  if ("plugFor" in parts.domain) return loggedIn ? undefined : "first";

  return loggedIn ? "repair" : "login";
}

/**
 * Read the settings a run on a set install is made to match, with the sent email stored first: as the corrected first login, or once somebody has logged in as one more user.
 *
 * The plug asks for the settings only once the token is proven for the install's own account, so nothing is stored, and nothing of the install is read, for anybody else.
 * A repair stores the email. A check stores nothing, and shows what a repair that corrects the first login would change.
 */
async function settingsWith(install: SetupParts["install"], asked: { readonly run: DomainRun; readonly form: SetupForm }, login: Login | undefined): Promise<SettingValues> {
  const stored = await install.database.readSettings();
  if (stored === undefined) throw new Error("the install has no settings, which every install stores before it answers a request");

  if (login === undefined) return stored;

  if (asked.run === "check") return { ...stored, logins: [login] };

  const changed = asked.form === "repair" ? await storeOneMoreLogin(install, login) : await storeFirstLogin(install, login);

  return changed.ok ? changed.values : stored;
}

/**
 * Run the plug once for what was sent.
 *
 * On an install with nothing set the plug is made for the kind of install that was sent, and its settings are the defaults of such an install. The run is not recorded: no value of it is stored here.
 * A sent domain is an install under it. None is an install without a domain, at the hostname the run was sent to.
 * On a set install nobody has logged in to, an email is taken as the correction of the first login. Once somebody has, it is taken as one more user. An empty one keeps the stored logins either way.
 *
 * @param asked - the form the setup has, and the hostname the run was sent to
 */
async function runOnce(parts: SetupParts, run: DomainRun, sent: Sent, asked: { readonly form: SetupForm; readonly host: string }): Promise<DomainReading> {
  const { domain, install } = parts;
  const { form, host } = asked;
  const { login } = sent;
  // A token pasted into the email's box is no email: it is refused before the plug is asked, so it is never stored as a login or answered back.
  if (sent.token !== "" && login.toLowerCase().includes(sent.token.toLowerCase())) return { ok: false, refusal: "bad_login" };

  if (!("plugFor" in domain)) {
    const typed = login.trim() === "" ? undefined : parseLogin(login);
    if (typed?.ok === false) return { ok: false, refusal: "bad_login" };

    return runDomain(domain, install, { run, token: sent.token, settings: () => settingsWith(install, { run, form }, typed?.value), from: "setup" });
  }

  const owner = parseLogin(login);
  if (!owner.ok) return { ok: false, refusal: "bad_login" };

  const first: FirstChoice = kindOf(sent) === "no-domain" ? { kind: "no-domain", host, login: owner.value } : { kind: "domain", domain: typedDomain(sent), login: owner.value };
  const plug = domain.plugFor(first);
  if (plug === undefined) return { ok: false, refusal: first.kind === "domain" ? "bad_domain" : "bad_address" };

  const settings = async (): Promise<ReturnType<typeof defaultSettings>> => defaultSettings({ installer: owner.value });

  return runDomain(plug, install, { run, token: sent.token, settings, from: "setup", unrecorded: true });
}

/** Run the plug once for what was sent. A database whose allowance for the day is used up is the refusal `allowance_spent`, whatever the plug did before the database was asked. */
async function runFor(parts: SetupParts, run: DomainRun, sent: Sent, asked: { readonly form: SetupForm; readonly host: string }): Promise<DomainReading> {
  try {
    return await runOnce(parts, run, sent, asked);
  } catch (error) {
    if (error instanceof AllowanceSpent) return { ok: false, refusal: "allowance_spent" };

    throw error;
  }
}

/**
 * Build the setup's own handler.
 *
 * @returns a handler for the two paths a program calls; every other path, every path of a setup that is shut, and a check once somebody has logged in, is a 404 that says nothing
 */
export function createSetup(parts: SetupParts): Setup {
  // Said only after a run the plug took, so only to a token proven for the install's own account.
  const expects = async (reading: DomainReading, form: SetupForm): Promise<string | undefined> =>
    reading.ok && form !== "first" ? (await parts.install.database.readSettings())?.logins.join(", ") : undefined;
  const app = new Hono<Shared>();

  const gate: MiddlewareHandler<Shared> = async (context, next) => {
    const form = await setupForm(parts);
    if (form === undefined) return notFound();

    context.set("form", form);
    await next();
    context.res.headers.set("Cache-Control", "no-store");
  };

  // Before the body is looked at: a run the setup does not take answers as any other path does, whatever was sent with it.
  const taken: MiddlewareHandler<Shared> = async (context, next) => {
    const run = context.req.param("run");
    if (run !== "repair" && (run !== "check" || context.get("form") === "repair")) return notFound();

    await next();
  };

  app.use(gate);

  app.post("/setup/api/:run", taken, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (context) => context.json({ ok: false, refusal: "too_large" }, 413) }), async (context) => {
    const run = context.req.param("run") === "check" ? "check" : "repair";
    const form = context.get("form");

    // Before the count: a call in any other type is one a page of another origin could have made a browser send, and JSON is one it cannot send unasked.
    if (!hasContentType(context.req.raw, "json")) return context.json({ ok: false, refusal: "not_json" }, 415);

    if (!(await fits(parts, context.req.raw))) return context.json({ ok: false, refusal: "too_many_tries" }, 429);

    const reading = await runFor(parts, run, v.parse(SENT, await context.req.raw.json().catch(() => undefined)), { form, host: new URL(context.req.url).hostname });
    if (!reading.ok && reading.refusal === "allowance_spent") return spentRun(parts.install.now());

    if (!reading.ok) return context.json(reading, REFUSAL_STATUS[reading.refusal]);

    return context.json({ ...reading, expects: await expects(reading, form) });
  });

  app.notFound(() => notFound());
  app.onError(() => new Response(FAILURE, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }));

  return { fetch: async (request) => app.fetch(request) };
}
