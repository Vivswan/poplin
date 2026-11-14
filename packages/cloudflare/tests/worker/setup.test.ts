// The setup page and the Domain tab on the Worker's real entry, with an account at a stand-in Cloudflare.
// Without these the page could pass its own tests and still be mounted open forever, on an address that serves the install, or over a plug that keeps the token.

import { reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Bindings } from "../../src/worker/bindings";
import { neverLoggedIn } from "../../src/worker/setup";
import { type Account, emptyAccount, OTHER_TOKEN, TEAM, TOKEN } from "../zone/support/fake-install";
import type { Asked } from "../zone/support/replies";
import { ADMIN, accessHeaders, ask, BINDINGS, cloudflareOf, cookieOf, installOf, instance, logIn, OWNER, page, publish, type World, tokenOf, under, world } from "./support/install";

/** The Worker's own address, which Cloudflare gives it whatever its routes. */
const OWN = "https://poplin.example-account.workers.dev";

/** The headers a browser posts a form of a page with. */
function formOf(origin: string): Record<string, string> {
  return { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, "Sec-Fetch-Site": "same-origin" };
}

/** The bindings of an install whose setup has not written `ACCESS` yet. */
const UNFINISHED = { ...BINDINGS, ACCESS: undefined } as Bindings;

let w: World;
let account: Account;
let asked: Asked[];

/** Everything the instance wrote to its log. */
let logged: ReturnType<typeof vi.spyOn>[];

