// The setup page and the Domain screen on the Worker's real entry, with an account at a stand-in Cloudflare.
// Without these the page could pass its own tests and still be mounted open forever, on an address that serves the install, or over a plug that keeps the token.

import { reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readShell } from "../../../app/tests/console/support/shell";
import type { Bindings } from "../../src/worker/bindings";
import { type Account, emptyAccount, OTHER_TOKEN, TEAM, TOKEN } from "../zone/support/fake-install";
import type { Asked } from "../zone/support/replies";
import { ADMIN, accessHeaders, ask, BINDINGS, cloudflareOf, cookieOf, countedBindings, installOf, instance, logIn, OWNER, page, publish, send, sweep, type World, tokenOf, under, world } from "./support/install";

/** The Worker's own address, which Cloudflare gives it whatever its routes. */
const OWN = "https://poplin.example-account.workers.dev";

/** The policy the setup page goes out under: it runs its own script alone and reads this origin alone. */
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** The bindings of an install whose setup has not written `ACCESS` yet. */
const UNFINISHED = { ...BINDINGS, ACCESS: undefined } as Bindings;

/** A run that read its table, as the setup page's client and the Domain screen are answered it. */
interface Ran {
  readonly ok: true;
  readonly rows: readonly { readonly piece: string; readonly state: string; readonly tone: string; readonly detail: string }[];
  readonly steps: readonly { readonly text: string; readonly address?: string }[];
  readonly summary: { readonly line: string; readonly tone: string };
  readonly expects?: string | null;
}

/** What a program's check is answered: every object as the plug read it. */
interface Checked {
  readonly rows: readonly { readonly object: string; readonly state: string; readonly detail: string }[];
}

/** What the setup page starts its client from. */
interface SetupBoot {
  readonly setup: { readonly boxes: string };
}

let w: World;
let account: Account;
let asked: Asked[];

/** Everything the instance wrote to its log. */
let logged: ReturnType<typeof vi.spyOn>[];

