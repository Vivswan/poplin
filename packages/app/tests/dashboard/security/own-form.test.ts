// Every form the dashboard and the setup page show, posted the way a browser posts it: the headers are worked out from the page that carried the form, never typed in.

import { expect, test } from "bun:test";

import { beginLogin } from "@poplin/core/src/actions/computer-logins";
import { mintToken } from "@poplin/core/src/auth/tokens";
import { settingsToText } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";

import { DOMAIN_CHANGES } from "../../../src/dashboard/domain/domain-changes";
import { createSetup } from "../../../src/dashboard/domain/setup";
import { SETTINGS_CHANGES } from "../../../src/dashboard/settings/settings-changes";
import { SITE_CHANGES } from "../../../src/dashboard/sites/site-changes";
import { TOKEN_CHANGES } from "../../../src/dashboard/tokens/token-changes";
import { MemoryCounters } from "../../../src/limits/memory-counters";
import { TOKEN, usualPlug } from "../domain/support/fake-plug";
import { formHeadersOf } from "../support/browser";
import { CSRF_SECRET, LOGIN, ORIGIN, type Opened, openDashboard } from "../support/install";

/** A browser of today, and one from before browsers sent `Sec-Fetch-Site`. */
const BROWSERS = ["current", "before-fetch-metadata"] as const;

/** The token a page's forms carry. */
const CSRF = /name="csrf" value="([^"]+)"/;

