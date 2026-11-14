import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createDashboard } from "../../../app/src/dashboard/dashboard";
import { MemoryCounters } from "../../../app/src/limits/memory-counters";
import { NOW, ORIGIN } from "../../../app/tests/api/support/install";
import { FREE_LIMITS } from "../../../app/tests/dashboard/support/install";
import { ADDRESSES } from "../../../app/tests/sites/support/layout";
import type { Login as Email } from "../../../core/src/auth/logins";
import { type Bench, cleanUp, jsonOf, openBench, type Ran } from "./support/harness";

/** The admin who sits at the dashboard. */
const ADA = "ada@example.com" as Email;

/** The cookie the test dashboard takes for Ada's session. */
const SESSION = "session=ada";

/** The form of a login's secret and of a token, wherever one sits in a text. */
const CREDENTIAL = /poplin_login_[0-9a-f]{16}_[0-9a-f]{64}|poplin_[0-9a-f]{16}_[0-9a-f]{64}/g;

/** The code a terminal shows, as the address and the page write it. */
const CODE = /[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}/;

/** How one form post differs from the one a dashboard page sends. */
interface PostOptions {
  /** Whether the post carries the page's token; it does unless said. */
  readonly csrf?: boolean;

  /** Whether the post carries the admin's session; it does unless said. */
  readonly session?: boolean;
}

/** A command bench with the install's dashboard beside it, and everything either one let out. */
interface Desk {
  /** The command bench, whose install the dashboard is built over. */
  readonly bench: Bench;

  /** Every page the dashboard answered, as text. */
  readonly pages: string[];

  /** Every secret and token the API answered with. */
  readonly credentials: Set<string>;

  /** Open a dashboard page, with the admin's session unless said. */
  readonly get: (path: string, session?: boolean) => Promise<Response>;

  /** Post a form as a dashboard page would, token included. */
  readonly post: (path: string, fields: Readonly<Record<string, string>>, options?: PostOptions) => Promise<Response>;

  /** Run `poplin login`, and at its first wait do what the person at the dashboard does with the address it printed. */
  readonly login: (line: string, atDashboard?: (address: string, ran: Ran) => Promise<"interrupted" | undefined>) => Promise<Ran>;

  /** The audit entries written after the install was opened, the newest first, as who did what. */
  readonly audit: () => Promise<unknown[]>;

  /** The saved login, `undefined` when the machine holds none. */
  readonly saved: () => { server: string; token: string } | undefined;
}

async function openDesk(): Promise<Desk> {
  const bench = await openBench();
  const { database, store, clock, api } = bench.install;
  const pages: string[] = [];
  const credentials = new Set<string>();

  const dashboard = createDashboard({
    install: { database, store, now: () => clock.now, addressOf: ADDRESSES.addressOf, publicAddressOf: ADDRESSES.publicAddressOf, reservedNames: ADDRESSES.reservedNames },
    readSession: async (headers) => (headers.get("Cookie") === SESSION ? { ok: true, value: ADA } : { ok: false }),
    loginPath: "/login",
    csrfSecret: new Uint8Array(32).fill(9),
    freeLimits: FREE_LIMITS,
    counters: new MemoryCounters(),
    visitorOf: async () => "the-admin",
  });

  // The API answers through here, so what it hands out is known to the test and to nothing else.
  bench.hook = async (request) => {
    const answer = await api.fetch(request);
    for (const [credential] of (await answer.clone().text()).matchAll(CREDENTIAL)) credentials.add(credential);

    return answer;
  };

  const get: Desk["get"] = async (path, session = true) => {
    const answer = await dashboard.fetch(new Request(new URL(path, ORIGIN), { headers: session ? { Cookie: SESSION } : {} }));
    pages.push(await answer.clone().text());

    return answer;
  };

  const post: Desk["post"] = async (path, fields, options = {}) => {
    const [, csrf = ""] = /name="csrf" value="([^"]+)"/.exec(await (await get("/tokens")).text()) ?? [];
    const body = new URLSearchParams(options.csrf === false ? fields : { ...fields, csrf });
    const headers = { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded", ...(options.session === false ? {} : { Cookie: SESSION }) };
    const answer = await dashboard.fetch(new Request(new URL(path, ORIGIN), { method: "POST", headers, body: body.toString() }));
    pages.push(await answer.clone().text());

    return answer;
  };

  const login: Desk["login"] = (line, atDashboard) => {
    let visited = false;
    bench.paused = async (ran) => {
      if (visited || atDashboard === undefined) return undefined;

      visited = true;
      const address = ran.out.map((printed) => printed.trim()).find((printed) => printed.startsWith(ORIGIN)) ?? (JSON.parse(ran.out[0] ?? "{}").verify_url as string);

      return atDashboard(address, ran);
    };

    return bench.run(line, { env: {} });
  };

  const file = join(bench.home, "config", "login.json");

  return {
    bench,
    pages,
    credentials,
    get,
    post,
    login,
    audit: async () => (await database.listAudit({ limit: 100 })).filter((entry) => entry.at > NOW).map((entry) => [entry.by, entry.action, entry.detail]),
    saved: () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined),
  };
}

