// Anyone can begin a login, ask for its token, and send the dashboard any form.
// Across any order of those steps, a token must come out only for a login the admin allowed from their own page, once, to the holder of its secret, and no secret or token may show up anywhere else.

import { expect } from "bun:test";
import fc from "fast-check";

import { createDashboard } from "../../packages/app/src/dashboard/dashboard";
import { type ApiInstall, ORIGIN, openApi, VISITOR_HEADER } from "../../packages/app/tests/api/support/install";
import { ADDRESSES } from "../../packages/app/tests/sites/support/layout";
import { holdsSecret, mintComputerLogin, parseLoginSecret, parseUserCode, showUserCode } from "../../packages/core/src/auth/computer-logins";
import type { Login } from "../../packages/core/src/auth/logins";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const ADA = "ada@example.com" as Login;
const SESSION = "session=ada";
const FORM = "application/x-www-form-urlencoded";
const INTERVAL_MS = 5000;
const CREDENTIAL = /poplin_(?:login_)?[0-9a-f]{16}_[0-9a-f]{64}/g;
const YEAR_2100_MS = 4_102_444_800_000;

/** One thing a stranger, a terminal, or the admin does. `login` picks one of the logins begun so far. */
type Step =
  | { readonly kind: "begin"; readonly scope: "admin" | "publisher"; readonly computer: string }
  | { readonly kind: "ask"; readonly login: number; readonly secret: string | undefined }
  | { readonly kind: "look"; readonly login: number; readonly code: string | undefined }
  | { readonly kind: "decide"; readonly login: number; readonly allow: boolean; readonly ticked: boolean; readonly session: boolean; readonly csrf: boolean; readonly origin: string }
  | { readonly kind: "wait"; readonly seconds: number };

/** What the test itself knows of a login, kept apart from anything the install answers. */
interface Known {
  readonly code: string;
  readonly secret: string;
  readonly scope: string;
  readonly expiresAt: number;
  state: "pending" | "allowed" | "denied" | "collected";
  polledAt: number | undefined;
}

/** An install with its dashboard, and every text either one let out. */
interface Desk {
  readonly install: ApiInstall;
  readonly dashboard: ReturnType<typeof createDashboard>;
  readonly known: Known[];
  readonly texts: string[];
  readonly credentials: Set<string>;
  csrf: string;
  visitors: number;
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
      csrf: fc.oneof({ arbitrary: fc.constant(true), weight: 4 }, { arbitrary: fc.constant(false), weight: 1 }),
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
    dashboard: createDashboard({
      install: { database, store, now: () => clock.now, addressOf: ADDRESSES.addressOf, publicAddressOf: ADDRESSES.publicAddressOf, reservedNames: ADDRESSES.reservedNames },
      readSession: async (headers) => (headers.get("Cookie") === SESSION ? { ok: true, value: ADA } : { ok: false }),
      addresses: { loginFor: () => `${ORIGIN}/login` },
      csrfSecret: new Uint8Array(32).fill(9),
      counters: install.counters,
      // Every request is its own visitor: the counts by address have their own test, and here they would only hide steps.
      visitorOf: async () => nextVisitor(desk),
    }),
    known: [],
    texts: [],
    credentials: new Set(),
    csrf: "",
    visitors: 0,
  };
  const tokens = await (await desk.dashboard.fetch(new Request(`${ORIGIN}/tokens`, { headers: { Cookie: SESSION } }))).text();
  desk.csrf = /name="csrf" value="([^"]+)"/.exec(tokens)?.[1] ?? "";

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

  if (login.polledAt !== undefined && login.polledAt > now - INTERVAL_MS) return "slow_down";

  login.polledAt = now;

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

async function decide(desk: Desk, login: Known, step: Extract<Step, { kind: "decide" }>): Promise<void> {
  const fields = new URLSearchParams({ code: login.code });
  if (step.ticked) fields.set("confirm", "yes");
  if (step.csrf) fields.set("csrf", desk.csrf);

  const headers = new Headers({ Origin: step.origin, "Sec-Fetch-Site": step.origin === ORIGIN ? "same-origin" : "cross-site", "Content-Type": FORM });
  if (step.session) headers.set("Cookie", SESSION);

  const answer = await desk.dashboard.fetch(new Request(`${ORIGIN}/tokens/${step.allow ? "allow" : "deny"}`, { method: "POST", headers, body: fields.toString() }));
  desk.texts.push(await answer.text(), answer.headers.get("Location") ?? "");

  const fromOwnPage = step.session && step.csrf && step.origin === ORIGIN && (step.ticked || !step.allow);
  if (fromOwnPage && login.state === "pending" && desk.install.clock.now < login.expiresAt) login.state = step.allow ? "allowed" : "denied";
}

async function look(desk: Desk, login: Known, code: string | undefined): Promise<void> {
  const answer = await desk.dashboard.fetch(new Request(`${ORIGIN}/tokens/allow?${new URLSearchParams({ code: code ?? login.code })}`, { headers: { Cookie: SESSION } }));
  const page = await answer.text();
  desk.texts.push(page);

  // A lone surrogate does not survive an address, so the code is read as the address carries it.
  const typed = parseUserCode((code ?? login.code).toWellFormed());
  const shown = desk.known.find((other) => parseUserCode(other.code) === typed && other.state === "pending" && desk.install.clock.now < other.expiresAt);

  expect([answer.status, page.includes('<p class="code"')]).toEqual([200, shown !== undefined]);
  if (shown !== undefined) expect(page).toContain(`>${shown.code}</p>`);
}

async function take(desk: Desk, step: Step): Promise<void> {
  if (step.kind === "wait") {
    desk.install.clock.now += step.seconds * 1000;

    return;
  }

  if (step.kind === "begin") {
    const begun = await call(desk, "/api/logins", { scope: step.scope, computer: step.computer });
    expect(begun.status).toBe(200);
    desk.texts.pop();
    desk.credentials.add(String(begun.body.secret));
    desk.known.push({ code: String(begun.body.code), secret: String(begun.body.secret), scope: step.scope, expiresAt: desk.install.clock.now + Number(begun.body.expires_in) * 1000, state: "pending", polledAt: undefined });

    return;
  }

  const login = desk.known[step.login % Math.max(1, desk.known.length)];
  if (login === undefined) return;

  if (step.kind === "ask") return ask(desk, login, step.secret);

  if (step.kind === "look") return look(desk, login, step.code);

  return decide(desk, login, step);
}

property(
  "over any order of steps a token comes out only for a login the admin allowed from their own page, once, and no secret or token is in any other answer, page, or audit entry",
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
  "a hostile code is refused without a throw or is a code that reads back as itself, and a hostile secret opens no login under any record",
  fc.asyncProperty(codes, secrets, fc.integer({ min: 0, max: YEAR_2100_MS }), async (typed, presented, now) => {
    const { secret, login } = await mintComputerLogin({ scope: "publisher", computer: "laptop", now });
    const code = parseUserCode(typed);
    fc.pre(presented !== secret);

    if (code !== undefined) expect([/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code), parseUserCode(showUserCode(code))]).toEqual([true, code]);

    expect([await holdsSecret(presented, login), await holdsSecret(secret, login), parseLoginSecret(secret)]).toEqual([false, true, login.id]);
  }),
);
