import { describe, expect, test } from "bun:test";

import { changeConfig, readConfig } from "../../src/actions/config";
import { addLogin, removeLogin } from "../../src/actions/logins";
import { issueToken } from "../../src/actions/manage-tokens";
import type { Login } from "../../src/auth/logins";
import type { Actor } from "../../src/auth/scopes";
import type { TokenId } from "../../src/auth/tokens";
import { ADMIN, makeWorld, OWNER } from "./support/actions-fixture";

const TOKEN: Actor = { scope: "admin", holder: "00000000000000cc" as TokenId };
const ADA = "ada@example.com" as Login;
const BO = "bo@example.com" as Login;
const CY = "cy@example.com" as Login;

describe("one login, added or removed", () => {
  const cases: readonly {
    readonly name: string;
    readonly by: Actor;
    readonly stored: readonly Login[];
    readonly change: typeof addLogin | typeof removeLogin;
    readonly request: unknown;
    readonly answer: unknown;
    readonly after: readonly Login[];
  }[] = [
    { name: "an admin adds an email typed with capitals and spaces", by: ADMIN, stored: [ADA], change: addLogin, request: { login: " Bo@Example.COM " }, answer: { ok: true, login: BO }, after: [ADA, BO] },
    { name: "a token adds an email", by: TOKEN, stored: [ADA], change: addLogin, request: { login: BO }, answer: { ok: true, login: BO }, after: [ADA, BO] },
    { name: "an email that is a login, typed another way, is added", by: ADMIN, stored: [ADA, BO], change: addLogin, request: { login: "BO@example.com" }, answer: { ok: false, code: "already_a_login", about: "login" }, after: [ADA, BO] },
    { name: "text that is no email is added", by: ADMIN, stored: [ADA], change: addLogin, request: { login: "bo" }, answer: { ok: false, code: "bad_argument", about: "login" }, after: [ADA] },
    { name: "a request names no email", by: ADMIN, stored: [ADA], change: addLogin, request: {}, answer: { ok: false, code: "bad_argument", about: "login" }, after: [ADA] },
    { name: "a request holds a key that is none", by: ADMIN, stored: [ADA], change: addLogin, request: { login: BO, scope: "admin" }, answer: { ok: false, code: "bad_argument", about: "scope" }, after: [ADA] },
    { name: "a publisher adds an email", by: OWNER, stored: [ADA], change: addLogin, request: { login: BO }, answer: { ok: false, code: "not_allowed" }, after: [ADA] },
    { name: "an admin removes another email", by: ADMIN, stored: [ADA, BO, CY], change: removeLogin, request: { login: "Bo@example.com" }, answer: { ok: true, login: BO }, after: [ADA, CY] },
    { name: "an admin removes their own email", by: ADMIN, stored: [ADA, BO], change: removeLogin, request: { login: ADA }, answer: { ok: false, code: "no_working_login", about: "login" }, after: [ADA, BO] },
    { name: "a token removes one of two logins", by: TOKEN, stored: [ADA, BO], change: removeLogin, request: { login: ADA }, answer: { ok: true, login: ADA }, after: [BO] },
    { name: "a token removes the last login", by: TOKEN, stored: [ADA], change: removeLogin, request: { login: ADA }, answer: { ok: false, code: "no_working_login", about: "login" }, after: [ADA] },
    { name: "an email that is no login is removed", by: ADMIN, stored: [ADA, BO], change: removeLogin, request: { login: CY }, answer: { ok: false, code: "not_a_login", about: "login" }, after: [ADA, BO] },
    { name: "text that is no email is removed", by: ADMIN, stored: [ADA], change: removeLogin, request: { login: "@" }, answer: { ok: false, code: "bad_argument", about: "login" }, after: [ADA] },
    { name: "a publisher removes an email", by: OWNER, stored: [ADA, BO], change: removeLogin, request: { login: BO }, answer: { ok: false, code: "not_allowed" }, after: [ADA, BO] },
  ];

  // Drift: the dashboard's people list is changed by these two alone; a refusal that still wrote, a typed form stored as typed, or a removal that left no login the login page lets in would lose a person or shut the dashboard.
  test.each(cases)("$name: the logins end as $after", async ({ by, stored, change, request, answer, after }) => {
    const world = await makeWorld({ logins: [...stored] });
    const changed = await change(world.install, by, request);
    const read = await readConfig(world.install, ADMIN);
    const done = after.length !== stored.length;

    expect(changed).toMatchObject(done ? { ...(answer as object), values: { logins: after } } : (answer as object));
    expect<unknown>([read.ok && read.values.logins, await world.audit()]).toEqual([after, done ? ["settings_changed"] : []]);
  });

  // Drift: a token is let in before its user is removed and asks after. Answered as done, it would put the removed user back; the answer must be the one a token with no right gets.
  test.each([
    { name: "adds the removed user", change: addLogin, request: { login: BO } },
    { name: "removes another user", change: removeLogin, request: { login: CY } },
    { name: "stores a list with the removed user", change: changeConfig, request: { logins: [ADA, BO] } },
  ])("a token whose user was removed since $name: not allowed, and the logins stay", async ({ change, request }) => {
    const world = await makeWorld({ logins: [ADA, BO, CY] });
    const issued = await issueToken(world.install, { scope: "admin", holder: BO }, { scope: "admin", note: "laptop" });
    if (!issued.ok) throw new Error("no token was issued");

    await removeLogin(world.install, ADMIN, { login: BO });
    const answer = await change(world.install, { scope: "admin", holder: issued.record.id }, request);
    const read = await readConfig(world.install, ADMIN);

    expect<unknown>([answer, read.ok && read.values.logins]).toEqual([{ ok: false, code: "not_allowed" }, [ADA, CY]]);
  });
});