function writes(): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path.split("?")[0]}`);
}

/** Send the repair of a setup page with a token, as the page's client does. */
function repair(worker: ReturnType<typeof instance>, setup: string, sent: Record<string, string>, headers: Record<string, string> = {}, bindings: Bindings = BINDINGS): Promise<Response> {
  return send(worker, `${setup}/data/repair`, sent, headers, bindings);
}

/** Send a check to a setup page with a token, as `poplin setup --check` does. */
function check(worker: ReturnType<typeof instance>, setup: string, sent: Record<string, string>): Promise<Response> {
  return send(worker, `${setup}/api/check`, sent);
}

/** Every row of every table of the database, as one text. */
async function stored(): Promise<string> {
  const tables = await BINDINGS.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'").all<{ name: string }>();
  const rows = await Promise.all(tables.results.map(async ({ name }) => (await BINDINGS.DB.prepare(`SELECT * FROM "${name}"`).all()).results));

  return JSON.stringify(rows);
}

beforeEach(async () => {
  await reset();
  w = await world();
  account = emptyAccount();
  asked = [];
  logged = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the setup page", () => {
  // Drift: the page is the one way in before anyone can log in; left open after that, it is a door beside the login for whoever holds a token of the account.
  test("answers on the admin hostname and on the Worker's own address until somebody logs in, and never again: not on a new instance, not its client's files, and not to a run", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const before = [await ask(worker, `${ADMIN}/setup`), await ask(worker, `${OWN}/setup`), await ask(worker, `${OWN}/`)];
    const opened = await readShell((await before[1]?.text()) ?? "");
    const [script = ""] = opened.scripts;
    const file = await ask(worker, `${OWN}${script}`);
    const login = await logIn(worker, w);
    const after = [await ask(worker, `${ADMIN}/setup`), await ask(worker, `${OWN}/setup`), await ask(instance(w), `${ADMIN}/setup`), await ask(worker, `${OWN}/`), await ask(worker, `${OWN}${script}`)];
    const posted = await repair(worker, `${ADMIN}/setup`, { token: TOKEN });

    expect(before.map((answer) => [answer.status, answer.headers.get("Location")])).toEqual([[200, null], [200, null], [302, "/setup"]]);
    // Drift: the page is the one place a token of the whole account is typed into; under a looser policy a script of another origin could read it.
    expect([before[0]?.headers.get("Content-Security-Policy"), before[0]?.headers.get("Cache-Control")]).toEqual([POLICY, "no-store"]);
    expect([(opened.boot as SetupBoot).setup.boxes, script.startsWith("/setup/assets/"), file.status, file.headers.get("Content-Type")]).toEqual(["login", true, 200, "text/javascript;charset=utf-8"]);
    expect(login.status).toBe(302);
    expect([...after, posted].map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(asked).toEqual([]);
  });

  // Drift: the Worker's own address is beside every route and every rule of the zone, and in front of no Access application: anything of the install answered there would be reached around all of them.
  test("is all the Worker's own address answers: no site, no API, no login, and no dashboard page or data, with or without a token or a session", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "admin");
    const session = { Cookie: cookieOf(await logIn(worker, w)), Authorization: `Bearer ${token}`, ...(await accessHeaders(w)) };
    const paths = ["/", "/api/whoami", "/api/sites", "/login", "/settings", "/domain", "/data/sites", "/data/settings", "/index.html"];
    const answers = await Promise.all(paths.map((path) => ask(worker, `${OWN}${path}`, { headers: session })));

    expect(await Promise.all(answers.map(async (answer) => [answer.status, await answer.text(), answer.headers.get("Set-Cookie")]))).toEqual(paths.map(() => [404, "Not found.\n", null]));
  });

  // Drift: the page is asked for by anyone, before any login: a check that read the audit log a page at a time would cost more with every run of setup, and past the database's cap of queries for one request the page would shut on the person setting up.
  test("stays open through its own runs and costs the same database calls after 250 of them as after none, then shuts at a login", async () => {
    const tally = { calls: 0 };
    const counted = countedBindings(tally);
    const worker = instance(w, cloudflareOf(account, asked));
    await ask(worker, `${ADMIN}/setup`, {}, counted);
    tally.calls = 0;
    await ask(worker, `${ADMIN}/setup`, {}, counted);
    const fresh = tally.calls;

    const { database } = await installOf(w);
    for (let entry = 0; entry < 250; entry += 1) await database.appendAudit({ action: "domain_synced", detail: { run: "check", from: "setup" } }, { by: OWNER, at: w.clock.now });

    tally.calls = 0;
    const open = await ask(worker, `${ADMIN}/setup`, {}, counted);
    const after = tally.calls;
    await database.appendAudit({ action: "login", detail: {} }, { by: OWNER, at: w.clock.now });

    expect([open.status, after, (await ask(worker, `${ADMIN}/setup`, {}, counted)).status]).toEqual([200, fresh, 404]);
    expect(fresh).toBeGreaterThan(0);
  });

  // Drift: a check that wrote would repair behind the owner's back, and a token of another account that passed would set up somebody else's zone from this page.
  test("a check with the account's token answers the rows and sends Cloudflare no change; a token of another account is refused and reads nothing of the install", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const checked = await check(worker, `${ADMIN}/setup`, { token: TOKEN });
    const ran = await checked.json<Checked>();
    const calls = asked.length;
    const other = await check(worker, `${OWN}/setup`, { token: OTHER_TOKEN });

    expect([checked.status, ran.rows.some((row) => row.object === "DNS record" && row.state === "missing"), writes()]).toEqual([200, true, []]);
    expect([other.status, await other.json(), [...new Set(asked.slice(calls).map((entry) => entry.path.split("?")[0]))]]).toEqual([403, { ok: false, refusal: "token" }, ["/zones"]]);
  });

  // Drift: the token opens the whole account. Kept anywhere, it outlives the one request it was pasted for.
  test("a repair makes the install's objects and writes ACCESS onto the Worker, and the token is in no answer, no stored row, and no log line", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const repaired = await repair(worker, `${OWN}/setup`, { token: TOKEN }, {}, UNFINISHED);
    const text = await repaired.text();
    const ran = JSON.parse(text) as Ran;
    const again = await ask(worker, `${OWN}/setup`, {}, UNFINISHED);
    const everything = [text, await again.text(), await stored(), JSON.stringify(logged.map((spy) => spy.mock.calls)), JSON.stringify([...repaired.headers, ...again.headers])];

    expect([repaired.status, ran.summary.tone, ran.steps, ran.expects]).toEqual([200, "good", [{ text: "The login is ready. Open your dashboard and log in:", address: ADMIN }], OWNER]);
    expect(account.bindings.find((binding) => binding.name === "ACCESS")).toEqual({ name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications[0]?.aud } });
    expect(account.routes.map((route) => [route.pattern, route.script])).toContainEqual(["poplin.example.com/*", "poplin"]);
    expect(everything.map((place) => place.includes(TOKEN))).toEqual([false, false, false, false, false]);
    expect((await (await installOf(w)).database.listAudit({ limit: 10 })).map((entry) => [entry.action, entry.detail.from])).toEqual([["domain_synced", "setup"], ["settings_set", undefined]]);
  });

  // Drift: the install keeps each run as the last check of its domain, and a refused call's answer can quote the token back. A kept row with the token in it would hold the account's key for as long as nobody checks again.
  test("a check that Cloudflare refuses one piece of is kept as the last check of the domain, with the right that piece lacked and nothing of the token", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    account.refuse = "GET /zones/zone-1/workers/routes";
    const checked = await check(worker, `${ADMIN}/setup`, { token: TOKEN });
    const ran = await checked.json<Checked>();
    const kept = await (await installOf(w)).database.readDomainCheck();
    const row = await BINDINGS.DB.prepare("SELECT ran_by, run, pieces FROM domain_check").all<{ ran_by: string; run: string; pieces: string }>();

    const failed = ["Worker route", "refused with status 403: 10000 Authentication error for Bearer [token]. Add this right to the token: Workers Routes: Edit"];

    expect([checked.status, ran.rows.filter((row) => row.state === "failed").map((row) => [row.object, row.detail]), writes()]).toEqual([200, [failed], []]);
    expect([kept?.by, kept?.run, kept?.pieces.filter((piece) => piece.state === "unread")]).toEqual([
      OWNER,
      "check",
      [{ piece: "Worker route", detail: expect.stringContaining("[token]"), part: "reach", state: "unread", reason: "missing_right", right: "Workers Routes: Edit" }],
    ]);
    expect([row.results.length, row.results[0]?.pieces.includes("[token]"), (await stored()).includes(TOKEN)]).toEqual([1, true, false]);
  });

  // Drift: `poplin setup` posts to this path, which the page's client never uses: mounted behind the page alone, the command would be cut off.
  // And a first login mistyped at setup was the only email Cloudflare's login let in and the only one the Worker took, with no way left to change either.
  test("a program's repair with the account's token and an email replaces the first login, in the store and in Cloudflare's policy, so the old one gets in nowhere; a token of another account changes and learns nothing", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const call = (body: Record<string, string>): Promise<Response> => ask(worker, `${OWN}/setup/api/repair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const logins = async (): Promise<readonly string[] | undefined> => (await (await installOf(w)).database.readSettings())?.logins;
    const meant = "meant@example.com";

    const first = await call({ token: TOKEN });
    const stranger = await call({ token: OTHER_TOKEN, login: meant });
    const strangerSaid = await stranger.text();
    const between = [await logins(), JSON.stringify(account.policies).includes(OWNER), JSON.stringify(account.policies).includes(meant)];
    const corrected = await call({ token: TOKEN, login: meant });
    const old = await logIn(worker, w);

    expect([first.status, stranger.status, strangerSaid]).toEqual([200, 403, JSON.stringify({ ok: false, refusal: "token" })]);
    expect(between).toEqual([[OWNER], true, false]);
    expect([corrected.status, (await corrected.json<{ expects?: string }>()).expects, await logins()]).toEqual([200, meant, [meant]]);
    expect([JSON.stringify(account.policies).includes(OWNER), JSON.stringify(account.policies).includes(meant), old.status === 302]).toEqual([false, true, false]);
  });

  // Drift: the page takes a secret from anyone who finds it, so its only guard against guessing is the count of tries.
  test("the sixth run one address sends in a minute is refused before Cloudflare is asked", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const from = { "CF-Connecting-IP": "192.0.2.7" };
    const statuses: number[] = [];
    for (let post = 0; post < 5; post += 1) statuses.push((await repair(worker, `${ADMIN}/setup`, { token: OTHER_TOKEN }, from)).status);

    const calls = asked.length;
    const sixth = await repair(worker, `${ADMIN}/setup`, { token: TOKEN }, from);

    expect([statuses, sixth.status, await sixth.json()]).toEqual([[403, 403, 403, 403, 403], 429, { ok: false, code: "too_many_tries", about: null, sentence: "Too many tries. Wait a minute." }]);
    expect([calls > 0, asked.length]).toEqual([true, calls]);
  });
});

