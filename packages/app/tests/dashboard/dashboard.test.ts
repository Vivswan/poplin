import { expect, test } from "bun:test";

import { createDashboard } from "../../src/dashboard/dashboard";
import { importCsrfKey, mintCsrfToken } from "../../src/dashboard/security/csrf";
import { CSRF_SECRET, codeCounts, LOGIN, ORIGIN, type Opened, openDashboard } from "./support/install";

const CSP = /^default-src 'none'; style-src 'nonce-([A-Za-z0-9+/=]+)'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'$/;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/** Everything a change could touch, as text: the sites, the trash, the settings, the signing key, and the audit log. */
async function stored(opened: Opened): Promise<string> {
  const { database } = opened.install;
  const state = [
    await database.listSites({ trash: false, limit: 100 }),
    await database.listSites({ trash: true, limit: 100 }),
    await database.readSettings(),
    Array.from((await database.readSigningKey()) ?? []),
    await opened.audit(),
  ];

  return JSON.stringify(state);
}

test("every page renders for an admin, under the install's title, and names its own tab as the current one", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const pages = [
    ["/", "Sites", "Sites"],
    ["/?view=trash", "Sites", "Sites"],
    [`/sites/report--${site.id}`, "report", "Sites"],
    ["/tokens", "Tokens", "Tokens"],
    ["/tokens/allow", "Log a computer in", "Tokens"],
    ["/settings", "Settings", "Settings"],
    ["/activity", "Activity", "Activity"],
    ["/usage", "Usage", "Usage"],
  ] as const;

  for (const [path, heading, tab] of pages) {
    const answer = await opened.get(path);
    const page = await answer.text();

    expect([path, answer.status, answer.headers.get("Content-Type")]).toEqual([path, 200, "text/html; charset=UTF-8"]);
    expect(page).toContain(`<title>${heading} - poplin.example.com</title>`);
    expect(page).toContain(`<h1>${heading}</h1>`);
    expect(page).toMatch(new RegExp(`aria-current="page">${tab}</a>`));
  }
});

test("without a session every request, a page that does not exist included, is answered by the way to the login alone", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const snapshot = await stored(opened);
  const requests = [
    ["GET", "/", 302, "/"],
    ["GET", "/settings?done=saved", 302, "/settings?done=saved"],
    ["GET", `/sites/report--${site.id}`, 302, `/sites/report--${site.id}`],
    ["GET", "/no/such/page", 302, "/no/such/page"],
    ["HEAD", "/usage", 302, "/usage"],
    ["POST", `/sites/report--${site.id}/delete`, 303, "/"],
    ["PUT", "/settings", 303, "/"],
  ] as const;
  const cookies = [undefined, "__Secure-poplin-session=", `${opened.cookie}x`, "theme=dark"];

  for (const [method, path, status, back] of requests) {
    for (const cookie of cookies) {
      const headers = new Headers({ Origin: ORIGIN });
      if (cookie !== undefined) headers.set("Cookie", cookie);

      const answer = await opened.fetch(new Request(`${ORIGIN}${path}`, { method, headers }));

      expect([method, path, answer.status, answer.headers.get("Location")]).toEqual([method, path, status, `${LOGIN}${encodeURIComponent(back)}`]);
      expect(await answer.text()).toBe("");
    }
  }

  expect(await stored(opened)).toBe(snapshot);
});

