// The Access screen's data: what the waiting logins, the people, and the tokens answer, what each change refuses, and that the end of a login's code is in no answer and is tried a counted number of times.

import { describe, expect, test } from "bun:test";
import { listAudit } from "@poplin/core/src/actions/audit-log";
import { beginLogin } from "@poplin/core/src/actions/computer-logins";
import { mintComputerLogin, parseLoginSecret, showUserCode, type UserCode } from "@poplin/core/src/auth/computer-logins";
import { issueToken } from "@poplin/core/src/actions/manage-tokens";

import { openConsole } from "./support/console";
import { ORIGIN } from "./support/install";

/** What a browser sends with a request made by a page of a site of the same install: the site's origin, and that it is another origin of the same site. */
const SIBLING_PAGE = { Origin: "https://docs--k3v9x2q7m4t8-u-poplin.example.com", "Sec-Fetch-Site": "same-site", "Content-Type": "application/x-www-form-urlencoded" };

/** The code of a planted login, and four letters that are not its last: a code drawn by chance would, once in many runs, end in the letters a test calls wrong, or stand in a page by chance. */
const PLANTED = { code: "WDJBQXZK" as UserCode, wrong: "BBBB" } as const;

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/** A console the tests ask. */
type Opened = Awaited<ReturnType<typeof openConsole>>;

/** What a route answers, read loosely: each test names the keys it holds. */
type Answer = Readonly<Record<string, unknown>>;

/** A login begun: its id, and the code its terminal alone shows. */
interface Begun {
  readonly id: string;
  readonly code: string;
}

/** Begin a login as one visitor, a moment after the one before. */
async function begin(opened: Opened, computer: string, scope: "publisher" | "admin" = "publisher", visitor = "a-visitor"): Promise<Begun> {
  opened.base.clock.now += 1000;
  const begun = await beginLogin(opened.base.install, { scope, computer }, visitor);
  if (!begun.ok) throw new Error("the login was not begun");

  return { id: parseLoginSecret(begun.secret) ?? "", code: begun.code };
}

/** Put a waiting login of a known code into the install, as `beginLogin` stores one. */
async function plant(opened: Opened, computer: string, scope: "publisher" | "admin" = "publisher"): Promise<Begun> {
  opened.base.clock.now += 1000;
  const { login } = await mintComputerLogin({ scope, computer, visitor: "a-visitor", now: opened.base.clock.now });
  await opened.base.install.database.addComputerLogin({ ...login, code: PLANTED.code }, { perVisitor: 3, all: 50 });

  return { id: login.id, code: showUserCode(PLANTED.code) };
}

async function read(response: Response): Promise<Answer> {
  return (await response.json()) as Answer;
}

