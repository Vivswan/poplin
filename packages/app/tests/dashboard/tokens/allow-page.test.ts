import { expect, test } from "bun:test";

import { beginLogin, decideLogin, redeemLogin } from "@poplin/core/src/actions/computer-logins";
import { parseUserCode } from "@poplin/core/src/auth/computer-logins";
import { mintToken } from "@poplin/core/src/auth/tokens";

import { NOW } from "../../sites/support/install";
import { type Opened, openDashboard } from "../support/install";

const HOSTILE = `"><script>alert(1)</script>`;
const MINUTE = 60_000;

/** A login begun from a computer of this name; the test fails here when it is refused. */
async function begun(opened: Opened, scope: "admin" | "publisher", computer: string): Promise<{ readonly code: string; readonly secret: string }> {
  const login = await beginLogin(opened.install, { scope, computer }, `visitor of ${computer}`);
  if (!login.ok) throw new Error(`the fixture login was refused: ${login.code}`);

  return login;
}

async function pageOf(opened: Opened, code: string): Promise<string> {
  return (await opened.get(`/tokens/allow?code=${encodeURIComponent(code)}`)).text();
}

test("the page shows the code large, what the login would grant, and the name the computer gave itself, with a box to tick before Allow and a Deny beside it", async () => {
  const opened = await openDashboard();
  const admin = await begun(opened, "admin", "laptop");
  const publisher = await begun(opened, "publisher", "");

  const [first, second] = [await pageOf(opened, admin.code), await pageOf(opened, publisher.code.toLowerCase().replace("-", ""))];

  expect(first).toContain("<h1>Allow this computer?</h1>");
  expect(first).toContain(`<p class="code" aria-label="The code">${admin.code}</p>`);
  expect(first).toContain("<strong>Allow only if this is the code on your computer.</strong> If someone sent you this address, the code is theirs: deny it.");
  expect(first).toContain("<dt>It asks to be</dt><dd>An admin: this computer may do everything you may.</dd>");
  expect(first).toContain("<dt>It calls itself</dt><dd>laptop</dd>");
  expect(first).toContain(`<label class="choice"><input type="checkbox" name="confirm" value="yes"> My computer shows the code ${admin.code}</label>`);
  expect(first.match(/<form method="post" action="\/tokens\/(allow|deny)">\n<input type="hidden" name="csrf" value="[^"]+">\n<input type="hidden" name="code" value="[A-Z-]+">/g)?.length).toBe(2);
  expect(second).toContain(`<p class="code" aria-label="The code">${publisher.code}</p>`);
  expect(second).toContain("<dd>A publisher: this computer may publish, and manage only the sites it published.</dd>");
  expect(second).toContain("<dt>It calls itself</dt><dd>It gave no name.</dd>");
});

test("the name a computer gave itself reaches the page escaped, and neither the secret nor its hash is on the page", async () => {
  const opened = await openDashboard();
  const login = await begun(opened, "publisher", HOSTILE);

  const page = await pageOf(opened, login.code);
  const code = parseUserCode(login.code);
  const stored = code === undefined ? undefined : await opened.install.database.findComputerLogin(code);

  expect(page).toContain("<dd>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</dd>");
  expect([page.includes("<script>"), page.includes(login.secret), page.includes(stored?.hash ?? "no hash"), page.includes(stored?.id ?? "no id")]).toEqual([false, false, false, false]);
});

test("a code of no login, of a login that was decided, and of one that ran out all show one sentence and the form to type another, and change nothing", async () => {
  const opened = await openDashboard();
  const [decided, old] = [await begun(opened, "publisher", "laptop"), await begun(opened, "publisher", "laptop")];
  await decideLogin(opened.install, { scope: "admin", holder: opened.owner }, { code: decided.code, allow: false });
  const entries = (await opened.audit()).length;
  const sentence = '<p class="notice refused" role="status">No login waits under that code. It was allowed or denied already, or its 10 minutes ran out. Run poplin login again.</p>';

  const pages = [await pageOf(opened, "BBBB-BBBB"), await pageOf(opened, ""), await pageOf(opened, HOSTILE), await pageOf(opened, decided.code)];
  opened.clock.now = NOW + 10 * MINUTE;
  pages.push(await pageOf(opened, old.code));

  for (const page of pages) {
    expect(page).toContain(sentence);
    expect(page).toContain('<form method="get" action="/tokens/allow">');
    expect([page.includes("<script>"), page.includes('action="/tokens/allow">\n<input type="hidden" name="csrf"')]).toEqual([false, false]);
  }

  expect([(await opened.audit()).length, await redeemLogin(opened.install, { secret: old.secret })]).toEqual([entries, { ok: true, state: "expired" }]);
});

test("the twenty-first code tried from one address in a minute is refused with a 429, whatever the code, and the next minute takes codes again", async () => {
  const opened = await openDashboard();
  const login = await begun(opened, "publisher", "laptop");
  const statuses: number[] = [];

  for (let tried = 0; tried < 20; tried += 1) statuses.push((await opened.get("/tokens/allow?code=BBBB-BBBB")).status);
  const refused = await opened.get(`/tokens/allow?code=${login.code}`);
  const posted = await opened.post("/tokens/allow", { code: login.code, confirm: "yes" });
  opened.clock.now = NOW + MINUTE;

  expect([new Set(statuses), refused.status, posted.status]).toEqual([new Set([200]), 429, 429]);
  expect(await refused.text()).toContain("Too many tries. Wait a minute.");
  expect([await redeemLogin(opened.install, { secret: login.secret }), (await opened.get(`/tokens/allow?code=${login.code}`)).status]).toEqual([{ ok: true, state: "pending" }, 200]);
});

test("a counter that cannot answer refuses every try at a code, as over the count: no login is shown and none is decided", async () => {
  const opened = await openDashboard();
  const login = await begun(opened, "publisher", "laptop");
  const entries = (await opened.audit()).length;
  opened.counters.takeMinute = () => Promise.reject(new Error("the counter is down"));

  const looked = await opened.get(`/tokens/allow?code=${login.code}`);
  const page = await looked.text();
  const posted = [await opened.post("/tokens/allow", { code: login.code, confirm: "yes" }), await opened.post("/tokens/deny", { code: login.code })];

  expect([looked.status, page.includes(login.code), page.includes("Too many tries. Wait a minute.")]).toEqual([429, false, true]);
  expect([posted.map((answer) => answer.status), (await opened.audit()).length, await redeemLogin(opened.install, { secret: login.secret })]).toEqual([[429, 429], entries, { ok: true, state: "pending" }]);
});

test("the page of a login holds no token, even while the install holds some", async () => {
  const opened = await openDashboard();
  const minted = await mintToken({ scope: "admin", note: "laptop", now: NOW });
  await opened.install.database.addToken(minted.record, { by: opened.owner, at: NOW });
  const login = await begun(opened, "admin", "laptop");

  const page = await pageOf(opened, login.code);

  expect([page.includes(minted.token), page.includes(minted.record.hash), /poplin_[0-9a-f]{16}_/.test(page)]).toEqual([false, false, false]);
});