/** The code in an address the terminal printed. */
function codeIn(address: string): string {
  return new URL(address).searchParams.get("code") ?? "";
}

/** Allow the login at an address as a person does: open the page, tick the box, press Allow. */
async function allow(desk: Desk, address: string): Promise<undefined> {
  await desk.get(address);
  await desk.post("/tokens/allow", { code: codeIn(address), confirm: "yes" });
}

afterEach(cleanUp);

describe("logIn", () => {
  // Drift: the login is the first thing every person and every agent does; any step that drifted between the terminal, the API, and the dashboard would leave no way to a token but by hand.
  test("a login the admin allows saves a token that works, prints the address and the code first, and tells the audit log who allowed which computer", async () => {
    const desk = await openDesk();
    let page = "";

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address) => {
      page = await (await desk.get(address)).text();
      await desk.post("/tokens/allow", { code: codeIn(address), confirm: "yes" });

      return undefined;
    });

    const saved = desk.saved();
    const code = CODE.exec(ran.out.join("\n"))?.[0] ?? "";
    const who = await desk.bench.install.call("whoami", undefined, { token: saved?.token });

    expect([ran.code, ran.err, ran.out.slice(0, 5)]).toEqual([
      0,
      [],
      ["open this address, and allow this computer there:", `  ${ORIGIN}/tokens/allow?code=${code}`, "allow it only if the page shows this code:", `  ${code}`, "the code works for 10 minutes"],
    ]);
    expect(ran.out.slice(5).map((line) => line.split(/ {2,}/)[0])).toEqual(["logged in: the token is saved on this machine", "install", "role", "token", "expires"]);
    expect([ran.opened, ran.waits, desk.bench.sent]).toEqual([[`${ORIGIN}/tokens/allow?code=${code}`], [5000], ["POST /api/logins", "POST /api/logins/token"]]);
    expect([page.includes(`<p class="code" aria-label="The code">${code}</p>`), page.includes("An admin: this computer may do everything you may."), page.includes("<dd>test-computer</dd>")]).toEqual([true, true, true]);
    expect([saved?.server, who.status, who.body.token]).toMatchObject([ORIGIN, 200, { scope: "admin", note: "test-computer" }]);
    expect(await desk.audit()).toEqual([
      [ADA, "token_added", { token: (who.body.token as { id: string }).id, scope: "admin", note: "test-computer" }],
      [ADA, "login_allowed", { scope: "admin", computer: "test-computer" }],
    ]);
  });

  // Drift: the secret and the token are the two things that must reach the terminal alone; one echoed into a page, an audit row, a line of output, or a reported error would be read by whoever reads those.
  test("neither the secret nor the token is in any page, audit entry, printed line, or reported failure, and the token is stored as its hash alone", async () => {
    const desk = await openDesk();

    const ran = await desk.login(`login --server ${ORIGIN} --name laptop`, (address) => allow(desk, address));
    await desk.get("/tokens");
    await desk.get("/activity");
    const everything = [...desk.pages, JSON.stringify(await desk.bench.install.database.listAudit({ limit: 100 })), ...ran.out, ...ran.err, ...ran.status, JSON.stringify(desk.bench.install.reported)].join("\n");
    const stored = JSON.stringify(await desk.bench.install.database.listTokens());

    expect([ran.code, desk.credentials.size, [...desk.credentials].includes(desk.saved()?.token ?? "")]).toEqual([0, 2, true]);
    expect([...desk.credentials].filter((credential) => everything.includes(credential) || stored.includes(credential))).toEqual([]);
    expect(everything.match(CREDENTIAL)).toBeNull();
    expect(desk.pages.some((page) => page.includes("laptop"))).toBe(true);
  });

  // Drift: a denied, unanswered, or stopped login must leave the machine as it was; a file written early would hold a token that never came, or drop the login that was there.
  test.each([
    ["denied on the dashboard", "the login was denied on the dashboard", [[ADA, "login_denied", { scope: "admin", computer: "test-computer" }]]],
    ["answered by nobody for ten minutes", "nobody allowed the login before it ran out", []],
    ["stopped by the person", "the login was stopped", []],
  ] as const)("a login %s exits 1, saves nothing, and makes no token", async (how, sentence, audit) => {
    const desk = await openDesk();

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address) => {
      if (how.startsWith("denied")) await desk.post("/tokens/deny", { code: codeIn(address) });

      return how.startsWith("stopped") ? "interrupted" : undefined;
    });

    expect([ran.code, ran.err[0], desk.saved(), (await desk.bench.install.database.listTokens()).length]).toEqual([1, sentence, undefined, 3]);
    expect(await desk.audit()).toEqual(audit.map((entry) => [...entry]));
    expect(ran.waits.length).toBe(how.startsWith("answered") ? 120 : 1);
  });

  // Drift: a link an attacker sent the admin, or a page of another origin posting for them, must not let a computer in; each row is one way to press Allow that is not the admin choosing to.
  test.each([
    ["with no session", { session: false }, { confirm: "yes" }, 303, `${ORIGIN}/login?return=%2F`],
    ["without the page's token", { csrf: false }, { confirm: "yes" }, 403, null],
    ["without the box ticked", {}, {}, 303, "not_confirmed"],
  ] as const)("an Allow pressed %s lets no computer in: the login stays pending and runs out", async (_how, options, fields, status, location) => {
    const desk = await openDesk();
    let answered: Response | undefined;

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address) => {
      answered = await desk.post("/tokens/allow", { code: codeIn(address), ...fields }, options);

      return undefined;
    });
    const went = answered?.headers.get("Location") ?? null;

    expect([answered?.status, location === null ? went : went?.includes(location)]).toEqual([status, location === null ? null : true]);
    expect([ran.code, ran.err[0], desk.saved(), await desk.audit(), (await desk.bench.install.database.listTokens()).length]).toEqual([1, "nobody allowed the login before it ran out", undefined, [], 3]);
  });

  // Drift: an agent's shell holds a publisher token so it can touch its own sites alone; a login that ignored the flag would hand every agent the whole install.
  test("--publisher saves a publisher's token, which the page said it would be, and --no-browser opens none", async () => {
    const desk = await openDesk();
    let page = "";

    const ran = await desk.login(`login --server ${ORIGIN} --publisher --no-browser`, async (address) => {
      page = await (await desk.get(address)).text();

      return allow(desk, address);
    });
    const token = desk.saved()?.token;

    expect([ran.code, ran.opened, page.includes("A publisher: this computer may publish, and manage only the sites it published.")]).toEqual([0, [], true]);
    expect((await desk.bench.install.call("whoami", undefined, { token })).body.token).toMatchObject({ scope: "publisher", expires: "never" });
    expect((await desk.bench.install.call("listTokens", undefined, { token })).status).toBe(403);
  });

  // Drift: an agent relays the address to its user from the first line while the command still waits; a line that came late, or that was not JSON, would leave the user with nothing to open.
  test("--json prints the address and the code as one line before it waits, and who was logged in as a second, with no token in either", async () => {
    const desk = await openDesk();
    let first: unknown;

    const ran = await desk.login(`login --server ${ORIGIN} --json`, async (address, soFar) => {
      first = jsonOf(soFar);

      return allow(desk, address);
    });
    const [announced = "", result = ""] = ran.out;

    expect([ran.code, ran.out.length, JSON.parse(announced)]).toEqual([0, 2, first]);
    expect(first).toEqual({ verify_url: expect.stringMatching(new RegExp(`^${ORIGIN}/tokens/allow\\?code=${CODE.source}$`)), code: expect.stringMatching(CODE), expires_in: 600 });
    expect(JSON.parse(result)).toMatchObject({ server: ORIGIN, token: { scope: "admin", note: "test-computer" } });
    expect(ran.out.join("\n").match(CREDENTIAL)).toBeNull();
  });

  // Drift: a terminal told to slow down that kept its pace would be refused for the rest of its ten minutes; one that gave up would fail a login the admin was about to allow.
  test("a terminal told to slow down waits five seconds longer, and still collects its token", async () => {
    const desk = await openDesk();
    const { api } = desk.bench.install;
    let secret = "";
    const inner = desk.bench.hook;
    desk.bench.hook = async (request) => {
      const sent = request.method === "POST" && new URL(request.url).pathname === "/api/logins/token" ? ((await request.clone().json()) as { secret: string }) : undefined;
      // Another question under the same secret arrives just ahead of the terminal's first, as a second copy of the command would send.
      if (sent !== undefined && secret === "") {
        secret = sent.secret;
        await api.fetch(request.clone());
      }

      return inner?.(request);
    };

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address, soFar) => {
      desk.bench.paused = async () => {
        if (soFar.waits.length === 2) await allow(desk, address);

        return undefined;
      };

      return undefined;
    });

    expect([ran.code, ran.waits, desk.bench.sent.length]).toEqual([0, [5000, 10_000], 3]);
  });

  // Drift: the browser goes where the install says; an install, or whatever answers in its place, that named another site would send the admin there with the dashboard's trust.
  test("an answer whose address is not on the install that was asked opens nothing and waits for nothing", async () => {
    const desk = await openDesk();
    desk.bench.hook = async () => Response.json({ code: "WDJB-MJHT", secret: "s", verify_url: "https://elsewhere.example.com/tokens/allow?code=WDJB-MJHT", expires_in: 600, interval: 5 });

    const ran = await desk.bench.run(`login --server ${ORIGIN}`, { env: {} });

    expect([ran.code, ran.err[0], ran.out, ran.opened, ran.waits, desk.saved()]).toEqual([5, "the install answered in a form this poplin does not know: the address to open is not the install's", [], [], [], undefined]);
  });

  // Drift: a login is saved in the file, and a shell that sets either variable does not read the file; a login that took its install from the variable, or said nothing, would save a token the next command refuses to use.
  test("the environment names no install to log in to, and a login made in a shell that sets a variable says which to unset", async () => {
    const desk = await openDesk();
    const env = { POPLIN_SERVER: ORIGIN };
    desk.bench.paused = async (ran) => allow(desk, ran.out.map((line) => line.trim()).find((line) => line.startsWith(ORIGIN)) ?? "");

    const unnamed = await desk.bench.run("login", { env });
    const named = await desk.bench.run(`login --server ${ORIGIN}`, { env });

    expect([unnamed.code, unnamed.err[0], unnamed.waits]).toEqual([3, "login needs the address of the install", []]);
    expect([named.code, named.err, desk.saved()?.server]).toEqual([0, ["POPLIN_SERVER is set in this shell: unset it to use the saved login"], ORIGIN]);
  });

  // Drift: a second login is how a token is renewed; one that needed the address again, or that lost the saved login when it was denied, would lock a person out of an install they were in.
  test("with a login saved, login asks the same install again, and a denied one leaves the saved login as it was", async () => {
    const desk = await openDesk();
    await desk.login(`login --server ${ORIGIN}`, (address) => allow(desk, address));
    const before = desk.saved();

    const denied = await desk.login("login", async (address) => {
      await desk.post("/tokens/deny", { code: codeIn(address) });

      return undefined;
    });
    const kept = desk.saved();
    const again = await desk.login("login", (address) => allow(desk, address));

    expect([denied.code, kept, again.code, desk.saved()?.server]).toEqual([1, before, 0, ORIGIN]);
    expect([before?.token === undefined, desk.saved()?.token === before?.token]).toEqual([false, false]);
  });

  // Drift: the first Ctrl-C no longer ends the process by itself; a login that heard a stop during a wait alone would sit out a call that never answers before it ended.
  test("a login the person stops while a call is on its way ends as stopped, with nothing saved", async () => {
    const desk = await openDesk();
    desk.bench.hook = () => {
      setTimeout(desk.bench.stop, 5);

      return new Promise<Response>(() => undefined);
    };

    const stopped = await desk.bench.run(`login --server ${ORIGIN}`, { env: {} });

    expect([stopped.code, stopped.out, stopped.err, desk.saved()]).toEqual([1, [], ["the command was stopped"], undefined]);
  });
});
