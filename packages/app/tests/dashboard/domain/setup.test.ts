import { expect, test } from "bun:test";

import type { Counters } from "../../../src/limits/limits";
import { MemoryCounters } from "../../../src/limits/memory-counters";
import { createSetup } from "../../../src/dashboard/domain/setup";
import type { DomainReading } from "../../../src/dashboard/domain/records";
import { formHeadersOf } from "../support/browser";
import { CSRF_SECRET, ORIGIN, openDashboard } from "../support/install";
import { type FakePlug, fakePlug, firstRunOf, TOKEN, usualPlug } from "./support/fake-plug";

/** The line above the table: its kind and its text. */
const NOTICE = /<p class="notice (done|refused)" role="status">([^<]*)<\/p>/;

/** A token of the install's account. */
const OWN = TOKEN;

/** A token that is valid for another account. */
const FOREIGN = "token-of-another-account-0123456789";

/** How a test's setup page differs from the usual one. */
interface Options {
  /** The plug; left out, one that takes the install's own token alone. */
  readonly plug?: FakePlug;

  /** Whether the page answers; it does when left out. */
  readonly open?: () => Promise<boolean>;

  /** Where tries are counted; left out, exact counters in memory. */
  readonly counters?: Pick<Counters, "takeMinute">;

  /** Whether the install has its settings; it has when left out. */
  readonly settings?: "stored" | "none";
}

/** A plug that reads the install for its own account's token and refuses every other, as the real one must. */
function guardedPlug(): FakePlug {
  return fakePlug((run, token) =>
    token === OWN
      ? { ok: true, rows: [{ object: "DNS record", state: run === "check" ? "missing" : "created", detail: "poplin.example.com" }], steps: [] }
      : { ok: false, refusal: "token" },
  );
}

async function openSetup(options: Options = {}) {
  const opened = await openDashboard();
  const plug = options.plug ?? guardedPlug();
  const address = { value: "203.0.113.7" };
  const reads = { count: 0 };
  const { database } = opened.install;

  // The page's own view of the database: every read of the settings is counted, and an install with none has none.
  const watched = {
    appendAudit: (...written: Parameters<typeof database.appendAudit>) => database.appendAudit(...written),
    readSettings: async () => {
      reads.count += 1;

      return options.settings === "none" ? undefined : database.readSettings();
    },
  } as unknown as typeof database;
  const setup = createSetup({
    install: { database: watched, now: opened.install.now },
    domain: plug,
    open: options.open ?? (async () => true),
    counters: options.counters ?? new MemoryCounters(),
    visitorOf: async () => address.value,
    csrfSecret: CSRF_SECRET,
  });
  const get = (path: string): Promise<Response> => setup.fetch(new Request(`${ORIGIN}${path}`));
  const csrf = async (): Promise<string> => /name="csrf" value="([^"]+)"/.exec(await (await get("/setup")).text())?.[1] ?? "";
  const post = async (
    run: string,
    token: string,
    fields: Readonly<Record<string, string>> | undefined = undefined,
    changed: Readonly<Record<string, string>> = {},
  ): Promise<Response> =>
    setup.fetch(
      new Request(`${ORIGIN}/setup/${run}`, {
        method: "POST",
        headers: { ...formHeadersOf(await get("/setup"), ORIGIN), ...changed },
        body: new URLSearchParams({ token, ...(fields ?? { csrf: await csrf() }) }).toString(),
      }),
    );

  // A program's call: the token in a JSON body, with no page opened first and no form token.
  const call = (run: string, body: string, type = "application/json"): Promise<Response> =>
    setup.fetch(new Request(`${ORIGIN}/setup/api/${run}`, { method: "POST", headers: { "Content-Type": type }, body }));

  return { opened, plug, address, reads, get, post, call };
}