/** Every address a page's forms and buttons post to. */
const POSTED_TO = /<form method="post" action="([^"]+)"|formaction="([^"]+)"/g;

/** The two runs a token form asks for; they are routed apart from the changes. */
const RUNS = ["check", "repair"];

/** An upload id that no upload has. */
const NO_UPLOAD = "0000000000000000";

/** The query a site's page is opened with while a copy of it is in progress. */
const COPYING = `copy=${NO_UPLOAD}&copied=1&files=2`;

/** What answers a request: a dashboard, or a setup page. */
type Fetch = (request: Request) => Promise<Response>;

/** One form as it stands on a page: where the page is, where the form posts, what it sends, and the answer of a form that was taken. */
interface Shown {
  readonly fetch: Fetch;
  readonly cookie?: string;
  readonly page: string;
  readonly action: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly answer: readonly [status: number, location: string | null];
}

/** A form route, as the pattern its address follows, and how to bring one of its forms onto a page. */
type Arrange = () => Promise<Shown>;

async function inDashboard(arrange: (opened: Opened) => Promise<Omit<Shown, "fetch" | "cookie">>): Promise<Shown> {
  const opened = await openDashboard(usualPlug());

  return { fetch: opened.fetch, cookie: opened.cookie, ...(await arrange(opened)) };
}

function ofSite(change: string, arrange: (opened: Opened, path: string, site: Site) => Promise<Pick<Shown, "fields" | "answer"> & Partial<Pick<Shown, "page">>>): Arrange {
  return () =>
    inDashboard(async (opened) => {
      const site = await opened.publish("report", "public");
      const label = `report--${site.id}`;
      const path = `/sites/${label}`;

      return { page: path, action: `${path}/${change}`, ...(await arrange(opened, path, site)) };
    });
}

async function trash(opened: Opened, site: Site): Promise<void> {
  await opened.install.database.trashSite(site.id, { by: opened.owner, at: opened.clock.now });
}

async function addVersion(opened: Opened, { id }: Site): Promise<void> {
  const reserved = await opened.install.database.reserveVersion(id);
  if (reserved.kind !== "reserved") throw new Error("no version was reserved");

  await opened.install.database.addVersion(id, { number: reserved.number, keep: 3, bytes: 1, files: 1 }, { by: opened.owner, at: opened.clock.now });
}

function ofLogin(change: string, fields: Readonly<Record<string, string>>, done: string): Arrange {
  return () =>
    inDashboard(async (opened) => {
      const login = await beginLogin(opened.install, { scope: "publisher", computer: "laptop" }, "one-visitor");
      if (!login.ok) throw new Error(`the fixture login was refused: ${login.code}`);

      return { page: `/tokens/allow?code=${login.code}`, action: `/tokens/${change}`, fields: { code: login.code, ...fields }, answer: [303, `/tokens?done=${done}`] };
    });
}

async function ofSetup(run: string): Promise<Shown> {
  const opened = await openDashboard();
  const setup = createSetup({
    install: opened.install,
    domain: usualPlug(),
    open: async () => true,
    counters: new MemoryCounters(),
    visitorOf: async () => "203.0.113.7",
    csrfSecret: CSRF_SECRET,
  });

  return { fetch: setup.fetch, page: "/setup", action: `/setup/${run}`, fields: { token: TOKEN }, answer: [200, null] };
}

/** Every form route, by the pattern of the address its form posts to. */
const FORMS: Readonly<Record<string, Arrange>> = {
  "/sites/:site/settings": ofSite("settings", async (_opened, path) => ({
    fields: { name: "report", access: "public", public_name: "report", title: "", embeddable: "on" },
    answer: [303, `${path}?done=saved`],
  })),
  "/sites/:site/access": ofSite("access", async (_opened, path) => ({ fields: { access: "unlisted" }, answer: [303, `${path}?done=made_unlisted`] })),
  "/sites/:site/rename": ofSite("rename", async (_opened, path, site) => ({ page: `${path}?ask=rename`, fields: { name: "notes" }, answer: [303, `/sites/notes--${site.id}?done=renamed`] })),
  "/sites/:site/rollback": ofSite("rollback", async (opened, path, site) => {
    await addVersion(opened, site);
    await addVersion(opened, site);

    return { fields: { version: "previous" }, answer: [303, `${path}?done=rolled_back`] };
  }),
  "/sites/:site/new-link": ofSite("new-link", async (_opened, path) => ({ page: `${path}?ask=new-link`, fields: {}, answer: [303, "a new label"] })),
  // The fixture's site is a row without files, so the action behind the form answers that there is no page to copy: the form itself was taken.
  "/sites/:site/duplicate": ofSite("duplicate", async (_opened, path) => ({ page: `${path}?ask=duplicate`, fields: { name: "" }, answer: [303, `${path}?ask=duplicate&refused=no_index`] })),
  // No copy is in progress under the id the page was opened with, so the action answers that the copy is gone: the form itself was taken.
  "/sites/:site/cancel-copy": ofSite("cancel-copy", async (_opened, path) => ({ page: `${path}?${COPYING}`, fields: { upload: NO_UPLOAD }, answer: [303, `${path}?refused=not_found&about=upload`] })),
  "/sites/:site/delete": ofSite("delete", async (_opened, _path, site) => ({ fields: {}, answer: [303, `/?done=trashed&site=report--${site.id}`] })),
  "/sites/:site/restore": ofSite("restore", async (opened, path, site) => {
    await trash(opened, site);

    return { fields: {}, answer: [303, `${path}?done=restored`] };
  }),
  "/sites/:site/delete-forever": ofSite("delete-forever", async (opened, _path, site) => {
    await trash(opened, site);

    return { fields: { confirm: "report" }, answer: [303, "/?view=trash&done=deleted"] };
  }),
  "/tokens/allow": ofLogin("allow", { confirm: "yes" }, "allowed"),
  "/tokens/deny": ofLogin("deny", {}, "denied"),
  "/tokens/revoke": () =>
    inDashboard(async (opened) => {
      const { record } = await mintToken({ scope: "publisher", note: "laptop", now: opened.clock.now });
      await opened.install.database.addToken(record, { by: opened.owner, at: opened.clock.now });

      return { page: "/tokens", action: "/tokens/revoke", fields: { token: record.id }, answer: [303, "/tokens?done=revoked"] };
    }),
  "/settings/save": () =>
    inDashboard(async (opened) => {
      const stored = await opened.install.database.readSettings();
      if (stored === undefined) throw new Error("the settings are not stored");

      return { page: "/settings", action: "/settings/save", fields: { ...settingsToText(stored), trash_days: "30" }, answer: [303, "/settings?done=saved"] };
    }),
  "/settings/sign-everyone-out": () =>
    inDashboard(async () => ({ page: "/settings", action: "/settings/sign-everyone-out", fields: { confirm: "yes" }, answer: [303, `${LOGIN}${encodeURIComponent("/")}`] })),
  "/domain/save": () =>
    inDashboard(async () => ({
      page: "/domain",
      action: "/domain/save",
      fields: { outside_pages: "allowed", search_engines_allowed: "on", block_bots: "on" },
      answer: [303, "/domain?done=saved"],
    })),
  "/domain/check": () => inDashboard(async () => ({ page: "/domain", action: "/domain/check", fields: { token: TOKEN }, answer: [200, null] })),
  "/domain/repair": () => inDashboard(async () => ({ page: "/domain", action: "/domain/repair", fields: { token: TOKEN }, answer: [200, null] })),
  "/setup/check": () => ofSetup("check"),
  "/setup/repair": () => ofSetup("repair"),
};

/** The pattern of the address a form posts to: a site's label gives way to `:site`. */
function patternOf(action: string): string {
  return action.replace(/^\/sites\/[^/]+\//, "/sites/:site/").replace(/\?.*$/, "");
}

// Drift: a page whose Referrer-Policy makes a browser withhold the Origin, under a check that asks for one, refuses every button of a real install while tests that type the Origin in stay green.
test("every form is taken when a browser posts it from the page that showed it, under the Referrer-Policy that page was sent with", async () => {
  for (const [route, arrange] of Object.entries(FORMS)) {
    for (const browser of BROWSERS) {
      const shown = await arrange();
      const cookie: Record<string, string> = shown.cookie === undefined ? {} : { Cookie: shown.cookie };
      const page = await shown.fetch(new Request(`${ORIGIN}${shown.page}`, { headers: cookie }));
      const text = await page.text();
      const actions = [...text.matchAll(POSTED_TO)].map((match) => match[1] ?? match[2]);

      expect([route, actions.includes(shown.action), patternOf(shown.action)]).toEqual([route, true, route]);

      const body = new URLSearchParams({ ...shown.fields, csrf: CSRF.exec(text)?.[1] ?? "" });
      const answer = await shown.fetch(new Request(`${ORIGIN}${shown.action}`, { method: "POST", headers: { ...cookie, ...formHeadersOf(page, ORIGIN, browser) }, body: body.toString() }));
      const location = answer.headers.get("Location");
      const landed = route === "/sites/:site/new-link" && /^\/sites\/report--[0-9a-z]{12}\?done=new_link$/.test(location ?? "") ? "a new label" : location;

      expect([route, browser, answer.status, landed]).toEqual([route, browser, ...shown.answer]);
    }
  }
});

// Drift: a form route added to the dashboard with no row above is never posted the way a browser posts it.
test("the routes posted as a browser are every form route there is: each change of each tab, the two runs of the Domain tab, and the two of the setup page", async () => {
  const routes = [
    ...Object.keys(SITE_CHANGES).map((change) => `/sites/:site/${change}`),
    ...Object.keys(TOKEN_CHANGES).map((change) => `/tokens/${change}`),
    ...Object.keys(SETTINGS_CHANGES).map((change) => `/settings/${change}`),
    ...[...Object.keys(DOMAIN_CHANGES), ...RUNS].map((change) => `/domain/${change}`),
    ...RUNS.map((run) => `/setup/${run}`),
  ];

  expect(Object.keys(FORMS).sort()).toEqual([...routes].sort());

  // Every form on every page of a dashboard that has a live site, a site in the trash, a token, and a pending login posts to one of them.
  const opened = await openDashboard(usualPlug());
  const live = await opened.publish("report", "public");
  const gone = await opened.publish("old");
  await addVersion(opened, live);
  await trash(opened, gone);
  const { record } = await mintToken({ scope: "publisher", note: "laptop", now: opened.clock.now });
  await opened.install.database.addToken(record, { by: opened.owner, at: opened.clock.now });
  const login = await beginLogin(opened.install, { scope: "publisher", computer: "laptop" }, "one-visitor");
  if (!login.ok) throw new Error(`the fixture login was refused: ${login.code}`);

  const site = `/sites/report--${live.id}`;
  const asks = ["rename", "duplicate", "new-link"].map((ask) => `${site}?ask=${ask}`);
  const pages = ["/", "/?view=trash", site, `${site}?${COPYING}`, ...asks, `/sites/old--${gone.id}`, "/tokens", `/tokens/allow?code=${login.code}`, "/settings", "/activity", "/usage", "/domain"];
  const seen = new Set<string>();

  for (const path of pages) {
    const text = await (await opened.get(path)).text();
    for (const match of text.matchAll(POSTED_TO)) seen.add(patternOf(match[1] ?? match[2] ?? ""));
  }

  expect([...seen].filter((action) => !routes.includes(action))).toEqual([]);
  expect(routes.filter((route) => !route.startsWith("/setup/") && !seen.has(route))).toEqual([]);
});

// Drift: a policy that sends the page's address to another origin would hand a site's owner-only label, or a login's code, to whatever the page links to.
test("the dashboard and the setup page name their own Referrer-Policy, one that sends a referrer to their own origin alone", async () => {
  const opened = await openDashboard();
  const setup = await ofSetup("check");
  const answers = [await opened.get("/settings"), await opened.fetch(new Request(`${ORIGIN}/settings`)), await setup.fetch(new Request(`${ORIGIN}/setup`)), await setup.fetch(new Request(`${ORIGIN}/nowhere`))];

  expect(answers.map((answer) => [answer.status, answer.headers.get("Referrer-Policy")])).toEqual([
    [200, "same-origin"],
    [302, "same-origin"],
    [200, "same-origin"],
    [404, "same-origin"],
  ]);
});
