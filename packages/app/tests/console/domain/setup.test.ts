// The setup's own handler: the two runs a program calls, the repair of which the setup screen sends too, on an install nobody can log in to yet.
// What it must keep: nothing of the install before a proven token, tries counted before the plug is asked, a shut setup that says nothing, a token in no answer and no stored row, and a first login only its owner can correct.

import { expect, test } from "bun:test";
import { AllowanceSpent } from "@poplin/core/src/database/driver";

import type { DomainReading } from "../../../src/console/domain/records";
import { createSetup } from "../../../src/console/domain/setup";
import type { Counters } from "../../../src/limits/limits";
import { MemoryCounters } from "../../../src/limits/memory-counters";
import { type FakePlug, fakePlug, firstRunOf, TOKEN, usualPlug } from "../support/fake-plug";
import { ORIGIN, openOwned } from "../support/install";

/** A token of the install's account. */
const OWN = TOKEN;

/** A token that is valid for another account. */
const FOREIGN = "token-of-another-account-0123456789";

/** The email the first login was meant to be, where the stored one was mistyped. */
const MEANT = "meant@example.com";

/** The media type a run is sent in. */
const JSON_TYPE = "application/json";

/** What a setup that is shut, and every path but the two runs, answers. */
const NOT_FOUND = [404, "Not found."];

/** What the sixth try of a minute is answered. */
const TOO_MANY = [429, { ok: false, refusal: "too_many_tries" }];

/** The one piece the guarded plug reads, as a check finds it. */
const PIECE = { object: "DNS record", state: "missing", detail: "poplin.example.com", part: "reach" } as const;

/** What a person types on an install with nothing set. */
const FIRST = { domain: "example.com", login: "owner@example.com" };

/** A database every use of which fails the test: a run on an install with nothing set may neither read nor write one. */
const NO_DATABASE = new Proxy({}, { get: (_target, name) => () => Promise.reject(new Error(`the database was asked for ${String(name)}`)) }) as Parameters<typeof createSetup>[0]["install"]["database"];

/** The ways an email sent beside the token changes nothing that is stored. */
const unchanged: readonly { readonly name: string; readonly run: string; readonly token: string; readonly login: string; readonly status: number; readonly asked: readonly (readonly string[])[] }[] = [
  { name: "a check, which shows what a repair would change", run: "check", token: OWN, login: MEANT, status: 200, asked: [[MEANT]] },
  { name: "a token of another account", run: "repair", token: FOREIGN, login: MEANT, status: 403, asked: [] },
  { name: "an email that is none", run: "repair", token: OWN, login: "nobody", status: 400, asked: [] },
  { name: "an email that holds the token", run: "repair", token: OWN, login: `${OWN.toUpperCase()}@example.com`, status: 400, asked: [] },
];

/** The values of an install with nothing set that are refused before any run, with how often the provider's side was asked for a plug. */
const mistyped: readonly { readonly name: string; readonly sent: Readonly<Record<string, string>>; readonly refusal: string; readonly asked: number }[] = [
  { name: "an email that is none", sent: { domain: "example.com", login: "owner" }, refusal: "bad_login", asked: 0 },
  { name: "no email", sent: { domain: "example.com" }, refusal: "bad_login", asked: 0 },
  { name: "text that is no domain", sent: { domain: "localhost", login: "owner@example.com" }, refusal: "bad_domain", asked: 1 },
];

/** How a test's setup differs from the usual one. */
interface Options {
  /** The plug; left out, one that takes the install's own token alone. */
  readonly plug?: FakePlug;

  /** Whether the setup answers; it does when left out. */
  readonly open?: () => Promise<boolean>;

  /** Where tries are counted; left out, exact counters in memory. */
  readonly counters?: Pick<Counters, "takeMinute">;

  /** What the install's store is like: `none` holds no settings, `spent` takes no more writes today; left out, it holds its settings and takes the run. */
  readonly store?: "none" | "spent";
}