/** Every byte an answer carries: its status, its headers but the one random nonce, and its body with the form's own token and the nonce taken out. */
async function emitted(answer: Response): Promise<string> {
  const headers = [...answer.headers].map(([name, value]) => [name, value.replace(/'nonce-[^']+'/, "nonce")]);
  const body = (await answer.text()).replace(/name="csrf" value="[^"]+"/, "csrf").replace(/<style nonce="[^"]+">/, "<style>");

  return JSON.stringify([answer.status, headers, body]);
}

test("before a valid token the page says nothing of the install: the form alone, under a fixed title, with no tab and no setting", async () => {
  const { opened, get, plug } = await openSetup();
  const answer = await get("/setup");
  const page = await answer.text();

  expect([answer.status, answer.headers.get("Cache-Control")]).toEqual([200, "no-store"]);
  expect(page).toContain("<title>Setup - poplin</title>");
  expect(page).toContain('<form method="post" action="/setup/check">');
  expect(page).toContain('<button type="submit" formaction="/setup/repair">Repair</button>');
  expect(page).not.toContain("<nav");
  expect(page).not.toContain("example.com");
  expect(page).not.toContain(opened.owner);
  expect(plug.calls).toEqual([]);
});

test("a wrong token, a token of another account, and a malformed one get the same answer byte for byte whether or not the install has settings, and the settings are never read for them", async () => {
  const answers: string[] = [];

  for (const settings of ["stored", "none"] as const) {
    const { opened, post, address, reads } = await openSetup({ settings });
    const before = await opened.audit();

    for (const [index, token] of ["wrong-token-0123456789-abcdefgh", FOREIGN, "short", "", "not a token\r\n"].entries()) {
      address.value = `203.0.113.${index}`;
      for (const run of ["check", "repair"]) answers.push(await emitted(await post(run, token)));
    }

    expect([settings, reads.count]).toEqual([settings, 0]);
    expect(await opened.audit()).toEqual(before);
  }

  expect(answers).toHaveLength(20);
  expect(new Set(answers).size).toBe(1);
  expect(answers[0]).toContain("Token refused.");
  expect(answers[0]?.startsWith("[403,")).toBe(true);
  expect(answers[0]).not.toContain("example.com");
});

test("only the install's own token learns that the install has no settings yet, and nothing is written", async () => {
  const { opened, post, reads } = await openSetup({ settings: "none" });
  const before = await opened.audit();
  const answer = await post("repair", OWN);

  expect([answer.status, NOTICE.exec(await answer.text())?.[2], reads.count]).toEqual([404, "This install is not set up yet.", 1]);
  expect(await opened.audit()).toEqual(before);
});

test("the token of the install's own account opens the table; a repair writes one audit entry that names what changed and not the token", async () => {
  const { opened, post, plug } = await openSetup();
  const checked = await post("check", OWN);
  const before = (await opened.audit()).length;
  const repaired = await post("repair", OWN);

  expect([checked.status, NOTICE.exec(await checked.text())?.[2]]).toEqual([200, "1 to repair"]);
  expect([repaired.status, NOTICE.exec(await repaired.clone().text())?.[2]]).toEqual([200, "1 repaired"]);
  expect(plug.calls.map((call) => [call.run, call.token])).toEqual([
    ["check", OWN],
    ["repair", OWN],
  ]);
  expect((await opened.audit()).length).toBe(before + 1);
  expect((await opened.audit())[0]).toMatchObject({
    action: "domain_synced",
    by: opened.owner,
    detail: { run: "repair", from: "setup", created: ["DNS record: poplin.example.com"] },
  });
  expect(await emitted(repaired)).not.toContain(OWN);
  expect(JSON.stringify(await opened.audit())).not.toContain(OWN);
});

test("a plug that hands the token back or throws it leaks nothing through the setup page", async () => {
  const echoing: DomainReading = {
    ok: true,
    rows: [{ object: OWN, state: "failed", detail: `Bearer ${OWN}` }],
    steps: [{ text: OWN, address: `https://dash.example.com/${OWN}` }],
  };
  const plugs = [
    fakePlug(() => echoing),
    fakePlug(() => {
      throw new Error(OWN);
    }),
  ];

  for (const plug of plugs) {
    const { opened, post } = await openSetup({ plug });

    expect(await emitted(await post("repair", OWN))).not.toContain(OWN);
    expect(JSON.stringify(await opened.audit())).not.toContain(OWN);
  }
});

test("six tries from one address in a minute: the sixth is refused before the plug is asked, another address still gets through, and the next minute starts anew", async () => {
  const { opened, post, plug, address } = await openSetup();

  for (let attempt = 0; attempt < 5; attempt += 1) expect((await post("check", FOREIGN)).status).toBe(403);

  const sixth = await post("check", OWN);

  expect([sixth.status, NOTICE.exec(await sixth.text())?.[2]]).toEqual([429, "Too many tries. Wait a minute."]);
  expect(plug.calls).toHaveLength(5);

  address.value = "198.51.100.9";

  expect((await post("check", OWN)).status).toBe(200);

  address.value = "203.0.113.7";
  opened.clock.now += 60_000;

  expect((await post("check", OWN)).status).toBe(200);
});

test("counters that cannot answer shut the page: a try is refused, never let through uncounted", async () => {
  const broken = {
    takeMinute: async (): Promise<never> => {
      throw new Error("the counters are down");
    },
  };
  const { post, plug } = await openSetup({ counters: broken });

  expect((await post("check", OWN)).status).toBe(429);
  expect(plug.calls).toEqual([]);
});

test("a page that is not open answers 404 to everything and says nothing, also when the question itself fails", async () => {
  const shut = [
    async (): Promise<boolean> => false,
    async (): Promise<boolean> => {
      throw new Error("the database is down");
    },
    (): Promise<boolean> => {
      throw new Error("the question threw before it made a promise");
    },
  ];

  for (const open of shut) {
    const { get, post, plug } = await openSetup({ open });
    const answers = [await get("/setup"), await post("check", OWN, { csrf: "1.0" }), await post("repair", OWN, { csrf: "1.0" }), await get("/")];

    for (const answer of answers) expect([answer.status, await answer.text()]).toEqual([404, "Not found."]);

    expect(plug.calls).toEqual([]);
  }
});

test("a post without the form's token, with a forged one, from another origin, or in another content type is refused before the plug is asked; every other path is a 404", async () => {
  const { opened, get, post, plug, address } = await openSetup({ plug: usualPlug() });
  const before = await opened.audit();
  const csrf = /name="csrf" value="([^"]+)"/.exec(await (await get("/setup")).text())?.[1] ?? "";
  const refused = [
    await post("repair", OWN, {}),
    await post("repair", OWN, { csrf: `${opened.clock.now}.${"0".repeat(64)}` }),
    await post("repair", OWN, { csrf }, { Origin: "https://evil.example.net" }),
    await post("repair", OWN, { csrf }, { "Sec-Fetch-Site": "cross-site" }),
  ];

  expect(refused.map((answer) => answer.status)).toEqual([403, 403, 403, 403]);

  address.value = "198.51.100.9";

  expect((await post("repair", OWN, { csrf }, { "Content-Type": "application/json" })).status).toBe(415);
  expect([(await get("/")).status, (await get("/setup/check")).status, (await post("save", OWN, { csrf })).status]).toEqual([404, 404, 404]);
  expect(plug.calls).toEqual([]);
  expect(await opened.audit()).toEqual(before);
});