test("every answer carries the strict policy and the no-store, no-frame, no-sniff headers, with a referrer for its own origin alone; a page's one style element carries the policy's nonce", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const answers = [
    await opened.get("/"),
    await opened.get("/no/such/page"),
    await opened.post(`/sites/report--${site.id}/restore`, {}),
    await opened.post("/settings/save", {}, { csrf: null }),
    await opened.fetch(new Request(`${ORIGIN}/`)),
  ];

  expect(answers.map((answer) => answer.status)).toEqual([200, 404, 303, 403, 302]);

  for (const answer of answers) {
    const [, nonce] = CSP.exec(answer.headers.get("Content-Security-Policy") ?? "") ?? [];
    const page = await answer.text();

    expect(nonce).toBeString();
    expect(["Cache-Control", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"].map((name) => answer.headers.get(name))).toEqual(["no-store", "DENY", "nosniff", "same-origin"]);
    if (page !== "") expect(page.match(/<style[^>]*>/g)).toEqual([`<style nonce="${nonce}">`]);
  }
});

test("a page asks the browser for nothing: no script, no link element, no image, no import, and no address of another origin but the sites' own links", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");

  for (const path of ["/", `/sites/report--${site.id}`, "/settings", "/activity", "/usage"]) {
    const page = await (await opened.get(path)).text();
    const addresses = page.match(/https?:\/\/[^"<\s]*/g) ?? [];

    expect(page).not.toMatch(/<script|<link|<img|<iframe|<object|<embed|@import|url\(|\ssrc=|srcset=/i);
    expect(addresses.filter((address) => !address.startsWith(`https://report--${site.id}-u-poplin.example.com`))).toEqual([]);
    expect(page.match(/<form[^>]*>/g)?.every((form) => /method="post" action="\/[^/"]/.test(form)) ?? true).toBe(true);
  }
});

test("a POST that is not a same-origin form with the session's own live token is refused with a sentence and changes nothing", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const key = await importCsrfKey(CSRF_SECRET);
  const good = await opened.token();
  const [issued = "", signature = ""] = good.split(".");
  const refusals = [
    ["no token", { csrf: null }, 403],
    ["an empty token", { csrf: "" }, 403],
    ["a changed token", { csrf: `${issued}.${signature.replace(/.$/, (last) => (last === "0" ? "1" : "0"))}` }, 403],
    ["a token of another email", { csrf: await mintCsrfToken({ key, email: "other@example.com", now: opened.clock.now }) }, 403],
    ["a token under another secret", { csrf: await mintCsrfToken({ key: await importCsrfKey(new Uint8Array(32).fill(1)), email: opened.owner, now: opened.clock.now }) }, 403],
    ["a token past twelve hours", { csrf: await mintCsrfToken({ key, email: opened.owner, now: opened.clock.now - HALF_DAY_MS - 1 }) }, 403],
    ["no Origin and no mark", { headers: { Origin: null, "Sec-Fetch-Site": null } }, 403],
    ["a withheld Origin, a same-origin mark, and no token", { csrf: null, headers: { Origin: "null" } }, 403],
    ["no Origin, a same-origin mark, and an empty token", { csrf: "", headers: { Origin: null } }, 403],
    ["no Origin and a same-site mark", { headers: { Origin: null, "Sec-Fetch-Site": "same-site" } }, 403],
    ["another Origin", { headers: { Origin: "https://evil.example.com" } }, 403],
    ["a site's Origin", { headers: { Origin: `https://report--${site.id}-p-poplin.example.com` } }, 403],
    ["the Origin null and no mark", { headers: { Origin: "null", "Sec-Fetch-Site": null } }, 403],
    ["the Origin null and a same-site mark", { headers: { Origin: "null", "Sec-Fetch-Site": "same-site" } }, 403],
    ["the Origin null and a cross-site mark", { headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["a site's Origin and a same-site mark", { headers: { Origin: `https://report--${site.id}-p-poplin.example.com`, "Sec-Fetch-Site": "same-site" } }, 403],
    ["a cross-site mark", { headers: { "Sec-Fetch-Site": "cross-site" } }, 403],
    ["a same-site mark", { headers: { "Sec-Fetch-Site": "same-site" } }, 403],
    ["a multipart body", { headers: { "Content-Type": "multipart/form-data; boundary=x" } }, 415],
    ["a text body", { headers: { "Content-Type": "text/plain" } }, 415],
    ["no content type", { headers: { "Content-Type": null } }, 415],
    ["a body past the cap", { headers: { "Content-Length": String(1024 * 1024 + 1) } }, 413],
  ] as const;
  const snapshot = await stored(opened);

  for (const [what, options, status] of refusals) {
    for (const path of [`/sites/report--${site.id}/delete`, `/sites/report--${site.id}/new-link`, "/settings/sign-everyone-out"]) {
      const answer = await opened.post(path, { confirm: "yes" }, options);

      expect([what, path, answer.status]).toEqual([what, path, status]);
      expect(await answer.text()).toContain('<p class="notice refused" role="status">');
    }
  }

  expect(await stored(opened)).toBe(snapshot);
});

test("a token lives twelve hours and no longer, and the same form with it then does its change", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const csrf = await opened.token();

  opened.clock.now += HALF_DAY_MS;
  const done = await opened.post(`/sites/report--${site.id}/delete`, {}, { csrf });

  expect([done.status, done.headers.get("Location")]).toEqual([303, `/sites/report--${site.id}?done=trashed`]);

  opened.clock.now += 1;
  const late = await opened.post(`/sites/report--${site.id}/restore`, {}, { csrf });

  expect(late.status).toBe(403);
  expect((await opened.install.database.getSite(site.id))?.state).toBe("trash");
});

test("a method the dashboard does not answer is refused with the methods it does; a change no form posts, an inherited name included, is no page", async () => {
  const opened = await openDashboard();
  const site = await opened.publish("report");
  const snapshot = await stored(opened);
  const put = await opened.fetch(new Request(`${ORIGIN}/settings`, { method: "PUT", headers: { Cookie: opened.cookie, Origin: ORIGIN } }));

  expect([put.status, put.headers.get("Allow")]).toEqual([405, "GET, HEAD, POST"]);

  for (const path of [`/sites/report--${site.id}/constructor`, `/sites/report--${site.id}/toString`, "/settings/__proto__", "/settings/hasOwnProperty", "/usage", "/"]) {
    expect([path, (await opened.post(path, {})).status]).toEqual([path, 404]);
  }

  expect(await stored(opened)).toBe(snapshot);
});

test("a session that cannot be read, as when the database is down, is answered like no session: the way to the login and nothing else", async () => {
  const opened = await openDashboard();
  const broken = createDashboard({
    install: opened.install,
    readSession: () => Promise.reject(new Error("the database is down")),
    loginPath: "/login",
    csrfSecret: CSRF_SECRET,
    ...codeCounts(),
  });
  const answer = await broken.fetch(new Request(`${ORIGIN}/settings`, { headers: { Cookie: opened.cookie } }));

  expect([answer.status, answer.headers.get("Location"), await answer.text()]).toEqual([302, `${LOGIN}${encodeURIComponent("/settings")}`, ""]);
});

test("a HEAD of a page answers its headers and no body", async () => {
  const opened = await openDashboard();
  const answer = await opened.fetch(new Request(`${ORIGIN}/usage`, { method: "HEAD", headers: { Cookie: opened.cookie } }));

  expect([answer.status, await answer.text()]).toEqual([200, ""]);
});

test("a dashboard built with no domain plug has no Domain tab and answers none of its paths", async () => {
  const opened = await openDashboard();
  const answers = [await opened.get("/domain"), await opened.post("/domain/check", { token: "a-token-0123456789-abcdefgh" }), await opened.post("/domain/save", {})];

  expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404]);
  expect(await (await opened.get("/")).text()).not.toContain('href="/domain"');
});
