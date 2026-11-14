import { expect, test } from "bun:test";

import { beginLogin, redeemLogin } from "@poplin/core/src/actions/computer-logins";
import { mintToken } from "@poplin/core/src/auth/tokens";

import { NOW } from "../../sites/support/install";
import { landing, type Opened, openDashboard } from "../support/install";

const NOTICE = /<p class="notice (done|refused)" role="status">([^<]*)<\/p>/;
const MINUTE = 60_000;

/** A publisher's login begun from a computer named `laptop`; the test fails here when it is refused. */
async function begun(opened: Opened): Promise<{ readonly code: string; readonly secret: string }> {
  const login = await beginLogin(opened.install, { scope: "publisher", computer: "laptop" });
  if (!login.ok) throw new Error(`the fixture login was refused: ${login.code}`);

  return login;
}

async function stateOf(opened: Opened, secret: string): Promise<string> {
  const answer = await redeemLogin(opened.install, { secret });

  return answer.ok ? answer.state : answer.code;
}

/** The audit entries a test added, the newest first, as who did what. */
async function added(opened: Opened): Promise<[by: string, action: string, detail: unknown][]> {
  return (await opened.audit()).filter((entry) => entry.action !== "settings_set").map((entry) => [entry.by, entry.action, entry.detail]);
}

test("Allow with the box ticked lets the computer in: its terminal is answered a token, the page says so, and the audit log names who allowed which computer", async () => {
  const opened = await openDashboard();
  const login = await begun(opened);

  const allowed = await opened.post("/tokens/allow", { code: login.code, confirm: "yes" });
  const page = await landing(opened, allowed);
  const answer = await redeemLogin(opened.install, { secret: login.secret });

  expect([allowed.status, allowed.headers.get("Location"), NOTICE.exec(page)?.slice(1)]).toEqual([303, "/tokens?done=allowed", ["done", "Allowed. The computer collects its token within a few seconds."]]);
  expect(answer).toMatchObject({ ok: true, state: "allowed", record: { scope: "publisher", note: "laptop" } });
  expect(await added(opened)).toEqual([
    [opened.owner, "token_added", { token: expect.any(String), scope: "publisher", note: "laptop" }],
    [opened.owner, "login_allowed", { scope: "publisher", computer: "laptop" }],
  ]);
});

test("Allow without the box ticked changes nothing and goes back to the same login, which says why", async () => {
  const opened = await openDashboard();
  const login = await begun(opened);

  const refused = await opened.post("/tokens/allow", { code: login.code });
  const page = await landing(opened, refused);

  expect([refused.status, refused.headers.get("Location")]).toEqual([303, `/tokens/allow?code=${login.code}&refused=not_confirmed`]);
  expect([NOTICE.exec(page)?.slice(1), page.includes(`<p class="code" aria-label="The code">${login.code}</p>`)]).toEqual([["refused", "The box was not ticked, so nothing was changed."], true]);
  expect([await stateOf(opened, login.secret), await added(opened)]).toEqual(["pending", []]);
});

test("Deny ends the login with one audit entry and no token, and a login is decided once: neither button does anything after", async () => {
  const opened = await openDashboard();
  const login = await begun(opened);

  const denied = await opened.post("/tokens/deny", { code: login.code });
  const later = [await opened.post("/tokens/allow", { code: login.code, confirm: "yes" }), await opened.post("/tokens/deny", { code: login.code })];

  expect([denied.headers.get("Location"), NOTICE.exec(await landing(opened, denied))?.slice(1)]).toEqual(["/tokens?done=denied", ["done", "Denied. The computer was not logged in."]]);
  expect(later.map((answer) => answer.headers.get("Location"))).toEqual(["/tokens?refused=no_such_login", "/tokens?refused=no_such_login"]);
  expect([await stateOf(opened, login.secret), await added(opened), (await opened.install.database.listTokens()).length]).toEqual(["denied", [[opened.owner, "login_denied", { scope: "publisher", computer: "laptop" }]], 0]);
});

test.each([
  ["a form with no code", {}, "/tokens?refused=missing_field"],
  ["a code of no login", { code: "BBBB-BBBB", confirm: "yes" }, "/tokens?refused=no_such_login"],
  ["a code that is no code", { code: "<script>", confirm: "yes" }, "/tokens?refused=no_such_login"],
])("Allow sent %s lets nothing in", async (_what, fields, location) => {
  const opened = await openDashboard();
  const login = await begun(opened);

  const answer = await opened.post("/tokens/allow", fields);

  expect([answer.status, answer.headers.get("Location"), await stateOf(opened, login.secret), await added(opened)]).toEqual([303, location, "pending", []]);
});

test("Allow pressed after the login's ten minutes lets nothing in", async () => {
  const opened = await openDashboard();
  const login = await begun(opened);
  opened.clock.now = NOW + 10 * MINUTE;

  const late = await opened.post("/tokens/allow", { code: login.code, confirm: "yes" });

  expect([late.headers.get("Location"), await stateOf(opened, login.secret), await added(opened)]).toEqual(["/tokens?refused=no_such_login", "expired", []]);
});

test.each([
  ["without the page's token", { csrf: null }],
  ["with a forged token", { csrf: "0.0000000000000000000000000000000000000000000000000000000000000000" }],
  ["from another origin", { headers: { Origin: "https://www.example.com" } }],
  ["as a cross-site request", { headers: { "Sec-Fetch-Site": "cross-site" } }],
] as const)("Allow posted %s is refused with a 403, and the login stays pending", async (_how, options) => {
  const opened = await openDashboard();
  const login = await begun(opened);

  const refused = await opened.post("/tokens/allow", { code: login.code, confirm: "yes" }, options);

  expect([refused.status, await stateOf(opened, login.secret), await added(opened)]).toEqual([403, "pending", []]);
});

test("Revoke removes the token named and no other, with one audit entry, and a token that is not there is said to be gone", async () => {
  const opened = await openDashboard();
  const minted = await Promise.all([mintToken({ scope: "admin", note: "laptop", now: NOW }), mintToken({ scope: "publisher", note: "ci", now: NOW })]);
  for (const { record } of minted) await opened.install.database.addToken(record, { by: opened.owner, at: NOW });
  const [laptop, ci] = minted.map(({ record }) => record);
  if (laptop === undefined || ci === undefined) throw new Error("the fixture tokens were not minted");

  const revoked = await opened.post("/tokens/revoke", { token: laptop.id });
  const again = await opened.post("/tokens/revoke", { token: laptop.id });
  const malformed = await opened.post("/tokens/revoke", { token: "<script>" });
  const unnamed = await opened.post("/tokens/revoke", {});

  expect([revoked.headers.get("Location"), NOTICE.exec(await landing(opened, revoked))?.slice(1)]).toEqual(["/tokens?done=revoked", ["done", "Revoked. The token works nowhere now."]]);
  expect([again, malformed, unnamed].map((answer) => answer.headers.get("Location"))).toEqual(["/tokens?refused=no_such_token", "/tokens?refused=no_such_token", "/tokens?refused=missing_field"]);
  expect(NOTICE.exec(await landing(opened, again))?.slice(1)).toEqual(["refused", "No token has that id. It may be revoked already."]);
  expect(await opened.install.database.listTokens()).toEqual([ci]);
  expect((await added(opened)).filter(([, action]) => action === "token_revoked")).toEqual([[opened.owner, "token_revoked", { token: laptop.id, scope: "admin", note: "laptop" }]]);
});