test("a program's call is answered as JSON by the same run, the same count of tries, and the same open question as the page's form: a second way in with any one of them missing would be the weaker door", async () => {
  const { opened, call, plug, address } = await openSetup();
  const own = JSON.stringify({ token: OWN });
  const checked = await call("check", own);
  const refused = await call("repair", JSON.stringify({ token: FOREIGN }));
  const noToken = await call("check", JSON.stringify({ secret: OWN }));
  const asForm = await call("repair", new URLSearchParams({ token: OWN }).toString(), "application/x-www-form-urlencoded");
  const unknown = await call("save", own);
  const fifth = await call("check", own);
  const sixth = await call("check", own);

  expect([checked.status, await checked.json()]).toEqual([200, { ok: true, rows: [{ object: "DNS record", state: "missing", detail: "poplin.example.com" }], steps: [] }]);
  expect([refused.status, await refused.json()]).toEqual([403, { ok: false, refusal: "token" }]);
  expect([noToken.status, asForm.status, unknown.status, fifth.status]).toEqual([403, 415, 404, 200]);
  expect([sixth.status, await sixth.json()]).toEqual([429, { ok: false, refusal: "too_many_tries" }]);
  expect(plug.calls.map(({ run }) => run)).toEqual(["check", "repair", "check", "check"]);
  expect((await opened.audit())[0]).toMatchObject({ action: "domain_synced", detail: { run: "check", from: "setup" } });

  address.value = "198.51.100.9";
  const shut = await openSetup({ open: async () => false });

  expect([(await shut.call("repair", own)).status, shut.plug.calls]).toEqual([404, []]);
});

/** A database every use of which fails the test: the page of an install with nothing set may neither read nor write one. */
const NO_DATABASE = new Proxy({}, { get: (_target, name) => () => Promise.reject(new Error(`the database was asked for ${String(name)}`)) }) as Parameters<typeof createSetup>[0]["install"]["database"];

