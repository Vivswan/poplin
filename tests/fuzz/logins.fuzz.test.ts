// Anyone can begin a login, ask for its token, and send the dashboard any decision, as JSON or as a form, from any origin.
// Across any order of those steps, a token must come out only for a login the admin allowed in a JSON request under their session, once, to the holder of its secret, and no secret or token may show up anywhere else.

import { expect } from "bun:test";
import fc from "fast-check";

import { createConsole } from "../../packages/app/src/console/console";
import { type ApiInstall, ORIGIN, openApi, VISITOR_HEADER } from "../../packages/app/tests/api/support/install";
import { CLIENT } from "../../packages/app/tests/console/support/console";
import { FREE_LIMITS } from "../../packages/app/tests/console/support/install";
import { ADDRESSES } from "../../packages/app/tests/sites/support/layout";
import { holdsSecret, mintComputerLogin, parseLoginSecret, parseUserCode, showUserCode } from "../../packages/core/src/auth/computer-logins";
import type { Login } from "../../packages/core/src/auth/logins";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const ADA = "ada@example.com" as Login;
const SESSION = "session=ada";
const JSON_TYPE = "application/json";
const FORM = "application/x-www-form-urlencoded";
const INTERVAL_MS = 5000;
const MINUTE_MS = 60_000;
const STARTS_PER_MINUTE = 5;
const CREDENTIAL = /poplin_(?:login_)?[0-9a-f]{16}_[0-9a-f]{64}/g;
const YEAR_2100_MS = 4_102_444_800_000;

/** One thing a stranger, a terminal, or the admin does. `login` picks one of the logins begun so far. */
type Step =
  | { readonly kind: "begin"; readonly scope: "admin" | "publisher"; readonly computer: string }
  | { readonly kind: "ask"; readonly login: number; readonly secret: string | undefined }
  | { readonly kind: "look"; readonly login: number; readonly code: string | undefined }
  | { readonly kind: "decide"; readonly login: number; readonly allow: boolean; readonly ticked: boolean; readonly session: boolean; readonly json: boolean; readonly origin: string }
  | { readonly kind: "wait"; readonly seconds: number };

/** What the test itself knows of a login, kept apart from anything the install answers. */
interface Known {
  readonly code: string;
  readonly secret: string;
  readonly scope: string;
  readonly expiresAt: number;
  state: "pending" | "allowed" | "denied" | "collected";
}

/** An install with its dashboard, and every text either one let out. */
interface Desk {
  readonly install: ApiInstall;
  readonly dashboard: ReturnType<typeof createConsole>;
  readonly known: Known[];
  readonly texts: string[];
  readonly credentials: Set<string>;
  visitors: number;
  starts: Starts;
}

/** What the test itself counts of the logins begun: how many each visitor and all of them together began in the minute. */
class Starts {
  #minute = -1;

  #all = 0;

  readonly #own = new Map<string, number>();