describe("the waiting logins", () => {
  // Drift: an eleventh login would be listed or lost without a count.
  test("are listed newest first, ten at most, the rest counted", async () => {
    const opened = await openConsole();
    for (let nth = 1; nth <= 12; nth += 1) await begin(opened, `computer-${nth}`, "publisher", `visitor-${nth}`);

    const listed = await read(await opened.get("/data/logins"));
    const logins = listed.logins as readonly Answer[];

    expect(logins.map((login) => login.computer)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((nth) => `computer-${nth}`));
    expect(listed.more).toBe(2);
    expect(logins.every((login) => Object.keys(login).sort().join() === "asked,computer,id,scope")).toBe(true);
  });

  // Drift: the review would be sent a part of the code, or a login that was decided would still open.
  test("open for review by their id with no part of the code, and a decided one is said to be gone", async () => {
    const opened = await openConsole();
    const { id } = await begin(opened, "studio-laptop");
    const shown = await read(await opened.get(`/data/logins/${id}`));
    await opened.change("/data/logins/decide", { login: id, allow: false });
    const after = await opened.get(`/data/logins/${id}`);

    expect(shown.login).toEqual({ id, computer: "studio-laptop", scope: "publisher", asked: expect.any(Number), expires: expect.any(Number) });
    expect([after.status, (await read(after)).code]).toEqual([400, "no_such_login"]);
  });

  // Drift: a route that took a code would be back, and an address that holds a code would again lead to the login it names: whoever is sent it would need no terminal.
  test.each([
    ["the path that looked a login up by its code", (code: string) => `/data/logins/find?code=${code}`],
    ["the code where an id goes", (code: string) => `/data/logins/${code}`],
    ["the code's letters where an id goes", (code: string) => `/data/logins/${code.replace("-", "")}`],
  ])("%s answers no login", async (_case, path) => {
    const opened = await openConsole();
    const { code } = await begin(opened, "studio-laptop");
    const found = await opened.get(path(code));
    const body = await read(found);

    expect([found.status, body.code, Object.keys(body).sort()]).toEqual([400, "no_such_login", ["about", "code", "ok", "sentence"]]);
  });

  // Drift: the letters a person types to allow a login would be in something the page is sent, so a page could show them, and a person who was sent the address could copy them.
  test("no answer about a waiting login holds either half of its code: the list, the review, each page, each refusal, and the decision", async () => {
    const opened = await openConsole();
    const { id, code } = await plant(opened, "studio-laptop", "admin");
    const { wrong } = PLANTED;
    const answers = [
      await opened.get("/data/logins"),
      await opened.get(`/data/logins/${id}`),
      await opened.get("/tokens/list"),
      await opened.get(`/tokens/review/${id}`),
      await opened.change("/data/logins/decide", { login: id, allow: true, scope: "admin", letters: wrong }),
      await opened.change("/data/logins/decide", { login: id, allow: true, scope: "admin", letters: "" }),
      await opened.change("/data/logins/decide", { login: id, allow: true, letters: wrong }),
      await opened.change("/data/logins/decide", { login: id, allow: true, scope: "admin", letters: code.slice(-4) }),
      await opened.get("/data/tokens"),
    ];
    const texts = await Promise.all(answers.map(async (answer) => `${answer.headers.get("Location") ?? ""}\n${await answer.text()}`));

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 400, 400, 400, 200, 200]);
    expect(texts.map((text) => [code.slice(0, 4), code.slice(-4)].some((half) => text.toUpperCase().includes(half)))).toEqual(answers.map(() => false));
  });
});

describe("a decision", () => {
  // Drift: a computer would be let in without the letters of its terminal, with more than it asked, or with what it asked because the caller named no scope; or a lowered scope would not reach the token.
  test.each([
    ["allowed with the letters", "publisher", { allow: true, scope: "publisher" }, "last", { ok: true, allowed: true, scope: "publisher" }, 0],
    ["allowed for less than it asked", "admin", { allow: true, scope: "publisher" }, "last", { ok: true, allowed: true, scope: "publisher" }, 0],
    ["allowed for all it asked, by name", "admin", { allow: true, scope: "admin" }, "last", { ok: true, allowed: true, scope: "admin" }, 0],
    ["allowed with no scope named, when it asked for everything", "admin", { allow: true }, "last", { ok: false, code: "bad_argument", about: "scope" }, 1],
    ["allowed with no scope named, when it asked to publish", "publisher", { allow: true }, "last", { ok: false, code: "bad_argument", about: "scope" }, 1],
    ["allowed with no letters sent", "publisher", { allow: true, scope: "publisher" }, "none", { ok: false, code: "bad_argument", about: "letters" }, 1],
    ["allowed with other letters", "publisher", { allow: true, scope: "publisher" }, "wrong", { ok: false, code: "not_confirmed", about: "letters", sentence: "Those are not the last letters of this login's code." }, 1],
    ["allowed with the word a page could send in their place", "publisher", { allow: true, scope: "publisher", confirm: true }, "none", { ok: false, code: "bad_argument", about: "letters" }, 1],
    ["allowed for more than it asked", "publisher", { allow: true, scope: "admin" }, "last", { ok: false, code: "bad_argument", about: "scope" }, 1],
    ["denied, which needs no letters", "publisher", { allow: false }, "none", { ok: true, allowed: false }, 0],
  ] as const)("%s", async (_case, asked, decision, typed, answer, waiting) => {
    const opened = await openConsole();
    const { id, code } = await plant(opened, "studio-laptop", asked);
    const letters = { last: { letters: code.slice(-4) }, wrong: { letters: PLANTED.wrong }, none: {} }[typed];
    const decided = await read(await opened.change("/data/logins/decide", { login: id, ...decision, ...letters }));
    const listed = await read(await opened.get("/data/logins"));

    expect(decided).toMatchObject(answer);
    expect(listed.logins).toHaveLength(waiting);
  });

  // Drift: the letters could be guessed without end, or a request that is no decision would spend the tries of the person whose session it rides on.
  test("is refused after twenty tries in a minute, which a request that is no decision does not spend, and listing is not", async () => {
    const opened = await openConsole();
    const { id } = await plant(opened, "studio-laptop");
    const attempt = (): Promise<Response> => opened.change("/data/logins/decide", { login: id, allow: true, scope: "publisher", letters: PLANTED.wrong });
    for (let nth = 0; nth < 30; nth += 1) await opened.change("/data/logins/decide", { login: id, allow: true });
    // A page of a site of the same install rides on the person's session: what it can send is no decision, and spends nothing.
    const forged: number[] = [];
    for (let nth = 0; nth < 30; nth += 1) forged.push((await opened.change("/data/logins/decide", `login=${id}&allow=true&scope=admin&letters=BBBB`, SIBLING_PAGE)).status);
    for (let nth = 0; nth < 30; nth += 1) forged.push((await opened.fetch(new Request(`${ORIGIN}/data/logins/find?code=BBBB-BBBB`, { headers: { Cookie: opened.base.cookie, ...SIBLING_PAGE } }))).status);
    const statuses: number[] = [];
    for (let nth = 0; nth < 21; nth += 1) statuses.push((await attempt()).status);
    const last = await attempt();

    expect([...new Set(forged.slice(0, 30)), ...new Set(forged.slice(30))]).toEqual([403, 400]);
    expect([...new Set(statuses.slice(0, 20)), statuses[20]]).toEqual([400, 429]);
    expect((await read(last)).sentence).toBe("Too many tries. Wait a minute.");
    expect((await opened.get("/data/logins")).status).toBe(200);
  });
});

