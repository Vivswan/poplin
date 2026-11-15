// The setup screen's server side: the page that loads the client, the client's files, and the two runs, over the setup page's own handler.
// What it must keep: nothing of the install before a proven token, tries counted and refused when the counter fails, a shut page that says nothing, and a token that is in no answer.

import { describe, expect, test } from "bun:test";

import { createSetupConsole } from "../../src/console/setup-console";
import type { Counters } from "../../src/limits/limits";
import { MemoryCounters } from "../../src/limits/memory-counters";
import { type FakePlug, fakePlug, firstRunOf, TOKEN } from "../dashboard/domain/support/fake-plug";
import { CSRF_SECRET, ORIGIN, openDashboard } from "../dashboard/support/install";

/** A token that is valid for another account. */
const FOREIGN = "token-of-another-account-0123456789";

/** The files the test screen answers as its client's build. */
const ASSETS: Readonly<Record<string, { readonly body: string; readonly type: string }>> = {
  "app.js": { body: "// the client", type: "text/javascript; charset=utf-8" },
};

/** How a test's setup screen differs from the usual one. */
interface Options {
  /** Whether the install has nothing set, so the screen asks its domain and first login. */
  readonly first?: boolean;

  /** Whether the page answers; it does when left out. */
  readonly open?: () => Promise<boolean>;

  /** Where tries are counted; left out, exact counters in memory. */
  readonly counters?: Pick<Counters, "takeMinute">;

  /** The path the page answers at; `/setup` when left out. */
  readonly at?: string;
}

/** A refusal as the screen reads it. */
interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly about: string | null;
  readonly sentence: string;
}

/** A plug that reads the install for its own account's token and refuses every other, as the real one must. */
function guardedPlug(): FakePlug {
  return fakePlug((run, token) =>
    token === TOKEN
      ? { ok: true, rows: [{ object: "DNS record", state: run === "check" ? "missing" : "created", detail: "poplin.example.com", part: "reach" }], steps: [] }
      : { ok: false, refusal: "token" },
  );
}

async function openSetup(options: Options = {}) {
  const opened = await openDashboard();
  const plug = guardedPlug();
  const reads = { count: 0 };
  const { database } = opened.install;

  // The screen's own view of the database: every read of the settings is counted.
  const watched = {
    keepDomainCheck: (...kept: Parameters<typeof database.keepDomainCheck>) => database.keepDomainCheck(...kept),
    changeSettings: (...changed: Parameters<typeof database.changeSettings>) => database.changeSettings(...changed),
    readSettings: async () => {
      reads.count += 1;

      return options.first === true ? undefined : database.readSettings();
    },
  } as unknown as typeof database;
  const at = options.at ?? "/setup";
  const setup = createSetupConsole({
    install: { database: watched, now: opened.install.now },
    domain: options.first === true ? firstRunOf(plug) : plug,
    open: options.open ?? (async () => true),
    counters: options.counters ?? new MemoryCounters(),
    visitorOf: async () => "203.0.113.7",
    csrfSecret: CSRF_SECRET,
    asset: async (name) => (Object.hasOwn(ASSETS, name) ? ASSETS[name] : undefined),
    at: options.at,
  });
  const get = (path: string): Promise<Response> => setup.fetch(new Request(`${ORIGIN}${path}`));
  const run = (kind: string, body: unknown, type = "application/json"): Promise<Response> =>
    setup.fetch(new Request(`${ORIGIN}${at}/data/${kind}`, { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(body) }));

  return { opened, plug, reads, get, run, fetch: setup.fetch };
}

/** The start values a page carries. */
function bootOf(page: string): unknown {
  return JSON.parse(/<script type="application\/json" id="boot">(.*)<\/script>/.exec(page)?.[1] ?? "null");
}