describe("an install whose setup has not written ACCESS", () => {
  // Drift: a Worker that refused to start without the variable could never show the page that writes it; one that started and let the login through would let anyone in.
  test("answers setup, keeps the login and every private address shut, and lets the owner in once the variable is there", async () => {
    const unfinished = instance(w, cloudflareOf(account, asked));
    const headers = await accessHeaders(w);
    const setup = await ask(unfinished, `${OWN}/setup`, {}, UNFINISHED);
    const login = await ask(unfinished, `${ADMIN}/login`, { headers }, UNFINISHED);

    const site = await publish(instance(w), await tokenOf(w, "publisher"), { name: "report" }, [page("<h1>report</h1>")]);
    const shut = await ask(unfinished, `${under(site, "p")}/`, { headers }, UNFINISHED);
    const opened = await ask(instance(w), `${under(site, "p")}/`, { headers });
    const finished = await logIn(instance(w), w);

    expect([setup.status, login.status, await login.text(), login.headers.get("Set-Cookie")]).toEqual([200, 503, "The login is not set up yet. Finish the setup of this install first.\n", null]);
    expect([shut.status, (await shut.text()).includes("report"), opened.status, await opened.text()]).toEqual([404, false, 200, "<h1>report</h1>"]);
    expect(finished.status).toBe(302);
  });
});