/** A plug that reads the install for its own account's token and refuses every other, as the real one must. */
function guardedPlug(): FakePlug {
  return fakePlug((run, token) => (token === OWN ? { ok: true, rows: [{ ...PIECE, state: run === "check" ? "missing" : "created" }], steps: [] } : { ok: false, refusal: "token" }));
}

async function openSetup(options: Options = {}) {
  const opened = await openOwned();
  const plug = options.plug ?? guardedPlug();
  const address = { value: "203.0.113.7" };
  const reads = { count: 0 };
  const { database } = opened.install;

  // The setup's own view of the database: every read of the settings is counted, an install with none has none, and one whose day is spent keeps no run.
  const watched = {
    keepDomainCheck: (...kept: Parameters<typeof database.keepDomainCheck>) => (options.store === "spent" ? Promise.reject(new AllowanceSpent("writing")) : database.keepDomainCheck(...kept)),
    hasLoggedIn: () => database.hasLoggedIn(),
    changeSettings: (...changed: Parameters<typeof database.changeSettings>) => database.changeSettings(...changed),
    readSettings: async () => {
      reads.count += 1;

      return options.store === "none" ? undefined : database.readSettings();
    },
  } as unknown as typeof database;
  const setup = createSetup({
    install: { database: watched, now: opened.install.now },
    domain: plug,
    open: options.open ?? (async () => true),
    counters: options.counters ?? new MemoryCounters(),
    visitorOf: async () => address.value,
  });
  const ask = (path: string, method = "GET"): Promise<Response> => setup.fetch(new Request(`${ORIGIN}${path}`, { method }));

  // A run as a program and the setup screen send it: what it carries as JSON, or any other body under any other type.
  const call = (run: string, body: object | string, type = JSON_TYPE): Promise<Response> =>
    setup.fetch(new Request(`${ORIGIN}/setup/api/${run}`, { method: "POST", headers: { "Content-Type": type }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const logins = async (): Promise<readonly string[] | undefined> => (await database.readSettings())?.logins;

  return { opened, plug, address, reads, ask, call, logins };
}

/** The setup of an install with nothing set, over a plug the test wrote. */
function openFirstSetup() {
  const plug = usualPlug();
  const first = firstRunOf(plug);
  const setup = createSetup({ install: { database: NO_DATABASE, now: () => 1_700_000_000_000 }, domain: first, open: async () => true, counters: new MemoryCounters(), visitorOf: async () => "203.0.113.7" });
  const call = (run: string, body: object): Promise<Response> =>
    setup.fetch(new Request(`${ORIGIN}/setup/api/${run}`, { method: "POST", headers: { "Content-Type": JSON_TYPE }, body: JSON.stringify(body) }));

  return { first, plug, call };
}

/** Every byte an answer carries: its status, its headers, and its body. */
async function emitted(answer: Response): Promise<string> {
  return JSON.stringify([answer.status, [...answer.headers], await answer.text()]);
}

/** An answer's status beside its body, read as JSON where it is JSON. */
async function told(answer: Response): Promise<unknown[]> {
  const body = await answer.text();

  return [answer.status, body.startsWith("{") ? JSON.parse(body) : body];
}

// Drift: an answer that differed by the token, or by whether the install has settings, would tell a stranger which guess came close or that an install is set up here; a read of the settings would cost the install a query for each guess.
test("a wrong token, a token of another account, a malformed one, and a body with none get the same answer byte for byte whether or not the install has settings, and the settings are never read for them", async () => {
  const bodies = [{ token: "wrong-token-0123456789-abcdefgh" }, { token: FOREIGN }, { token: "short" }, { token: "" }, { token: "not a token\r\n" }, { secret: OWN }, { token: 7 }, "no JSON at all"];
  const answers: string[] = [];

  for (const store of [undefined, "none"] as const) {
    const { opened, call, address, reads } = await openSetup({ store });
    const before = await opened.audit();

    for (const [index, body] of bodies.entries()) {
      address.value = `203.0.113.${index}`;
      for (const run of ["check", "repair"]) answers.push(await emitted(await call(run, body)));
    }

    expect([store, reads.count]).toEqual([store, 0]);
    expect(await opened.audit()).toEqual(before);
  }

  expect([answers.length, new Set(answers).size]).toEqual([32, 1]);
  expect(JSON.parse(answers[0] ?? "[]")).toEqual([403, expect.arrayContaining([["cache-control", "no-store"]]), JSON.stringify({ ok: false, refusal: "token" })]);
});

// Drift: an install stores its settings before it answers any request, so the setup has no answer for one without: it must fail shut, and say nothing of why.
test("a store with no settings in it, which no running install has, fails the run for the install's own token: no reading, no word of the cause, and nothing written", async () => {
  const { opened, call, reads } = await openSetup({ store: "none" });
  const before = await opened.audit();
  const answer = await call("repair", { token: OWN });

  expect([...(await told(answer)), reads.count]).toEqual([500, "Something went wrong.", 1]);
  expect(await opened.audit()).toEqual(before);
});

// Drift: `poplin setup` and the setup screen both read this answer; and the first repair is run here, before anyone can log in, so a run that was not kept would leave the dashboard a person then opens calling a repaired install "not checked yet".
test("the token of the install's own account is answered the reading and the logins the install expects; a repair is kept as the domain's last run and writes one audit entry that names what changed and not the token", async () => {
  const { opened, call, plug } = await openSetup();
  const checked = await call("check", { token: OWN });
  const before = (await opened.audit()).length;
  const repaired = await call("repair", { token: OWN });
  const sent = await emitted(repaired.clone());

  expect(await told(checked)).toEqual([200, { ok: true, rows: [PIECE], steps: [], expects: opened.owner }]);
  expect(await told(repaired)).toEqual([200, { ok: true, rows: [{ ...PIECE, state: "created" }], steps: [], expects: opened.owner }]);
  expect(plug.calls.map((made) => [made.run, made.token])).toEqual([
    ["check", OWN],
    ["repair", OWN],
  ]);
  expect((await opened.audit()).length).toBe(before + 1);
  expect(await opened.install.database.readDomainCheck()).toEqual({
    ran_at: opened.install.now(),
    by: opened.owner,
    run: "repair",
    pieces: [{ piece: "DNS record", detail: "poplin.example.com", part: "reach", state: "ok" }],
  });
  expect((await opened.audit())[0]).toMatchObject({ action: "domain_synced", by: opened.owner, detail: { run: "repair", from: "setup", created: ["DNS record: poplin.example.com"] } });
  expect([sent.includes(OWN), JSON.stringify(await opened.audit()).includes(OWN)]).toEqual([false, false]);
});

// Drift: a provider's refusal can quote the key it was sent, and a failure can carry it in its message: either would put the account's token into an answer or into the audit log.
test.each([
  [
    "hands the token back in its reading",
    200,
    (): DomainReading => ({ ok: true, rows: [{ object: OWN, state: "failed", detail: `Bearer ${OWN}`, part: "rest" }], steps: [{ text: OWN, address: `https://dash.example.com/${OWN}` }] }),
  ],
  [
    "throws the token",
    500,
    (): DomainReading => {
      throw new Error(OWN);
    },
  ],
] as const)("a plug that %s leaks nothing of it through the answer or the audit log", async (_name, status, answer) => {
  const { opened, call } = await openSetup({ plug: fakePlug(answer) });
  const answered = await call("repair", { token: OWN });

  expect([answered.status, (await emitted(answered)).includes(OWN), JSON.stringify(await opened.audit()).includes(OWN)]).toEqual([status, false, false]);
});

// Drift: the setup takes a secret from anyone who finds it, so its only guard against guessing is the count of tries.
test("six tries from one address in a minute: the sixth is refused before the plug is asked, another address still gets through, and the next minute starts anew", async () => {
  const { opened, call, plug, address } = await openSetup();
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) statuses.push((await call("check", { token: FOREIGN })).status);

  const sixth = await call("check", { token: OWN });
  const asked = plug.calls.length;
  address.value = "198.51.100.9";
  const elsewhere = await call("check", { token: OWN });
  address.value = "203.0.113.7";
  opened.clock.now += 60_000;
  const later = await call("check", { token: OWN });

  expect([statuses, await told(sixth), asked]).toEqual([[403, 403, 403, 403, 403], TOO_MANY, 5]);
  expect([elsewhere.status, later.status]).toEqual([200, 200]);
});

// Drift: counted before the question of how it was sent, a call a page of another origin made the owner's browser send would use up the owner's tries and shut them out for that minute.
test("a call in a type a page of another origin can make a browser send is refused uncounted: after five in each such type, the person's own five tries are all still there", async () => {
  const { call, plug } = await openSetup({ plug: usualPlug() });
  const foreign = [];
  for (let sent = 0; sent < 5; sent += 1) {
    foreign.push(await call("check", JSON.stringify({ token: OWN }), "text/plain"), await call("repair", new URLSearchParams({ token: OWN }).toString(), "application/x-www-form-urlencoded"), await call("check", "", ""));
  }
  const own = [];
  for (let sent = 0; sent < 6; sent += 1) own.push(await call("check", { token: OWN }, "Application/JSON; charset=utf-8"));

  expect(await told(foreign[0] as Response)).toEqual([415, { ok: false, refusal: "not_json" }]);
  expect(foreign.map((answer) => answer.status)).toEqual(foreign.map(() => 415));
  expect([own.map((answer) => answer.status), plug.calls.length]).toEqual([[200, 200, 200, 200, 200, 429], 5]);
});

// Drift: a guard that let a try through when it could not count it would leave the token open to guessing for as long as the counters are away.
test("counters that cannot answer shut the setup: a try is refused, never let through uncounted", async () => {
  const broken = {
    takeMinute: async (): Promise<never> => {
      throw new Error("the counters are down");
    },
  };
  const { call, plug } = await openSetup({ counters: broken });

  expect([await told(await call("check", { token: OWN })), plug.calls]).toEqual([TOO_MANY, []]);
});

// Drift: once somebody has logged in the setup is a door beside the login; one that still answered, or answered when it could not tell, would take a token from whoever finds it.
test.each([
  ["answers no", async (): Promise<boolean> => false],
  ["fails to say", async (): Promise<boolean> => Promise.reject(new Error("the database is down"))],
  [
    "throws before it makes a promise",
    (): Promise<boolean> => {
      throw new Error("the question threw");
    },
  ],
] as const)("a setup whose open question %s answers 404 to everything, says nothing, and asks the plug nothing", async (_name, open) => {
  const { ask, call, plug } = await openSetup({ open });
  const answers = [await call("check", { token: OWN }), await call("repair", { token: OWN }), await call("check", "x".repeat(20_000)), await call("check", "", "text/plain"), await ask("/setup"), await ask("/")];

  expect(await Promise.all(answers.map(told))).toEqual(answers.map(() => NOT_FOUND));
  expect(plug.calls).toEqual([]);
});

// Drift: the run is kept after the plug has answered, so a database that takes no more today fails it there; answered as a plain failure, a program would ask again all day.
test("a run the database cannot keep because its allowance for the day is used up is refused with the wait to midnight UTC", async () => {
  const { call } = await openSetup({ store: "spent" });
  const answer = await call("repair", { token: OWN });

  // The fixtures' moment is 22:13:20 UTC: 6,400 seconds before midnight.
  expect([answer.headers.get("Retry-After"), answer.headers.get("Cache-Control"), ...(await told(answer))]).toEqual(["6400", "no-store", 503, { ok: false, refusal: "allowance_spent" }]);
});

// Drift: a first login mistyped at setup was the only login and the only email the login let in, and nothing could change it: nobody could log in, and the setup read no email.
test("while nobody has logged in, a repair with the install's own token and an email sets the first login to it, for the plug and for the store, and says so; no email keeps the stored one", async () => {
  const { opened, plug, call, logins } = await openSetup();
  const kept = await call("repair", { token: OWN });
  const before = await logins();
  const corrected = await call("repair", { token: OWN, login: ` ${MEANT} ` });

  expect([before, ((await kept.json()) as { expects: string }).expects]).toEqual([[opened.owner], opened.owner]);
  expect([corrected.status, ((await corrected.json()) as { expects: string }).expects, await logins()]).toEqual([200, MEANT, [MEANT]]);
  expect<unknown>(plug.calls.map((made) => made.settings?.logins)).toEqual([[opened.owner], [MEANT]]);
  expect((await opened.audit())[0]).toMatchObject({ action: "domain_synced", by: MEANT });
});

// Drift: the setup is open to anyone until the first login, so a stranger who could change the login, or read it, would own the install or learn who does.
test.each(unchanged)("$name leaves the stored login as it was, and an answer that is no reading says nothing of it", async ({ run, token, login, status, asked }) => {
  const { opened, plug, call, logins } = await openSetup();
  const answer = await call(run, { token, login });
  const text = (await answer.text()).toLowerCase();

  expect([answer.status, await logins()]).toEqual([status, [opened.owner]]);
  expect<unknown>(plug.calls.flatMap((made) => (made.settings === undefined ? [] : [made.settings.logins]))).toEqual(asked);
  // A reading names the login the store holds, which a check leaves as it was.
  expect([text.includes(opened.owner), text.includes(login.toLowerCase())]).toEqual(status === 200 ? [true, false] : [false, false]);
});

// Drift: the correction is the one change of the logins made by nobody who is a login; left open after a login it would hand the install to whoever holds a token of the account.
test("once somebody has logged in, an email sent beside the token changes no login, even where the setup were still asked", async () => {
  const { opened, plug, call, logins } = await openSetup();
  await opened.install.database.appendAudit({ action: "login", detail: {} }, { by: opened.owner, at: opened.install.now() });
  const answer = await call("repair", { token: OWN, login: MEANT });

  expect([answer.status, await logins(), plug.calls.at(-1)?.settings?.logins]).toEqual([200, [opened.owner], [opened.owner]]);
});

// Drift: an install with nothing set is open to anyone who finds it, and whoever calls has proven nothing of it: a run that stored a setting, a login, or an audit entry would let a stranger write into an install that is not theirs.
test("on an install with nothing set a repair runs the plug of the sent domain and login with the defaults of such an install, answers its reading and no expected login, and never touches the install's database", async () => {
  const { first, plug, call } = openFirstSetup();
  const repaired = await call("repair", { domain: " Example.COM ", login: "Owner@Example.com", token: OWN });
  const text = await repaired.text();
  const reading = JSON.parse(text) as { readonly ok: boolean; readonly rows: readonly { readonly state: string }[]; readonly expects?: string };

  expect([repaired.status, reading.ok, reading.rows.filter((row) => row.state === "created").length, "expects" in reading, text.includes(OWN)]).toEqual([200, true, 1, false, false]);
  expect(first.asked).toEqual([{ domain: "example.com", login: "owner@example.com" }]);
  expect<unknown>(plug.calls.map(({ run, settings }) => [run, settings?.logins, settings?.outside_pages])).toEqual([["repair", ["owner@example.com"], "blocked"]]);
});

// Drift: a mistyped value sent on would spend the person's token on a run under the wrong domain or for nobody's login.
test.each(mistyped)("on an install with nothing set $name is refused before the plug is asked, by a refusal that names the field and not what was in it", async ({ sent, refusal, asked }) => {
  const { first, plug, call } = openFirstSetup();
  const refused = await call("repair", { ...sent, token: OWN });

  expect([await told(refused), plug.calls, first.asked.length]).toEqual([[400, { ok: false, refusal }], [], asked]);
});

// Drift: an install with nothing set has no domain and no login to tell callers apart by; uncounted there, its setup could be tried without end.
test("on an install with nothing set the sixth try of one address in a minute is refused before the provider's side is asked for a plug", async () => {
  const { first, plug, call } = openFirstSetup();
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) statuses.push((await call("check", { token: OWN, ...FIRST })).status);

  const sixth = await call("repair", { token: OWN, ...FIRST });

  expect([statuses, await told(sixth)]).toEqual([[200, 200, 200, 200, 200], TOO_MANY]);
  expect([first.asked.length, plug.calls.map(({ run }) => run)]).toEqual([5, ["check", "check", "check", "check", "check"]]);
});
