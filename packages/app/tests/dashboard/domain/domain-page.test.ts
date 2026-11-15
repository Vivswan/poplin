import { expect, test } from "bun:test";

import type { DomainReading } from "../../../src/dashboard/domain/records";
import { LOGIN, ORIGIN, openDashboard } from "../support/install";
import { fakePlug, TOKEN, usualPlug } from "./support/fake-plug";

const NOTICE = /<p class="notice (done|refused)" role="status">([^<]*)<\/p>/;
const ROW = /<tr><td>([^<]*)<\/td><td><strong class="state (\w+)">([^<]*)<\/strong><\/td><td class="wrap">([^<]*)<\/td><\/tr>/g;

/** Every byte an answer carries: its status, its headers, and its body. */
async function emitted(answer: Response): Promise<string> {
  return JSON.stringify([answer.status, [...answer.headers], await answer.text()]);
}

function rows(page: string): string[][] {
  return [...page.matchAll(ROW)].map((match) => match.slice(1));
}

test("the Domain tab opens with an empty token field, the two buttons, and the three settings as stored, each under the plug's own note; no run is made by opening it", async () => {
  const plug = usualPlug();
  const opened = await openDashboard(plug);
  await opened.post("/domain/save", { outside_pages: "allowed", search_engines_allowed: "on", block_bots: "off" });
  const answer = await opened.get("/domain");
  const page = await answer.text();

  expect(answer.status).toBe(200);
  expect(page).toContain('aria-current="page">Domain</a>');
  expect(page).toContain('<input type="password" id="token" name="token" autocomplete="off" required>');
  expect(page).toContain('<button type="submit">Check</button>');
  expect(page).toContain('<button type="submit" formaction="/domain/repair">Repair</button>');
  expect([...page.matchAll(/<option selected>([^<]*)<\/option>/g)].map((match) => match[1])).toEqual(["allowed", "on", "off"]);
  expect([...page.matchAll(/<p class="hint">(A note[^<]*)<\/p>/g)].map((match) => match[1])).toEqual([
    "A note on outside pages.",
    "A note on search engines.",
    "A note on bots.",
  ]);
  expect(rows(page)).toEqual([]);
  expect(plug.calls).toEqual([]);
});

test("a check shows every row with its state and the count to repair, hands the plug the pasted token and the stored settings, and writes one audit entry that names the missing object", async () => {
  const plug = usualPlug();
  const opened = await openDashboard(plug);
  const answer = await opened.post("/domain/check", { token: TOKEN });
  const page = await answer.text();

  expect([answer.status, answer.headers.get("Location")]).toEqual([200, null]);
  expect(NOTICE.exec(page)?.slice(1)).toEqual(["refused", "1 to repair"]);
  expect(rows(page)).toEqual([
    ["DNS record", "good", "present", "*.example.com"],
    ["DNS record", "bad", "missing", "poplin.example.com"],
    ["Worker route", "good", "present", "poplin.example.com/*"],
    ["Rate rule", "idle", "left out", "rate rule: the domain has other hostnames"],
  ]);
  expect(page).toContain('<button type="submit">Check again</button>');
  expect(plug.calls).toMatchObject([{ run: "check", token: TOKEN, settings: { outside_pages: "blocked", block_bots: "auto", logins: [opened.owner] } }]);
  expect((await opened.audit())[0]).toMatchObject({
    action: "domain_synced",
    by: opened.owner,
    site: null,
    detail: {
      run: "check",
      from: "dashboard",
      missing: ["DNS record: poplin.example.com"],
      "left-out": ["Rate rule: rate rule: the domain has other hostnames"],
    },
  });
});

