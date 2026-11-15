// The Access screen's data: what the waiting logins, the people, and the tokens answer, what each change refuses, and that a login's code is counted and never listed.

import { describe, expect, test } from "bun:test";
import { listAudit } from "@poplin/core/src/actions/audit-log";
import { beginLogin } from "@poplin/core/src/actions/computer-logins";
import { issueToken } from "@poplin/core/src/actions/manage-tokens";

import { openConsole } from "./support/console";

/** A console the tests ask. */
type Opened = Awaited<ReturnType<typeof openConsole>>;

/** What a route answers, read loosely: each test names the keys it holds. */
type Answer = Readonly<Record<string, unknown>>;

/** Begin a login as one visitor, a moment after the one before, and answer its code. */
async function begin(opened: Opened, computer: string, scope: "publisher" | "admin" = "publisher", visitor = "a-visitor"): Promise<string> {
  opened.base.clock.now += 1000;
  const begun = await beginLogin(opened.base.install, { scope, computer }, visitor);
  if (!begun.ok) throw new Error("the login was not begun");

  return begun.code;
}

async function read(response: Response): Promise<Answer> {
  return (await response.json()) as Answer;
}

describe("the waiting logins", () => {
  // Drift: a login's code would reach the list, where a glance over the shoulder reads it, or an eleventh login would be listed or lost without a count.
  test("are listed newest first, ten at most, the rest counted, and never with a code", async () => {
    const opened = await openConsole();
    for (let nth = 1; nth <= 12; nth += 1) await begin(opened, `computer-${nth}`, "publisher", `visitor-${nth}`);

    const listed = await read(await opened.get("/data/logins"));
    const logins = listed.logins as readonly Answer[];

    expect(logins.map((login) => login.computer)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((nth) => `computer-${nth}`));
    expect(listed.more).toBe(2);
    expect(logins.every((login) => Object.keys(login).sort().join() === "asked,computer,id,scope")).toBe(true);
  });

  // Drift: the review step would open without the code to check against the terminal, or a login that was decided would still open.
  test("open for review by their id with the code, and a decided one is said to be gone", async () => {
    const opened = await openConsole();
    const code = await begin(opened, "studio-laptop");
    const [{ id }] = (await read(await opened.get("/data/logins"))).logins as readonly [{ readonly id: string }];
    const shown = await read(await opened.get(`/data/logins/${id}`));
    await opened.change("/data/logins/decide", { code, allow: false });
    const after = await opened.get(`/data/logins/${id}`);

    expect(shown.login).toMatchObject({ id, code, computer: "studio-laptop", scope: "publisher" });
    expect([after.status, (await read(after)).code]).toEqual([400, "login_gone"]);
  });

  // Drift: a wrong code from a terminal's address would tell which logins do wait.
  test("found by a code that names none answer a refusal and nothing of the logins that wait", async () => {
    const opened = await openConsole();
    await begin(opened, "studio-laptop");
    const found = await read(await opened.get("/data/logins/find?code=WDJB-MJHT"));

    expect(Object.keys(found).sort()).toEqual(["about", "code", "ok", "sentence"]);
    expect(found.code).toBe("no_such_login");
  });
});

describe("a decision", () => {
  // Drift: a computer would be let in without the word that the codes match, or with more than it asked; or a lowered scope would not reach the token.
  test.each([
    ["allowed with the box ticked", "publisher", { allow: true, confirm: true }, { ok: true, allowed: true, scope: "publisher" }, 0],
    ["allowed for less than it asked", "admin", { allow: true, confirm: true, scope: "publisher" }, { ok: true, allowed: true, scope: "publisher" }, 0],
    ["allowed for all it asked", "admin", { allow: true, confirm: true }, { ok: true, allowed: true, scope: "admin" }, 0],
    ["allowed without the box ticked", "publisher", { allow: true }, { ok: false, code: "not_confirmed", about: "confirm" }, 1],
    ["allowed for more than it asked", "publisher", { allow: true, confirm: true, scope: "admin" }, { ok: false, code: "bad_argument", about: "scope" }, 1],
    ["denied, which needs no tick", "publisher", { allow: false }, { ok: true, allowed: false }, 0],
  ] as const)("%s", async (_case, asked, decision, answer, waiting) => {
    const opened = await openConsole();
    const code = await begin(opened, "studio-laptop", asked);
    const decided = await read(await opened.change("/data/logins/decide", { code, ...decision }));
    const listed = await read(await opened.get("/data/logins"));

    expect(decided).toMatchObject(answer);
    expect(listed.logins).toHaveLength(waiting);
  });

  // Drift: codes could be guessed without end through the new screen, or a guess here would not count against the minute the dashboard's own page counts.
  test.each([
    ["looking a code up", (opened: Opened) => opened.get("/data/logins/find?code=WDJB-MJHT")],
    ["deciding", (opened: Opened) => opened.change("/data/logins/decide", { code: "WDJB-MJHT", allow: false })],
  ])("by %s is refused after twenty tries in a minute, and listing is not", async (_case, attempt) => {
    const opened = await openConsole();
    const statuses: number[] = [];
    for (let nth = 0; nth < 21; nth += 1) statuses.push((await attempt(opened)).status);
    const last = await attempt(opened);

    expect([...new Set(statuses.slice(0, 20)), statuses[20]]).toEqual([400, 429]);
    expect((await read(last)).sentence).toBe("Too many tries. Wait a minute.");
    expect((await opened.get("/data/logins")).status).toBe(200);
  });
});

describe("the people", () => {
  // Drift: a text that is no email, or one already listed in other capitals, would be stored, and the login page would hold a login nobody can use or the same one twice.
  test.each([
    ["an email", "Jonas@Example.com", { ok: true, login: "jonas@example.com" }, 2],
    ["a text that is no email", "jonas at example", { ok: false, code: "bad_argument", about: "login", sentence: "That is not an email address. Type one, such as name@example.com." }, 1],
    ["nothing", "", { ok: false, code: "bad_argument", about: "login", sentence: "That is not an email address. Type one, such as name@example.com." }, 1],
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
});