describe("the people", () => {
  // Drift: a text that is no email, or one already listed in other capitals, would be stored, and the login page would hold a login nobody can use or the same one twice.
  test.each([
    ["an email", "Jonas@Example.com", { ok: true, login: "jonas@example.com" }, 2],
    ["a text that is no email", "jonas at example", { ok: false, code: "bad_argument", about: "login", sentence: "Type an email address, such as name@example.com." }, 1],
    ["nothing", "", { ok: false, code: "bad_argument", about: "login", sentence: "Type an email address, such as name@example.com." }, 1],
  ])("adding %s", async (_case, login, answer, count) => {
    const opened = await openConsole();
    const added = await read(await opened.change("/data/people/add", { login }));
    const people = await read(await opened.get("/data/people"));

    expect(added).toMatchObject(answer);
    expect(people.logins).toHaveLength(count);
    expect(people.you).toBe(opened.base.owner);
  });

  // Drift: a refusal of the people would reach the field as the general sentence, which tells nobody what to correct; or the last working login could be taken out and nobody could log in.
  test("a change that changes nothing is refused with its own sentence, and the one who asks stays", async () => {
    const opened = await openConsole();
    const again = await read(await opened.change("/data/people/add", { login: opened.base.owner.toUpperCase() }));
    const absent = await read(await opened.change("/data/people/remove", { login: "nobody@example.com" }));
    const own = await read(await opened.change("/data/people/remove", { login: opened.base.owner }));

    expect([again, absent, own]).toMatchObject([
      { ok: false, code: "already_a_login", about: "login", sentence: "That email can log in already." },
      { ok: false, code: "not_a_login", about: "login", sentence: "That email is not in the list. It may have been removed already." },
      { ok: false, code: "no_working_login", sentence: "Your own email has to stay in the logins, so nothing was changed. Another admin can take it out." },
    ]);
    expect((await read(await opened.get("/data/people"))).logins).toEqual([opened.base.owner]);
  });

  // Drift: the console would answer a refusal under another status than the API answers the same code with, so one refusal would read as a bad request here and as a conflict there.
  test.each([
    ["add", "owner", 409, "already_a_login"],
    ["remove", "nobody@example.com", 404, "not_a_login"],
    ["remove", "owner", 409, "no_working_login"],
  ])("a refused %s of %s goes out with the status the API gives its code", async (change, who, status, code) => {
    const opened = await openConsole();
    const response = await opened.change(`/data/people/${change}`, { login: who === "owner" ? opened.base.owner : who });

    expect([response.status, (await read(response)).code]).toEqual([status, code]);
  });

  // Drift: a person added or taken out would leave no trace in the log, or a refused change would leave one.
  test("each person added or taken out is one entry of the audit log, and a refused change is none", async () => {
    const opened = await openConsole();
    const entries = async (): Promise<number> => {
      const listed = await listAudit(opened.base.install, { scope: "admin", holder: opened.base.owner });

      return listed.ok ? listed.entries.length : -1;
    };
    const before = await entries();
    const added = await read(await opened.change("/data/people/add", { login: "jonas@example.com" }));
    await opened.change("/data/people/add", { login: "jonas@example.com" });
    const afterAdding = await entries();
    const removed = await read(await opened.change("/data/people/remove", { login: "Jonas@example.com" }));
    await opened.change("/data/people/remove", { login: "jonas@example.com" });

    expect([added, removed]).toEqual([
      { ok: true, login: "jonas@example.com" },
      { ok: true, login: "jonas@example.com" },
    ]);
    expect([afterAdding - before, (await entries()) - afterAdding]).toEqual([1, 1]);
  });
});