  /** The status a login this visitor begins now is answered with, counted as the install counts it. */
  status(visitor: string, now: number): number {
    const minute = Math.floor(now / MINUTE_MS);
    if (minute !== this.#minute) {
      this.#minute = minute;
      this.#all = 0;
      this.#own.clear();
    }

    const own = this.#own.get(visitor) ?? 0;
    if (own >= STARTS_PER_MINUTE) return 429;

    this.#own.set(visitor, own + 1);
    if (this.#all >= STARTS_PER_MINUTE) return 429;

    this.#all += 1;

    return 200;
  }
}

const property = fuzzTarget(import.meta.file);

const secrets = hostile(fc.stringMatching(/^poplin_login_[0-9a-f]{16}_[0-9a-f]{64}$/));
const codes = hostile(fc.stringMatching(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/));
const picks = fc.nat({ max: 7 });
const steps: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant("begin" as const), scope: fc.constantFrom("admin" as const, "publisher" as const), computer: fc.constantFrom("laptop", "", "ci-runner") }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant("ask" as const), login: picks, secret: fc.oneof({ arbitrary: fc.constant(undefined), weight: 3 }, { arbitrary: secrets, weight: 1 }) }), weight: 5 },
  { arbitrary: fc.record({ kind: fc.constant("look" as const), login: picks, code: fc.oneof({ arbitrary: fc.constant(undefined), weight: 2 }, { arbitrary: codes, weight: 1 }) }), weight: 2 },
  {
    arbitrary: fc.record({
      kind: fc.constant("decide" as const),
      login: picks,
      allow: fc.boolean(),
      ticked: fc.oneof({ arbitrary: fc.constant(true), weight: 3 }, { arbitrary: fc.constant(false), weight: 1 }),
      session: fc.oneof({ arbitrary: fc.constant(true), weight: 4 }, { arbitrary: fc.constant(false), weight: 1 }),
      json: fc.oneof({ arbitrary: fc.constant(true), weight: 4 }, { arbitrary: fc.constant(false), weight: 1 }),
      origin: fc.constantFrom(ORIGIN, ORIGIN, ORIGIN, ORIGIN, "https://evil.example.com", "null"),
    }),
    weight: 4,
  },
  { arbitrary: fc.record({ kind: fc.constant("wait" as const), seconds: fc.constantFrom(1, 4, 5, 6, 60, 300, 599, 600) }), weight: 3 },
);

function nextVisitor(desk: Desk): string {
  desk.visitors += 1;

  return `visitor-${desk.visitors}`;
}

async function openDesk(): Promise<Desk> {
  const install = await openApi();
  const { database, store, clock } = install;
  const desk: Desk = {
    install,
    dashboard: createConsole({
      install: { database, store, now: () => clock.now, addressOf: ADDRESSES.addressOf, publicAddressOf: ADDRESSES.publicAddressOf, reservedNames: ADDRESSES.reservedNames },
      version: "1.0.0",
      readSession: async (headers) => (headers.get("Cookie") === SESSION ? { ok: true, value: ADA } : { ok: false }),
      loginPath: "/login",
      base: "",
      client: CLIENT,
      freeLimits: FREE_LIMITS,
      rebuild: { accepts: () => false, fetch: async () => new Response(null, { status: 204 }) },
      counters: install.counters,
      // Every request is its own visitor: the counts by address have their own test, and here they would only hide steps.
      visitorOf: async () => nextVisitor(desk),
    }),
    known: [],
    texts: [],
    credentials: new Set(),
    visitors: 0,
    starts: new Starts(),
  };

  return desk;
}

/** Send one request to the API as a visitor of its own, and keep what was answered. */
async function call(desk: Desk, path: string, body: unknown): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const headers = { "Content-Type": "application/json", [VISITOR_HEADER]: nextVisitor(desk) };
  const answer = await desk.install.api.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
  const text = await answer.text();
  desk.texts.push(text);

  return { status: answer.status, body: JSON.parse(text) };
}

/** What a terminal that asks now with a login's own secret is answered, by what the test knows; the knowledge is moved on as the install's is. */
function expected(login: Known, now: number): string {
  if (login.state === "collected" || now >= login.expiresAt) return "expired";

  if (login.state === "denied") return "denied";

  if (login.state === "allowed") {
    login.state = "collected";

    return "allowed";
  }

  return "pending";
}

async function ask(desk: Desk, login: Known, presented: string | undefined): Promise<void> {
  const own = presented === undefined || presented === login.secret;
  const answered = await call(desk, "/api/logins/token", { secret: own ? login.secret : presented });

  if (!own) {
    expect<unknown>([[400, undefined], [200, "expired"]]).toContainEqual([answered.status, answered.body.state]);

    return;
  }

  const state = expected(login, desk.install.clock.now);
  expect([answered.status, answered.body.state]).toEqual([200, state]);
  if (state !== "allowed") return;

  // The one answer a token belongs in: it goes to the terminal, and is looked for everywhere else.
  desk.texts.pop();
  desk.credentials.add(String(answered.body.token));
  expect(answered.body.record).toMatchObject({ scope: login.scope });
}