test("a repair shows what it did and writes one audit entry that names what changed; a repair of an install with nothing to change says so", async () => {
  const plug = usualPlug();
  const opened = await openDashboard(plug);
  const before = (await opened.audit()).length;
  const page = await (await opened.post("/domain/repair", { token: TOKEN })).text();

  expect(NOTICE.exec(page)?.slice(1)).toEqual(["done", "1 repaired"]);
  expect(rows(page)[1]).toEqual(["DNS record", "good", "created", "poplin.example.com"]);
  expect(plug.calls.map((call) => call.run)).toEqual(["repair"]);
  expect((await opened.audit()).length).toBe(before + 1);
  expect((await opened.audit())[0]).toMatchObject({
    action: "domain_synced",
    by: opened.owner,
    detail: { run: "repair", from: "dashboard", created: ["DNS record: poplin.example.com"] },
  });

  const settled = await openDashboard(
    fakePlug(() => ({ ok: true, rows: [{ object: "DNS record", state: "present", detail: "poplin.example.com", part: "reach" }], steps: [] })),
  );

  expect(NOTICE.exec(await (await settled.post("/domain/repair", { token: TOKEN })).text())?.slice(1)).toEqual(["done", "Nothing to repair."]);
  expect((await settled.audit())[0]?.detail).toEqual({ run: "repair", from: "dashboard" });
});

// Drift: the token link carries only the rights an install needs, so a page that counted a piece behind an optional right as work left over would tell every person who followed the link that their install is broken.
test("a repair that left optional pieces not set up is a success: they are no part of the count, each is shown calm with its detail, and one line says the install works without them", async () => {
  const calm: DomainReading = {
    ok: true,
    steps: [],
    rows: [
      { object: "DNS record", state: "created", detail: "poplin.example.com", part: "reach" },
      { object: "Rate rule", state: "optional", detail: "The provider stops floods first. To switch this on, add this right to the token and press Repair: Rules: Edit", part: "rest" },
      { object: "Bot settings", state: "optional", detail: "To switch this on, add this right to the token and press Repair: Bots: Edit", part: "rest" },
    ],
  };
  const opened = await openDashboard(fakePlug(() => calm));
  const repaired = await opened.post("/domain/repair", { token: TOKEN });
  const page = await repaired.text();
  const checked = await (await opened.post("/domain/check", { token: TOKEN })).text();

  expect([repaired.status, NOTICE.exec(page)?.slice(1)]).toEqual([200, ["done", "1 repaired"]]);
  expect(page).toContain('<p class="hint">2 optional, not set up. The install works without them. Each such row names the right that switches it on.</p>');
  expect(rows(page).map((row) => row.slice(0, 3))).toEqual([
    ["DNS record", "good", "created"],
    ["Rate rule", "idle", "not set up: optional"],
    ["Bot settings", "idle", "not set up: optional"],
  ]);
  expect(NOTICE.exec(checked)?.slice(1)).toEqual(["done", "Nothing to repair."]);
});

// Drift: a repair goes on past a row refused for a permission, so a notice that said the run had stopped was false beside rows made after the failed one.
test("a repair that went on past a failed row counts that row alone as not done, and claims no stop", async () => {
  const went: DomainReading = {
    ok: true,
    steps: [],
    rows: [
      { object: "Redirect rule", state: "failed", detail: "refused with status 403. Add this right to the token: Redirect: Edit", part: "rest" },
      { object: "Database", state: "created", detail: "poplin", part: "rest" },
    ],
  };
  const opened = await openDashboard(fakePlug(() => went));
  const notice = NOTICE.exec(await (await opened.post("/domain/repair", { token: TOKEN })).text())?.slice(1);

  expect(notice).toEqual(["refused", "1 not done. Each failed row says why, or what to add."]);
});

test("a repair that stopped half way counts the failed row and the ones never reached above the table, and the rows tell done from failed from never reached", async () => {
  const stopped: DomainReading = {
    ok: true,
    steps: [],
    rows: [
      { object: "DNS record", state: "created", detail: "poplin.example.com", part: "reach" },
      { object: "Worker route", state: "failed", detail: "poplin.example.com/*: refused with status 403", part: "reach" },
      { object: "Access application", state: "not-run", detail: "", part: "login" },
    ],
  };
  const opened = await openDashboard(fakePlug(() => stopped));
  const page = await (await opened.post("/domain/repair", { token: TOKEN })).text();

  expect(NOTICE.exec(page)?.slice(1)).toEqual(["refused", "2 not done. Each failed row says why, or what to add."]);
  expect(rows(page).map((row) => row.slice(0, 3))).toEqual([
    ["DNS record", "good", "created"],
    ["Worker route", "bad", "failed"],
    ["Access application", "idle", "not run"],
  ]);
  expect((await opened.audit())[0]?.detail).toMatchObject({
    created: ["DNS record: poplin.example.com"],
    failed: ["Worker route: poplin.example.com/*: refused with status 403"],
  });
});