/** The setup page of an install with nothing set, over a plug the test wrote, with a browser's way of posting its form. */
function openFirstSetup(plug: FakePlug = usualPlug()) {
  const first = firstRunOf(plug);
  const setup = createSetup({ install: { database: NO_DATABASE, now: () => 1_700_000_000_000 }, domain: first, open: async () => true, counters: new MemoryCounters(), visitorOf: async () => "203.0.113.7", csrfSecret: CSRF_SECRET });
  const get = (): Promise<Response> => setup.fetch(new Request(`${ORIGIN}/setup`));
  const post = async (run: string, fields: Readonly<Record<string, string>>): Promise<Response> => {
    const page = await get();
    const csrf = /name="csrf" value="([^"]+)"/.exec(await page.clone().text())?.[1] ?? "";

    return setup.fetch(new Request(`${ORIGIN}/setup/${run}`, { method: "POST", headers: formHeadersOf(page, ORIGIN), body: new URLSearchParams({ csrf, ...fields }).toString() }));
  };
  const call = (run: string, body: object): Promise<Response> =>
    setup.fetch(new Request(`${ORIGIN}/setup/api/${run}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  return { first, plug, get, post, call };
}

// Drift: an install with nothing set is open to anyone who finds it, and whoever posts has proven nothing of it: a run that stored a setting, a login, or an audit entry would let a stranger write into an install that is not theirs.
test("on an install with nothing set a repair runs the plug of the typed domain and login with the defaults of such an install, shows its table, and never touches the install's database", async () => {
  const { first, plug, get, post } = openFirstSetup();
  const page = await (await get()).text();
  const repaired = await post("repair", { domain: " Example.COM ", login: "Owner@Example.com", token: OWN });
  const text = await repaired.text();

  expect([page.includes('name="domain"'), page.includes('name="login"'), page.includes("This install is new.")]).toEqual([true, true, true]);
  expect([repaired.status, NOTICE.exec(text)?.slice(1), text.includes(OWN)]).toEqual([200, ["done", "1 repaired"], false]);
  expect(first.asked).toEqual([{ domain: "example.com", login: "owner@example.com" }]);
  expect<unknown>(plug.calls.map(({ run, settings }) => [run, settings?.logins, settings?.outside_pages])).toEqual([["repair", ["owner@example.com"], "blocked"]]);
});

const mistyped: readonly { readonly name: string; readonly fields: Readonly<Record<string, string>>; readonly says: string; readonly asked: number }[] = [
  { name: "an email that is none", fields: { domain: "example.com", login: "owner" }, says: "The email is no email address.", asked: 0 },
  { name: "no email", fields: { domain: "example.com" }, says: "The email is no email address.", asked: 0 },
  { name: "text that is no domain", fields: { domain: "localhost", login: "owner@example.com" }, says: "The domain is no domain. Type it alone, such as example.com.", asked: 1 },
];

// Drift: a mistyped box sent on would spend the person's token on a run under the wrong domain or for nobody's login.
test.each(mistyped)("$name is refused before the plug is asked, in a sentence that names the box", async ({ fields, says, asked }) => {
  const { first, plug, post } = openFirstSetup();
  const refused = await post("repair", { ...fields, token: OWN });
  const text = await refused.text();

  expect([refused.status, NOTICE.exec(text)?.slice(1), plug.calls, first.asked.length]).toEqual([400, ["refused", says], [], asked]);
  expect(text.includes(OWN)).toBe(false);
});

// Drift: the two entry points and the count of tries are one guard; an install with nothing set that counted only one of them, or none, would let its page be tried without end.
test("a program's call carries the same two values, and the sixth try of one address is refused, form and call counted together", async () => {
  const { first, plug, post, call } = openFirstSetup();
  const called = await call("check", { token: OWN, domain: "example.com", login: "owner@example.com" });
  const statuses = [called.status];
  for (let again = 0; again < 4; again += 1) statuses.push((await post("check", { domain: "example.com", login: "owner@example.com", token: FOREIGN })).status);

  const sixth = await call("repair", { token: OWN, domain: "example.com", login: "owner@example.com" });

  expect([statuses, sixth.status, await sixth.json()]).toEqual([[200, 200, 200, 200, 200], 429, { ok: false, refusal: "too_many_tries" }]);
  expect([first.asked.length, plug.calls.map(({ run }) => run)]).toEqual([5, ["check", "check", "check", "check", "check"]]);
});