describe("the tokens", () => {
  // Drift: a token's value or hash would reach the screen, or the table would show another order than its heading names.
  test("are listed without any secret, in the order asked for", async () => {
    const opened = await openConsole();
    const admin = { scope: "admin", holder: opened.base.owner } as const;
    for (const note of ["report agent", "Work laptop", "atlas"]) {
      opened.base.clock.now += 1000;
      await issueToken(opened.base.install, admin, { note, scope: "publisher" });
    }

    const newest = (await read(await opened.get("/data/tokens"))).tokens as readonly Answer[];
    const named = (await read(await opened.get("/data/tokens?sort=name&dir=asc"))).tokens as readonly Answer[];
    const oldest = (await read(await opened.get("/data/tokens?sort=allowed&dir=asc"))).tokens as readonly Answer[];

    expect(newest.map((token) => token.note)).toEqual(["atlas", "Work laptop", "report agent"]);
    expect(named.map((token) => token.note)).toEqual(["atlas", "report agent", "Work laptop"]);
    expect(oldest.map((token) => token.note)).toEqual(["report agent", "Work laptop", "atlas"]);
    expect(Object.keys(newest[0] ?? {}).sort()).toEqual(["created", "expires", "id", "note", "scope"]);
  });

  // Drift: a removed token would stay listed, or removing one that is gone would say a sentence about an id, which is no word of the screen.
  test("are removed once, and one that is gone or malformed is said to be gone already", async () => {
    const opened = await openConsole();
    const issued = await issueToken(opened.base.install, { scope: "admin", holder: opened.base.owner }, { note: "report agent", scope: "publisher" });
    const id = issued.ok ? issued.record.id : "";
    const removed = await read(await opened.change(`/data/tokens/${id}/remove`, {}));
    const again = await read(await opened.change(`/data/tokens/${id}/remove`, {}));
    const malformed = await read(await opened.change("/data/tokens/not-a-token/remove", {}));

    expect(removed).toEqual({ ok: true, name: "report agent" });
    expect([again.sentence, malformed.sentence]).toEqual(["That token is gone already.", "That token is gone already."]);
    expect((await read(await opened.get("/data/tokens"))).tokens).toEqual([]);
  });

  // Drift: a removed token would vanish from the screen with who removed it, an admin token past its 30 days would stand among the working ones, or an ended token's hash would reach the screen.
  test("that ended are listed apart, the one that ended last first, each with how it ended and no secret", async () => {
    const opened = await openConsole();
    const admin = { scope: "admin", holder: opened.base.owner } as const;
    const now = opened.base.clock.now;
    const issue = async (note: string, scope: "admin" | "publisher", at: number): Promise<string> => {
      opened.base.clock.now = at;
      const issued = await issueToken(opened.base.install, admin, { note, scope });

      return issued.ok ? issued.record.id : "";
    };
    const [laptop, agent] = [await issue("old laptop", "admin", now - 31 * DAY_MS), await issue("report agent", "publisher", now - 2000), await issue("atlas", "publisher", now - 1000)];
    opened.base.clock.now = now;
    await opened.change(`/data/tokens/${agent}/remove`, {});
    const listed = await read(await opened.get("/data/tokens?sort=name&dir=asc"));

    expect([(listed.tokens as readonly Answer[]).map((token) => token.note), listed.more]).toEqual([["atlas"], false]);
    expect(listed.ended).toEqual([
      { id: agent, scope: "publisher", note: "report agent", created: now - 2000, ended: now, how: "removed", by: opened.base.owner },
      { id: laptop, scope: "admin", note: "old laptop", created: now - 31 * DAY_MS, ended: now - DAY_MS, how: "ran_out" },
    ]);
  });
});