test("a refused token and a provider that did not answer show one line each, no table, and write no audit entry", async () => {
  const cases = [
    ["token", 403, "Token refused."],
    ["unreachable", 502, "No answer from the provider. Try again."],
  ] as const;

  for (const [refusal, status, sentence] of cases) {
    const opened = await openDashboard(fakePlug(() => ({ ok: false, refusal })));
    const before = await opened.audit();
    const answer = await opened.post("/domain/repair", { token: TOKEN });
    const page = await answer.text();

    expect([answer.status, NOTICE.exec(page)?.[2], rows(page)]).toEqual([status, sentence, []]);
    expect(await opened.audit()).toEqual(before);
  }
});

test("the pasted token is in no answer, header, or audit entry, even when the plug hands it back in every text or throws it", async () => {
  const echoing = fakePlug((_run, token) => ({
    ok: true,
    rows: [{ object: `object ${token}`, state: "failed", detail: `refused for Bearer ${token}`, part: "rest" }],
    steps: [{ text: `open with ${token}`, address: `https://dash.example.com/?key=${token}` }],
  }));
  const throwing = fakePlug((_run, token) => {
    throw new Error(`the request with ${token} failed`);
  });

  for (const [plug, status] of [
    [echoing, 200],
    [throwing, 500],
    [usualPlug(), 200],
    [fakePlug(() => ({ ok: false, refusal: "token" })), 403],
  ] as const) {
    const opened = await openDashboard(plug);

    for (const run of ["check", "repair"]) {
      const answer = await opened.post(`/domain/${run}`, { token: TOKEN });

      expect(answer.status).toBe(status);
      expect(await emitted(answer)).not.toContain(TOKEN);
    }

    expect(JSON.stringify(await opened.audit())).not.toContain(TOKEN);
    expect(await emitted(await opened.get("/domain"))).not.toContain(TOKEN);
    expect(await emitted(await opened.get("/activity"))).not.toContain(TOKEN);
  }

  expect(echoing.calls.map((call) => call.token)).toEqual([TOKEN, TOKEN]);
});

test("neither run reaches the plug without an admin session, without the form's token, or from another origin, and nothing is written", async () => {
  const plug = usualPlug();
  const opened = await openDashboard(plug);
  const before = await opened.audit();
  const body = new URLSearchParams({ token: TOKEN, csrf: await opened.token() }).toString();
  const form = { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" };

  for (const run of ["check", "repair"]) {
    const stranger = await opened.fetch(new Request(`${ORIGIN}/domain/${run}`, { method: "POST", headers: form, body }));
    const unsigned = await opened.post(`/domain/${run}`, { token: TOKEN }, { csrf: null });
    const forged = await opened.post(`/domain/${run}`, { token: TOKEN }, { csrf: `${Date.now()}.${"0".repeat(64)}` });
    const elsewhere = await opened.post(`/domain/${run}`, { token: TOKEN }, { headers: { Origin: "https://evil.example.net" } });

    expect([stranger.status, stranger.headers.get("Location")]).toEqual([303, `${LOGIN}${encodeURIComponent("/")}`]);
    expect([unsigned.status, forged.status, elsewhere.status]).toEqual([403, 403, 403]);

    for (const answer of [stranger, unsigned, forged, elsewhere]) expect(await emitted(answer)).not.toContain(TOKEN);
  }

  expect(plug.calls).toEqual([]);
  expect(await opened.audit()).toEqual(before);
});