/** The status the dashboard's guard refuses a decision with before it is read, `undefined` for one it lets through: no session, then a form of another origin, then any form. */
function guarded(step: Extract<Step, { kind: "decide" }>): number | undefined {
  if (!step.session) return 401;

  if (step.json) return undefined;

  return step.origin === ORIGIN ? 415 : 403;
}

async function decide(desk: Desk, login: Known, step: Extract<Step, { kind: "decide" }>): Promise<void> {
  const decision = { code: login.code, allow: step.allow, ...(step.ticked ? { confirm: true } : {}) };
  const body = step.json ? JSON.stringify(decision) : new URLSearchParams(Object.entries(decision).map(([key, value]) => [key, String(value)])).toString();

  const headers = new Headers({ Origin: step.origin, "Sec-Fetch-Site": step.origin === ORIGIN ? "same-origin" : "cross-site", "Content-Type": step.json ? JSON_TYPE : FORM });
  if (step.session) headers.set("Cookie", SESSION);

  const answer = await desk.dashboard.fetch(new Request(`${ORIGIN}/data/logins/decide`, { method: "POST", headers, body }));
  desk.texts.push(await answer.text());

  const refusal = guarded(step);
  if (refusal !== undefined) expect(answer.status).toBe(refusal);

  // A page of another origin cannot send JSON with the session, as this origin never lets it: the session and the media type are the whole guard, and the box is the admin's word that the codes match.
  const taken = refusal === undefined && (step.ticked || !step.allow);
  if (taken && login.state === "pending" && desk.install.clock.now < login.expiresAt) login.state = step.allow ? "allowed" : "denied";
}

async function look(desk: Desk, login: Known, code: string | undefined): Promise<void> {
  const asked = new URLSearchParams({ code: code ?? login.code });
  const page = await desk.dashboard.fetch(new Request(`${ORIGIN}/tokens/allow?${asked}`, { headers: { Cookie: SESSION } }));
  const answer = await desk.dashboard.fetch(new Request(`${ORIGIN}/data/logins/find?${asked}`, { headers: { Cookie: SESSION } }));
  const found = await answer.text();
  desk.texts.push(await page.text(), found);

  // A lone surrogate does not survive an address, so the code is read as the address carries it.
  const typed = parseUserCode((code ?? login.code).toWellFormed());
  const shown = desk.known.find((other) => parseUserCode(other.code) === typed && other.state === "pending" && desk.install.clock.now < other.expiresAt);

  // The address a terminal prints answers the dashboard's one page, and the login under its code is read as data.
  expect(page.status).toBe(200);
  expect([answer.status, JSON.parse(found)]).toMatchObject(shown === undefined ? [400, { ok: false, code: "no_such_login" }] : [200, { ok: true, login: { code: shown.code, scope: shown.scope } }]);
}

async function take(desk: Desk, step: Step): Promise<void> {
  if (step.kind === "wait") {
    desk.install.clock.now += step.seconds * 1000;

    return;
  }

  if (step.kind === "begin") {
    const begun = await call(desk, "/api/logins", { scope: step.scope, computer: step.computer });
    expect(begun.status).toBe(desk.starts.status(`visitor-${desk.visitors}`, desk.install.clock.now));
    if (begun.status !== 200) return;

    desk.texts.pop();
    desk.credentials.add(String(begun.body.secret));
    desk.known.push({ code: String(begun.body.code), secret: String(begun.body.secret), scope: step.scope, expiresAt: desk.install.clock.now + Number(begun.body.expires_in) * 1000, state: "pending" });

    return;
  }

  const login = desk.known[step.login % Math.max(1, desk.known.length)];
  if (login === undefined) return;

  if (step.kind === "ask") return ask(desk, login, step.secret);

  if (step.kind === "look") return look(desk, login, step.code);

  return decide(desk, login, step);
}