describe("the page", () => {
  // Drift: every request would ask the database twice whether anybody has logged in.
  test.each(["/setup", "/setup/assets/app.js", "/setup/api/check"])("asks once whether it is open, for %s", async (path) => {
    const asked = { count: 0 };
    const { get } = await openSetup({
      open: async () => {
        asked.count += 1;

        return true;
      },
    });
    await get(path);

    expect(asked.count).toBe(1);
  });

  // Drift: the page would name the install's domain, a login, or a setting to somebody who has proven nothing, or a client's script would be blocked or let read another origin.
  test.each([
    [false, "login"],
    [true, "first"],
  ] as const)("carries the boxes of its form and the token's facts, and nothing of the install (nothing set: %p)", async (first, boxes) => {
    const { opened, get, reads, plug } = await openSetup({ first });
    const answer = await get("/setup");
    const page = await answer.text();

    expect([answer.status, answer.headers.get("Cache-Control"), answer.headers.get("Referrer-Policy")]).toEqual([200, "no-store", "same-origin"]);
    expect(answer.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(page).toContain("<title>Setup - poplin</title>");
    expect(page).toContain('<script type="module" src="/setup/assets/app.js"></script>');
    expect(bootOf(page)).toEqual({
      base: "/setup",
      email: "",
      title: "Setup - poplin",
      version: "",
      update: null,
      starts: false,
      demo: null,
      domain: false,
      domainNote: null,
      setup: {
        boxes,
        form: {
          tokenLabel: "Provider token",
          tokenRights: ["Records: Edit", "Routes: Edit"],
          tokenLink: "https://provider.example/tokens/new",
          tokenOptional: [{ right: "Rules: Edit", adds: "The provider stops floods first." }],
          tokenNote: "Choose what the token is for.",
        },
      },
    });
    // The install's own host, as the test opened it: the page names it nowhere.
    const host = new URL(ORIGIN).hostname;
    expect([page.includes(opened.owner), page.includes(host), reads.count, plug.calls]).toEqual([false, false, 0, []]);
  });

  // Drift: a host that mounts the screen under a path of its own would link the client's files and send its runs to the wrong place.
  test("links its files and takes its runs under the path it is given", async () => {
    const { get, run } = await openSetup({ at: "/next/setup/first" });
    const page = await (await get("/next/setup/first")).text();

    expect(page).toContain('<link rel="stylesheet" href="/next/setup/first/assets/app.css">');
    expect((await get("/next/setup/first/assets/app.js")).status).toBe(200);
    expect((await run("check", { token: TOKEN })).status).toBe(200);
  });

  // Drift: once somebody has logged in, or when the question fails, the page would still answer, and tell a stranger that an install is here.
  test.each([
    ["answers no", async (): Promise<boolean> => false],
    ["fails to say", async (): Promise<boolean> => Promise.reject(new Error("the database is away"))],
  ] as const)("is shut on every path when the question %s", async (_name, open) => {
    const { get, run, plug } = await openSetup({ open });
    const answers = [await get("/setup"), await get("/setup/assets/app.js"), await run("check", { token: TOKEN }), await run("repair", { token: TOKEN })];

    expect(await Promise.all(answers.map(async (answer) => [answer.status, await answer.text()]))).toEqual(answers.map(() => [404, "Not found."]));
    expect(plug.calls).toEqual([]);
  });

  // Drift: `poplin setup` posts to these two paths; the new page in front of them would cut the command off.
  test("leaves a program's call to the setup page's own handler, in its own shape", async () => {
    const { fetch } = await openSetup();
    const answer = await fetch(
      new Request(`${ORIGIN}/setup/api/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: FOREIGN }) }),
    );

    expect([answer.status, await answer.json()]).toEqual([403, { ok: false, refusal: "token" }]);
  });
});

describe("a run", () => {
  // Drift: a stranger's token would learn something of the install, or cost it a read.
  test("with a token of another account is refused at the token's box, reads no setting, and writes nothing", async () => {
    const { opened, run, reads } = await openSetup();
    const before = (await opened.audit()).length;
    const answer = await run("repair", { token: FOREIGN, login: "other@example.com" });
    const body = await answer.text();

    expect(answer.status).toBe(403);
    expect(JSON.parse(body)).toEqual({
      ok: false,
      code: "token",
      about: "token",
      sentence: "Token refused. Paste the whole token, made for this account and this domain.",
    });
    expect([reads.count, (await opened.audit()).length - before, body.includes(FOREIGN), body.includes("other@example.com")]).toEqual([0, 0, false, false]);
  });

  // Drift: a proven token's run would lose its rows, its count, or the line that says which logins the install expects.
  test("with the install's own token answers the rows, the count, and the logins it expects", async () => {
    const { opened, run } = await openSetup();
    const answer = await run("repair", { token: TOKEN });
    const body = await answer.text();

    expect(answer.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      ok: true,
      run: "repair",
      rows: [{ piece: "DNS record", state: "created", tone: "good", detail: "poplin.example.com" }],
      steps: [],
      summary: { line: "1 repaired", tone: "good", next: null, optional: null },
      expects: opened.owner,
    });
    expect(body).not.toContain(TOKEN);
  });

  // Drift: a refusal of a typed value would not say which box to correct, or the plug would be asked before the value is judged.
  test.each([
    [{ token: TOKEN, domain: "nodomain", login: "mira@example.com" }, 400, "bad_domain", "domain"],
    [{ token: TOKEN, domain: "example.com", login: "not an email" }, 400, "bad_login", "login"],
    [{ token: TOKEN, domain: "example.com", login: `${TOKEN}@example.com` }, 400, "bad_login", "login"],
  ])("on an install with nothing set refuses %p at its box", async (sent, status, code, about) => {
    const { run, plug, reads } = await openSetup({ first: true });
    const answer = await run("repair", sent);
    const refusal = (await answer.json()) as Refusal;

    expect([answer.status, refusal.code, refusal.about, plug.calls, reads.count]).toEqual([status, code, about, [], 0]);
  });

  // Drift: a token pasted into the email's box of a set install would be stored as its login and answered back in `expects`.
  test("refuses an email that holds the pasted token before the plug is asked, and stores nothing", async () => {
    const { opened, run, plug } = await openSetup();
    const before = JSON.stringify((await opened.install.database.readSettings())?.logins);
    const answer = await run("repair", { token: TOKEN, login: `${TOKEN.toUpperCase()}@example.com` });
    const body = await answer.text();

    expect([answer.status, (JSON.parse(body) as Refusal).code, plug.calls]).toEqual([400, "bad_login", []]);
    expect(JSON.stringify((await opened.install.database.readSettings())?.logins)).toBe(before);
    expect(body.toLowerCase()).not.toContain(TOKEN.toLowerCase());
  });

  // Drift: the first press on a new install would write to a database nobody has proven they own.
  test("on an install with nothing set makes every piece and stores nothing in the install", async () => {
    const { opened, run, reads } = await openSetup({ first: true });
    const before = (await opened.audit()).length;
    const answer = await run("repair", { token: TOKEN, domain: " Example.COM ", login: "mira@example.com" });

    expect([answer.status, ((await answer.json()) as { readonly expects: string | null }).expects]).toEqual([200, null]);
    expect([reads.count, (await opened.audit()).length - before]).toEqual([0, 0]);
  });

  // Drift: a token could be guessed without end, or the page would stay open when its guard is gone.
  test("is refused after five tries in a minute, and at once when the counter cannot answer", async () => {
    const { run, plug } = await openSetup();
    const statuses: number[] = [];
    for (let tries = 0; tries < 6; tries += 1) statuses.push((await run("check", { token: FOREIGN })).status);

    const sixth = await run("check", { token: TOKEN });
    const broken = await openSetup({ counters: { takeMinute: async () => Promise.reject(new Error("the counter is away")) } });
    const closed = await broken.run("check", { token: TOKEN });

    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
    expect([sixth.status, await sixth.json()]).toEqual([429, { ok: false, code: "too_many_tries", about: null, sentence: "Too many tries. Wait a minute." }]);
    expect([closed.status, plug.calls.length, broken.plug.calls.length]).toEqual([429, 5, 0]);
  });

  // Drift: a page of another origin could make a browser send a run, and use up the tries of the person at that address.
  test("that is not sent as JSON is refused uncounted", async () => {
    const { run, plug } = await openSetup();
    const statuses: number[] = [];
    for (let tries = 0; tries < 7; tries += 1) statuses.push((await run("check", { token: TOKEN }, "text/plain")).status);

    expect([statuses, plug.calls.length, (await run("check", { token: TOKEN })).status]).toEqual([[415, 415, 415, 415, 415, 415, 415], 0, 200]);
  });
});