describe("a Worker with nothing set", () => {
  /** The bindings of a Worker a deploy made: its bucket, its database, its limiter, and its own name. */
  const DEPLOYED = { ...BINDINGS, ZONE: undefined, ACCOUNT_ID: undefined, FIRST_SETTINGS: undefined, ACCESS: undefined } as Bindings;

  /** What a person types into the two boxes. */
  const TYPED = { domain: "example.com", login: OWNER };

  /** Send the repair of the setup page with the two boxes and a token, as the page's client does. */
  function first(worker: ReturnType<typeof instance>, token: string, bindings: Bindings = DEPLOYED, from: Record<string, string> = {}): Promise<Response> {
    return repair(worker, `${OWN}/setup`, { token, ...TYPED }, from, bindings);
  }

  beforeEach(() => {
    account.bindings = account.bindings.filter((binding) => binding.name !== "ZONE");
  });

  // Drift: a Worker that was deployed and nothing more used to answer a page of missing variables, which a person had to fill in by hand before any setup could run.
  test("answers its setup page with the two boxes and no hostname of an install, sends every other path there, and serves nothing else", async () => {
    const worker = instance(w);
    const opened = await ask(worker, `${OWN}/setup`, {}, DEPLOYED);
    const text = await opened.text();
    const hosts = (text.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? []).filter((host) => host.endsWith(".example.com"));
    const elsewhere = await Promise.all([`${OWN}/`, `${OWN}/api/whoami`, `${OWN}/data/sites`, `${ADMIN}/login`, "https://report--k3f9x2ab71qz-u-poplin.example.com/"].map((address) => ask(worker, address, {}, DEPLOYED)));

    expect([opened.status, ((await readShell(text)).boot as SetupBoot).setup.boxes, hosts]).toEqual([200, "first", []]);
    expect(elsewhere.map((answer) => [answer.status, answer.headers.get("Location")])).toEqual(elsewhere.map(() => [302, "/setup"]));
    await sweep(worker, w, DEPLOYED);
  });

  // Drift: whoever posts here has proven nothing of this install. The run may change what its token's own account holds at Cloudflare, and nothing this install keeps.
  test("a repair gives the Worker its values at Cloudflare in one press, within what one request may send and ask, and writes nothing to this install's database or bucket, whatever the token", async () => {
    const tally = { calls: 0 };
    const counted = { ...countedBindings(tally), ZONE: undefined, ACCOUNT_ID: undefined, FIRST_SETTINGS: undefined, ACCESS: undefined } as Bindings;
    const worker = instance(w, cloudflareOf(account, asked));
    await ask(worker, `${OWN}/setup`, {}, DEPLOYED);
    const before = [await stored(), (await BINDINGS.SITES.list()).objects.length];

    const stranger = await first(worker, OTHER_TOKEN);
    const strangers = asked.length;
    tally.calls = 0;
    await ask(worker, `${OWN}/setup`, {}, counted);
    const repaired = await first(worker, TOKEN, counted);
    const text = await repaired.text();
    const ran = JSON.parse(text) as Ran;

    expect([stranger.status, repaired.status, ran.summary.tone, text.includes(TOKEN)]).toEqual([200, 200, "good", false]);
    expect(account.bindings.map((binding) => binding.name)).toEqual(["SITES", "DB", "ZONE", "FIRST_SETTINGS", "ACCOUNT_ID", "ACCESS"]);
    expect([await stored(), (await BINDINGS.SITES.list()).objects.length]).toEqual(before);
    // The page and the run together: 30 calls to Cloudflare of the 50 a request of the Free plan may send, and 10 to the database of its 50.
    expect([asked.length - strangers, tally.calls]).toEqual([30, 10]);
  });

  // Drift: the page takes a secret from anyone who finds the address, before the install has a domain or a login to tell them apart by.
  test("the sixth run one address sends in a minute is refused before Cloudflare is asked, and a Worker whose values are gone while its database holds settings names them and offers no setup", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const from = { "CF-Connecting-IP": "192.0.2.9" };
    const statuses: number[] = [];
    for (let post = 0; post < 5; post += 1) statuses.push((await first(worker, "no-such-token-0123456789", DEPLOYED, from)).status);

    const calls = asked.length;
    statuses.push((await first(worker, TOKEN, DEPLOYED, from)).status);
    await ask(instance(w), `${ADMIN}/setup`);
    const lost = await ask(instance(w), `${OWN}/setup`, {}, DEPLOYED);

    expect([statuses, asked.length]).toEqual([[403, 403, 403, 403, 403, 429], calls]);
    expect([lost.status, (await lost.text()).includes("  ZONE: absent\n  ACCOUNT_ID: absent")]).toEqual([503, true]);
  });
});