function writes(): string[] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path.split("?")[0]}`);
}

/** Open a page that holds a form and post that form with a token, as a browser does. */
async function run(worker: ReturnType<typeof instance>, page: string, change: string, token: string, headers: Record<string, string> = {}, bindings: Bindings = BINDINGS): Promise<Response> {
  const origin = new URL(page).origin;
  const opened = await (await ask(worker, page, { headers }, bindings)).text();
  const [, csrf = ""] = /name="csrf" value="([^"]+)"/.exec(opened) ?? [];

  return ask(worker, `${page}/${change}`, { method: "POST", headers: { ...headers, ...formOf(origin) }, body: new URLSearchParams({ csrf, token }).toString() }, bindings);
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
  test("answers on the admin hostname and on the Worker's own address until somebody logs in, and never again: not on a new instance, and not to a post", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const before = [await ask(worker, `${ADMIN}/setup`), await ask(worker, `${OWN}/setup`), await ask(worker, `${OWN}/`)];
    const login = await logIn(worker, w);
    const after = [await ask(worker, `${ADMIN}/setup`), await ask(worker, `${OWN}/setup`), await ask(instance(w), `${ADMIN}/setup`), await ask(worker, `${OWN}/`)];
    const posted = await ask(worker, `${ADMIN}/setup/repair`, { method: "POST", headers: formOf(ADMIN), body: new URLSearchParams({ token: TOKEN }).toString() });

    expect(before.map((answer) => [answer.status, answer.headers.get("Location")])).toEqual([[200, null], [200, null], [302, "/setup"]]);
    expect(login.status).toBe(302);
    expect([...after, posted].map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404]);
    expect(asked).toEqual([]);
  });

  // Drift: the Worker's own address is beside every route and every rule of the zone, and in front of no Access application: anything of the install answered there would be reached around all of them.
  test("is all the Worker's own address answers: no site, no API, no login, and no dashboard, with or without a token or a session", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "admin");
    const session = { Cookie: cookieOf(await logIn(worker, w)), Authorization: `Bearer ${token}`, ...(await accessHeaders(w)) };
    const paths = ["/", "/api/whoami", "/api/sites", "/login", "/settings", "/domain", "/index.html"];
    const answers = await Promise.all(paths.map((path) => ask(worker, `${OWN}${path}`, { headers: session })));

    expect(await Promise.all(answers.map(async (answer) => [answer.status, await answer.text(), answer.headers.get("Set-Cookie")]))).toEqual(paths.map(() => [404, "Not found.\n", null]));
  });

  // Drift: `open` is read from the audit log, and the log is where setup itself writes: a run counted as a login would shut the page on the person in the middle of setting up.
  test("stays open through its own runs, however many, and shuts at the first entry that is not its own", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    await ask(worker, `${ADMIN}/setup`);
    const { database } = await installOf(w);
    for (let entry = 0; entry < 250; entry += 1) await database.appendAudit({ action: "domain_synced", detail: { run: "check", from: "setup" } }, { by: OWNER, at: w.clock.now });

    const open = await neverLoggedIn(database);
    await database.appendAudit({ action: "domain_synced", detail: { run: "check", from: "dashboard" } }, { by: OWNER, at: w.clock.now });

    expect([open, await neverLoggedIn(database), (await ask(worker, `${ADMIN}/setup`)).status]).toEqual([true, false, 404]);
  });

  // Drift: a check that wrote would repair behind the owner's back, and a token of another account that passed would set up somebody else's zone from this page.
  test("a check with the account's token shows the table and sends Cloudflare no change; a token of another account is refused and reads nothing of the install", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const checked = await run(worker, `${ADMIN}/setup`, "check", TOKEN);
    const text = await checked.text();
    const calls = asked.length;
    const other = await run(worker, `${OWN}/setup`, "check", OTHER_TOKEN);

    expect([checked.status, text.includes("<td>DNS record</td>"), text.includes("to repair"), writes()]).toEqual([200, true, true, []]);
    expect([other.status, (await other.text()).includes("Token refused."), [...new Set(asked.slice(calls).map((entry) => entry.path.split("?")[0]))]]).toEqual([403, true, ["/zones"]]);
  });

  // Drift: the token opens the whole account. Kept anywhere, it outlives the one request it was pasted for.
  test("a repair makes the install's objects and writes ACCESS onto the Worker, and the token is in no answer, no stored row, and no log line", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const repaired = await run(worker, `${OWN}/setup`, "repair", TOKEN, {}, UNFINISHED);
    const text = await repaired.text();
    const again = await ask(worker, `${OWN}/setup`, {}, UNFINISHED);
    const everything = [text, await again.text(), await stored(), JSON.stringify(logged.map((spy) => spy.mock.calls)), JSON.stringify([...repaired.headers, ...again.headers])];

    expect([repaired.status, text.includes("The login is ready. Open your dashboard and log in:"), text.includes('href="https://poplin.example.com"')]).toEqual([200, true, true]);
    expect(account.bindings.find((binding) => binding.name === "ACCESS")).toEqual({ name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications[0]?.aud } });
    expect(account.routes.map((route) => [route.pattern, route.script])).toContainEqual(["poplin.example.com/*", "poplin"]);
    expect(everything.map((place) => place.includes(TOKEN))).toEqual([false, false, false, false, false]);
    expect((await (await installOf(w)).database.listAudit({ limit: 10 })).map((entry) => [entry.action, entry.detail.from])).toEqual([["domain_synced", "setup"], ["settings_set", undefined]]);
  });

  // Drift: the page takes a secret from anyone who finds it, so its only guard against guessing is the count of tries.
  test("the sixth post one address sends in a minute is refused before Cloudflare is asked", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const from = { "CF-Connecting-IP": "192.0.2.7" };
    const statuses: number[] = [];
    for (let post = 0; post < 5; post += 1) statuses.push((await run(worker, `${ADMIN}/setup`, "check", OTHER_TOKEN, from)).status);

    const calls = asked.length;
    statuses.push((await run(worker, `${ADMIN}/setup`, "check", TOKEN, from)).status);

    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
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

describe("the Domain tab", () => {
  // Drift: the tab is the only place a login added in Settings reaches Cloudflare's login from, and it was built and never mounted once before.
  test("is there for a logged-in admin with the token's rights, checks without a change, repairs with the pasted token, and is the login page to anyone else", async () => {
    const worker = instance(w, cloudflareOf(account, asked));
    const session = { Cookie: cookieOf(await logIn(worker, w)) };
    const stranger = await ask(worker, `${ADMIN}/domain`);
    const tab = await (await ask(worker, `${ADMIN}/domain`, { headers: session })).text();
    const checked = await run(worker, `${ADMIN}/domain`, "check", TOKEN, session);
    const none = writes();
    const repaired = await run(worker, `${ADMIN}/domain`, "repair", TOKEN, session);

    expect([stranger.status, stranger.headers.get("Location")]).toEqual([302, `${ADMIN}/login?return=${encodeURIComponent("/domain")}`]);
    expect([tab.includes('href="/domain"'), tab.includes("<li>Workers Scripts: Edit</li>"), tab.includes("<li>Zone Settings: Read</li>")]).toEqual([true, true, true]);
    expect([checked.status, none, repaired.status, account.applications.length, (await stored()).includes(TOKEN)]).toEqual([200, [], 200, 1, false]);
  });
});