property(
  "over any order of steps a token comes out only for a login the admin allowed in a JSON request under their session, once, and no secret or token is in any other answer, page, or audit entry",
  fc.asyncProperty(fc.array(steps, { minLength: 1, maxLength: 40 }), async (taken) => {
    const desk = await openDesk();
    const tokensBefore = (await desk.install.database.listTokens()).length;

    for (const step of taken) await take(desk, step);

    const audit = await desk.install.database.listAudit({ limit: 100 });
    const actions = (action: string): number => audit.filter((entry) => entry.action === action).length;
    const states = (...wanted: Known["state"][]): number => desk.known.filter((login) => wanted.includes(login.state)).length;
    const everything = [...desk.texts, JSON.stringify(audit), JSON.stringify(await desk.install.database.listTokens()), JSON.stringify(desk.install.reported)].join("\n");

    expect({
      tokens: (await desk.install.database.listTokens()).length - tokensBefore,
      added: actions("token_added") - tokensBefore,
      allowed: actions("login_allowed"),
      denied: actions("login_denied"),
      leaked: [...desk.credentials].filter((credential) => everything.includes(credential)),
      shaped: everything.match(CREDENTIAL),
      reported: desk.install.reported.length,
    }).toEqual({ tokens: states("collected"), added: states("collected"), allowed: states("allowed", "collected"), denied: states("denied"), leaked: [], shaped: null, reported: 0 });
  }),
);

property(
  "whatever sixteen other addresses begin and however long they wait, an address that has no login waiting begins one unless five were begun that minute, and it waits until it runs out",
  fc.asyncProperty(fc.array(fc.oneof(fc.nat({ max: 15 }), fc.constantFrom("wait" as const, "minute" as const)), { maxLength: 120 }), fc.nat({ max: 120 }), async (crowd, entry) => {
    const install = await openApi();
    const begin = async (visitor: string): Promise<{ readonly status: number; readonly secret: string }> => {
      const headers = { "Content-Type": "application/json", [VISITOR_HEADER]: visitor };
      const answer = await install.api.fetch(new Request(`${ORIGIN}/api/logins`, { method: "POST", headers, body: JSON.stringify({ scope: "publisher", computer: "laptop" }) }));

      return { status: answer.status, secret: String((await answer.json()).secret) };
    };
    const begunAt = Math.min(entry, crowd.length);
    const starts = new Starts();
    let own: { readonly status: number; readonly secret: string; readonly at: number; readonly fits: number } | undefined;

    for (const [at, step] of [...crowd, "wait" as const].entries()) {
      if (at === begunAt) own = { fits: starts.status("own", install.clock.now), ...(await begin("own")), at: install.clock.now };
      if (step === "wait") install.clock.now += INTERVAL_MS;
      if (step === "minute") install.clock.now += MINUTE_MS;
      if (typeof step === "number") expect((await begin(`crowd-${step}`)).status).toBe(starts.status(`crowd-${step}`, install.clock.now));
    }
    const asked = await install.api.fetch(new Request(`${ORIGIN}/api/logins/token`, { method: "POST", headers: { "Content-Type": "application/json", [VISITOR_HEADER]: "own" }, body: JSON.stringify({ secret: own?.secret }) }));
    const waits = own?.status === 200 && install.clock.now < own.at + 600_000;

    expect([own?.status, asked.status, (await asked.json()).state]).toEqual([own?.fits, 200, waits ? "pending" : "expired"]);
  }),
);

property(
  "a hostile code is refused without a throw or is a code that reads back as itself, and a hostile secret opens no login under any record",
  fc.asyncProperty(codes, secrets, fc.integer({ min: 0, max: YEAR_2100_MS }), async (typed, presented, now) => {
    const { secret, login } = await mintComputerLogin({ scope: "publisher", computer: "laptop", visitor: "one-visitor", now });
    const code = parseUserCode(typed);
    fc.pre(presented !== secret);

    if (code !== undefined) expect([/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code), parseUserCode(showUserCode(code))]).toEqual([true, code]);

    expect([await holdsSecret(presented, login), await holdsSecret(secret, login), parseLoginSecret(secret)]).toEqual([false, true, login.id]);
  }),
);