describe("the Domain screen", () => {
  /** What the screen opens with, as far as these tests read it. */
  interface Opened {
    readonly form: { readonly tokenRights: readonly string[]; readonly tokenOptional: readonly { readonly right: string; readonly adds: string }[] };
  }

  // Drift: the screen is the only place a login added in Settings reaches Cloudflare's login from, and it was built and never mounted once before.
  test("is there for a logged-in admin with the token's rights, checks without a change, repairs with the pasted token, and is the login to anyone else", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const session = { Cookie: cookieOf(await logIn(worker, w)) };
    const strangers = [await ask(worker, `${ADMIN}/domain`), await ask(worker, `${ADMIN}/data/domain`), await send(worker, `${ADMIN}/data/domain/repair`, { token: TOKEN })];
    const shell = await ask(worker, `${ADMIN}/domain`, { headers: session });
    const opened = await ask(worker, `${ADMIN}/data/domain`, { headers: session });
    const text = await opened.text();
    const { form } = JSON.parse(text) as Opened;
    const checked = await send(worker, `${ADMIN}/data/domain/check`, { token: TOKEN }, session);
    const none = writes();
    const repaired = await send(worker, `${ADMIN}/data/domain/repair`, { token: TOKEN }, session);

    expect(strangers.map((answer) => [answer.status, answer.headers.get("Location")])).toEqual([[302, `${ADMIN}/login?return=${encodeURIComponent("/domain")}`], [401, null], [401, null]]);
    expect([asked.length > 0, shell.status, ((await readShell(await shell.text())).boot as { domain: boolean }).domain]).toEqual([true, 200, true]);
    expect([form.tokenRights.includes("Workers Scripts: Edit"), form.tokenRights.includes("Zone Settings: Read")]).toEqual([true, true]);
    // Drift: the link carries eight rights, so a right the plug holds optional that the page listed among the needed ones sends a person back to adding it by hand.
    expect([form.tokenRights.includes("Zone WAF: Edit"), form.tokenOptional.find((optional) => optional.right === "Zone WAF: Edit")?.adds.startsWith("Cloudflare stops"), text.includes("by hand")]).toEqual([false, true, false]);
    expect([checked.status, (await checked.json<Ran>()).ok, none, repaired.status, (await repaired.json<Ran>()).summary.tone, account.applications.length, (await stored()).includes(TOKEN)]).toEqual([200, true, [], 200, "good", 1, false]);
  });
});
