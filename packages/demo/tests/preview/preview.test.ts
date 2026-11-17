// Scope: the preview is asked in process, as a browser and the dashboard's client would ask it. One test starts the real command on free ports; watch mode is not started here.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readShell } from "../../../app/tests/console/support/shell";
import { BunSqliteDriver } from "../../../core/tests/database/support/bun-sqlite-driver";
import { createPreview } from "../../src/preview/preview";
import { readRealSites } from "../../src/preview/world/real-sites";
import { HOST, PID_PATH, pidFile, stopRunning } from "../../scripts/running";
import { readSamples } from "../../scripts/samples";
import { plantedLint } from "../../../../tests/support/planted-lint";

/** The version the demo's installs are told they run. */
const VERSION = "1.0.0";

/** The command that starts a preview. */
const SERVE = join(import.meta.dir, "..", "..", "scripts", "serve.ts");

/** How long a started preview is given to answer, in milliseconds: the command builds the dashboard's client first. */
const START_MS = 20_000;

/** How long a test that seeds an install twice may take, in milliseconds: a seed is work of the processor alone, and two of them on a busy machine pass the five seconds a test gets. */
const SEED_MS = 30_000;

/** The origin the test asks the preview at. */
const ORIGIN = "http://127.0.0.1:4400";

/** The most redirects one link is followed through. */
const MAX_HOPS = 4;

/** The headers the dashboard's client puts on a change it sends to the page's own origin. */
const CHANGE_HEADERS = { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };

/** A stand-in for the dashboard's built client: two files under names of its own, so no test waits for a build. */
const CLIENT_FILES: Readonly<Record<string, { readonly body: string; readonly type: string }>> = {
  "app-test.js": { body: "// the client", type: "text/javascript; charset=utf-8" },
  "app-test.css": { body: "/* the look */", type: "text/css; charset=utf-8" },
};

/** That client as a host hands it out. */
const CLIENT: Parameters<typeof createPreview>[0]["client"] = {
  entry: async () => ({ script: "app-test.js", style: "app-test.css" }),
  file: async (name) => (Object.hasOwn(CLIENT_FILES, name) ? CLIENT_FILES[name] : undefined),
};

/** Every screen of the dashboard, by the path that shows it. */
const SCREENS = ["/", "/tokens", "/activity", "/usage", "/settings", "/domain"];

/** Any address at the install's own domain, which no answer may send a browser to. */
const INSTALL_ADDRESS = /https?:\/\/[a-z0-9.-]*example\.com[^"]*/g;

/** The three origins a preview of an install without a domain is asked at. */
const LOCAL = { admin: "http://poplin.localhost:4400", sites: "http://sites.localhost:4400", private: "http://private.localhost:4400" } as const;

/** Any address of that install as the app writes it, over https and without the port: no answer may send a browser to one. */
const APP_ADDRESS = /https:\/\/[a-z]+\.localhost[^"]*/g;

/** A running preview. */
type Preview = Awaited<ReturnType<typeof createPreview>>;

/** What a page hands its client to start from. */
interface Boot {
  readonly base: string;
  readonly demo: { readonly reset: string } | null;
}

/** A site as the Sites screen is told it. */
interface Listed {
  readonly sites: readonly { readonly name: string; readonly label: string; readonly url: string }[];
}

/** What one request to a preview without a domain is expected to answer: its status, where it sends the browser, and whether its body is the dashboard's page. */
type Answered = readonly [status: number, location: string | null, dashboard: boolean];

/** Follow a path through its redirects, as a browser would. */
async function open(preview: Preview, path: string): Promise<Response> {
  let response = await preview.fetch(new Request(`${ORIGIN}${path}`));

  for (let hop = 0; hop < MAX_HOPS && response.status >= 300 && response.status < 400; hop += 1) {
    response = await preview.fetch(new Request(new URL(response.headers.get("Location") ?? "", `${ORIGIN}${path}`)));
  }

  return response;
}

/** Read one data route as the client does. */
async function data<Answer>(preview: Preview, path: string): Promise<Answer> {
  return (await (await preview.fetch(new Request(`${ORIGIN}${path}`))).json()) as Answer;
}

/** Send one change as the client does: JSON, from a page of the preview's own origin. */
function change(preview: Preview, path: string, body: unknown = {}): Promise<Response> {
  return preview.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: CHANGE_HEADERS, body: JSON.stringify(body) }));
}

/** The start values a page carries, and the files it loads: its stylesheets, then its scripts. */
async function shellOf(page: string): Promise<{ readonly boot: Boot; readonly files: readonly string[] }> {
  const shell = await readShell(page);

  return { boot: shell.boot as Boot, files: [...shell.styles, ...shell.scripts] };
}

/** A port nothing listens on now. */
function freePort(): number {
  const taken = Bun.serve({ hostname: HOST, port: 0, fetch: () => new Response() });
  const { port } = taken;
  void taken.stop(true);

  return port ?? 0;
}

/** Start the preview's command on a port, with any flags after it, and wait until a preview other than `before` answers there with its pid. */
async function start(port: number, before?: number, flags: readonly string[] = []): Promise<number> {
  Bun.spawn([process.execPath, SERVE, "--port", String(port), ...flags], { stdio: ["ignore", "ignore", "inherit"] });

  for (const deadline = Date.now() + START_MS; Date.now() < deadline; await Bun.sleep(50)) {
    const answer = await fetch(`http://${HOST}:${port}${PID_PATH}`).catch(() => undefined);
    const pid = answer?.ok === true ? Number(await answer.text()) : before;
    if (pid !== before && pid !== undefined) return pid;
  }

  throw new Error(`no preview answered on port ${port}`);
}

/** Open the demo as the command does: over bun's SQLite and the real sample sites. `real` is what a host's file of real addresses holds, for a demo that has one. */
async function openPreview(gallery: boolean, real?: Parameters<typeof createPreview>[0]["real"]): Promise<Preview> {
  return createPreview({ openDriver: () => new BunSqliteDriver(), samples: await readSamples(), version: VERSION, gallery, client: CLIENT, real });
}

describe("the local preview", () => {
  // Drift: the page that stands in for the sample computers' terminals would print the code of every login that waits, so a person at the preview could allow a login a real terminal began without seeing that terminal.
  test("the page of what the waiting computers print holds the sample logins alone: a login a real terminal began is not on it, by its id or by its code", async () => {
    const preview = await openPreview(false);
    const ask = (path: string, init?: RequestInit): Promise<Response> => preview.fetch(new Request(`${ORIGIN}${path}`, init));
    const { logins } = (await (await ask("/data/logins")).json()) as { readonly logins: readonly { readonly id: string }[] };
    const begun = await ask("/api/logins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "admin", computer: "a real terminal" }) });
    const real = (await begun.json()) as { readonly code: string; readonly secret: string };
    const listed = (await (await ask("/data/logins")).json()) as { readonly logins: readonly { readonly id: string }[] };
    const printed = await (await ask("/state/allow/waiting")).text();
    const realId = real.secret.split("_")[2] ?? "";

    expect([begun.status, logins.length, listed.logins.map((login) => login.id).includes(realId)]).toEqual([200, 2, true]);
    expect(logins.map((login) => printed.includes(`/tokens/review/${login.id}`))).toEqual([true, true]);
    expect([printed.includes(realId), printed.includes(real.code), printed.includes("a real terminal")]).toEqual([false, false, false]);
  });

  // Drift: the page of the terminals, asked before any page of the dashboard, says no login waits: only a page of the dashboard began the sample logins.
  test("the page of what the waiting computers print, as the first thing asked of a preview, holds the sample logins the dashboard then lists", async () => {
    const preview = await openPreview(false);
    const ask = (path: string): Promise<Response> => preview.fetch(new Request(`${ORIGIN}${path}`));
    const printed = await (await ask("/state/allow/waiting")).text();
    const { logins } = (await (await ask("/data/logins")).json()) as { readonly logins: readonly { readonly id: string }[] };

    expect([logins.length, logins.map((login) => printed.includes(`/tokens/review/${login.id}`))]).toEqual([2, [true, true]]);
  });

  // Drift: a restart leaves a stray server behind, or the command serves a page with no script.
  test("two previews run side by side on two ports, each serves the dashboard's built client, a second start on a port replaces the first, and a stop leaves no server and no pid file", async () => {
    const [one, other] = [freePort(), freePort()];

    try {
      const first = await start(one);
      const beside = await start(other);
      const second = await start(one, first);
      const home = await fetch(`http://${HOST}:${other}/`);
      const [script = ""] = (await shellOf(await home.text())).files.filter((file) => file.endsWith(".js"));
      const built = await fetch(`http://${HOST}:${other}${script}`);

      expect(new Set([first, beside, second]).size).toBe(3);
      expect([home.status, built.status, built.headers.get("Cache-Control")]).toEqual([200, 200, "public, max-age=31536000, immutable"]);
      expect(await stopRunning(one)).toBe(second);
      expect(await fetch(`http://${HOST}:${one}/`).catch(() => "gone")).toBe("gone");
      expect(await stopRunning(other)).toBe(beside);
    } finally {
      await Promise.all([stopRunning(one), stopRunning(other)]);
    }

    expect([one, other].map((port) => existsSync(pidFile(port)))).toEqual([false, false]);
  }, 90_000);

  test("the seed runs and every link of the gallery answers the status the gallery states: without this a change to the app leaves the preview with dead pages", async () => {
    const preview = await openPreview(true);
    const entries = await preview.entries();
    const gallery = await (await open(preview, "/gallery")).text();
    const answered = await Promise.all(entries.map(async (entry) => [entry.path, (await open(preview, entry.path)).status] as const));

    expect(entries.length).toBeGreaterThan(40);
    expect(entries.filter((entry) => !gallery.includes(`href="${Bun.escapeHTML(entry.path)}"`))).toEqual([]);
    expect(answered.filter(([path, status]) => status !== (entries.find((entry) => entry.path === path)?.status ?? 200))).toEqual([]);
    expect((await open(await openPreview(false), "/gallery")).status).toBe(404);
  });

  // Drift: the client asks its data and its files where the page says the dashboard sits. A page that named another place, at any of the preview's mounts, would draw an empty screen.
  test.each([
    ["the seeded install", "", SCREENS],
    ["the install that holds nothing", "/empty", SCREENS],
  ] as const)("every screen of %s answers the page that loads the client under its own place, and its files and its data answer there", async (_, place, screens) => {
    const preview = await openPreview(false);
    const pages = await Promise.all(screens.map(async (screen) => shellOf(await (await open(preview, `${place}${screen}`)).text())));
    const files = await Promise.all((pages[0]?.files ?? []).map(async (file) => [file, (await open(preview, file)).status] as const));
    const asked = await preview.fetch(new Request(`${ORIGIN}${place}/data/sites`));

    expect(pages.map((page) => page.boot.base)).toEqual(screens.map(() => place));
    expect(files).toEqual([
      [`${place}/assets/app-test.css`, 200],
      [`${place}/assets/app-test.js`, 200],
    ]);
    expect([asked.status, asked.headers.get("Content-Type")]).toEqual([200, "application/json"]);
  });

  // Drift: a host that cannot give the demo its root shows a dashboard that asks its data outside the demo.
  test("under a base path the page, its files, its data, every redirect, and every written address carry the base, and a demo its host already holds is not seeded again", async () => {
    const base = "/poplin/demo";
    const drivers = [new BunSqliteDriver(), new BunSqliteDriver()];
    const [seeded] = drivers;
    const host = { samples: await readSamples(), version: VERSION, gallery: false, base, client: CLIENT };
    const first = await createPreview({ ...host, openDriver: () => drivers.shift() ?? new BunSqliteDriver() });
    const resumed = await createPreview({ ...host, resumed: true, openDriver: () => seeded ?? new BunSqliteDriver() });
    const ask = (preview: Preview, path: string): Promise<Response> => preview.fetch(new Request(`${ORIGIN}${path}`));
    const home = await shellOf(await (await ask(first, `${base}/`)).text());
    const empty = await shellOf(await (await ask(first, `${base}/empty/`)).text());
    const listed = (await (await ask(first, `${base}/data/sites?access=public&sort=name&dir=asc`)).json()) as Listed;
    const again = (await (await ask(resumed, `${base}/data/sites?access=public&sort=name&dir=asc`)).json()) as Listed;
    const strangers = await Promise.all(["visitor", "removed", "unchecked"].map((as) => ask(first, `${base}/empty/settings?as=${as}`)));
    const strangersData = await Promise.all(["visitor", "removed", "unchecked"].map((as) => ask(first, `${base}/data/frame?as=${as}`)));

    expect([home.boot.base, home.boot.demo?.reset, empty.boot.base, empty.boot.demo?.reset]).toEqual([base, `${base}/reset`, `${base}/empty`, `${base}/empty/reset`]);
    expect(home.files).toEqual([`${base}/assets/app-test.css`, `${base}/assets/app-test.js`]);
    expect((await ask(first, `${base}/assets/app-test.js`)).status).toBe(200);
    expect(listed.sites.map((site) => site.url)).toContain(`${ORIGIN}${base}/served/lisbon-page/`);
    // Drift: the preview has no provider's login, so its stand-in is the only place a person sees what the dashboard says to somebody who is not let in.
    expect(strangers.map((answer) => [answer.status, answer.headers.get("Location"), answer.headers.get("Content-Type")])).toEqual([403, 403, 503].map((status) => [status, null, "text/html; charset=utf-8"]));
    expect(await Promise.all(strangers.map(async (answer) => (await answer.text()).includes("<script")))).toEqual([false, false, false]);
    // Drift: the page of an email that is no user names the way out. Named at the sample install's own address, it would lead a person out of the preview.
    expect(await (await ask(first, `${base}/settings?as=removed`)).text()).toContain(`To log in with another email, open ${ORIGIN}${base}/out`);
    // Drift: no login is here to end. The way out would answer what a request with no login behind it gets, a page headed 403 that reads as a failure, or lead out of the base.
    const out = await ask(first, `${base}/out`);
    const signedOut = await ask(first, `${base}/state/signed-out`);
    expect([out.status, out.headers.get("Location"), signedOut.status, (await signedOut.text()).includes("<h1>Signed out</h1>")]).toEqual([302, `${base}/state/signed-out`, 200, true]);
    expect(await Promise.all(strangersData.map(async (answer) => [answer.status, ((await answer.json()) as { code: string }).code]))).toEqual([
      [401, "no_login"],
      [403, "not_a_user"],
      [503, "login_unchecked"],
    ]);
    expect((await ask(first, "/settings")).status).toBe(404);
    expect(again.sites.map((site) => site.label)).toEqual(listed.sites.map((site) => site.label));
  });

  // Drift: the note of the last check of the domain can only be looked at where an install remembers one. A seed with none, or one a Check could not change, would leave the healthy and the broken state unseen.
  // The sample install holds what reads its provider: a Check that waited for a token would show the dialog the screen has no more use for.
  test("the seeded install remembers a healthy domain, a Check on the Domain screen takes no token and leaves a broken login to act on, and a reset brings the healthy one back", async () => {
    const preview = await openPreview(false);
    const note = async (): Promise<unknown> => {
      const answer = await preview.fetch(new Request(`${ORIGIN}/api/domain`, { headers: { Authorization: `Bearer ${preview.token()}` } }));
      const { check, note: raised } = (await answer.json()) as { check: { run: string; pieces: unknown[] } | null; note: unknown };

      return [answer.status, check?.run, check?.pieces.length, raised];
    };
    const seeded = await note();
    const run = await change(preview, "/data/domain/check", {});
    const checked = await note();
    await preview.fetch(new Request(`${ORIGIN}/reset`, { method: "POST" }));

    expect(run.status).toBe(200);
    expect([seeded, checked, await note()]).toEqual([
      [200, "check", 7, "none"],
      [200, "check", 7, { code: "login_broken", about: "Login policy" }],
      [200, "check", 7, "none"],
    ]);
  }, SEED_MS);

  // Drift: the client shows and copies the addresses its data holds. One that named a hostname of the install would send a browser to a domain that does not exist.
  test("no page and no data of the dashboard names a hostname of the install, and every site's address is a path of the preview that serves the site", async () => {
    const preview = await openPreview(false);
    const { sites } = await data<Listed>(preview, "/data/sites");
    const answers = await Promise.all(
      [...SCREENS, "/data/sites", "/data/sites?view=trash", "/data/activity", "/data/usage", "/data/settings", "/data/domain", "/data/frame", ...sites.map((site) => `/data/sites/${site.label}`)].map(
        async (path) => [path, await (await open(preview, path)).text()] as const,
      ),
    );
    const served = await Promise.all(sites.map(async (site) => [site.name, site.url.startsWith(`${ORIGIN}/served/`), (await open(preview, new URL(site.url).pathname)).status] as const));

    expect(sites.length).toBeGreaterThan(8);
    expect(answers.flatMap(([path, text]) => (text.match(INSTALL_ADDRESS) ?? []).map((found) => [path, found]))).toEqual([]);
    expect(served.filter(([, local]) => !local)).toEqual([]);
    expect(served.filter(([, , status]) => status === 200).length).toBeGreaterThan(5);
  });

  // Drift: the Link column here shows a site's address on this machine. A search that took it to the app as it stands would find nothing, where the same press on an install finds the site.
  test("a site's address on this machine, pasted into the search of the Sites screen, lists that site alone: a public, an unlisted and a private one, with its scheme and its last slash or without, under a base path too", async () => {
    const preview = await openPreview(false);
    const { sites } = await data<Listed>(preview, "/data/sites");
    const urlOf = (name: string): string => sites.find((site) => site.name === name)?.url ?? "";
    const found = async (typed: string): Promise<readonly string[]> => (await data<Listed>(preview, `/data/sites?q=${encodeURIComponent(typed)}`)).sites.map((site) => site.name);
    const lisbon = urlOf("lisbon-trip");
    const typed = [lisbon.replace("http://", "HTTP://"), lisbon.replace("http://", "").replace(/\/$/, ""), `${lisbon}day-two.html?x=1`, lisbon.replace("/served/", "/poplin/demo/served/"), urlOf("launch-deck"), urlOf("sales-report")];
    const others = [lisbon.replace("4400", "4401"), "https://lisbon-page.example.org/", `${ORIGIN}/served/`, `${ORIGIN}/served/%/`];

    expect(lisbon).toBe(`${ORIGIN}/served/lisbon-page/`);
    expect(await Promise.all(typed.map(found))).toEqual([["lisbon-trip"], ["lisbon-trip"], ["lisbon-trip"], ["lisbon-trip"], ["launch-deck"], ["sales-report"]]);
    expect(await Promise.all(others.map(found))).toEqual([[], [], [], []]);
    // What the Link column shows of a public site is its first label alone.
    expect(await found("lisbon-page")).toEqual(["lisbon-trip"]);
  });

  // Drift: a demo beside an install that holds the same sites sends a visitor to the real ones. An address taken from the host's file as it stands, or kept for a site the visitor changed, would send them somewhere the row does not describe.
  test("a host's real addresses become the links of the sample sites they name, under a base too, one that is no https root does not, the demo's own site leads to its dashboard, and a site a visitor changed is the demo's own again", async () => {
    const real = { "sales-report": "https://sales-report--p1a2b3.example.org/", "lisbon-trip": "https://lisbon-page.example.org/", handbook: "http://handbook-page.example.org/", nobody: "https://nobody.example.org/" };
    const base = "/poplin/demo";
    const preview = await createPreview({ openDriver: () => new BunSqliteDriver(), samples: await readSamples(), version: VERSION, client: CLIENT, base, real: readRealSites(real) });
    const urls = async (): Promise<Record<string, string>> => Object.fromEntries((await data<Listed>(preview, `${base}/data/sites`)).sites.map((site) => [site.name, site.url]));
    const before = await urls();
    const { sites } = await data<Listed>(preview, `${base}/data/sites?q=sales-report`);
    const panel = await (await open(preview, `${base}/data/sites/${sites[0]?.label}`)).text();
    const sent = await change(preview, `${base}/data/sites/${sites[0]?.label}/access`, { access: "unlisted" });
    const checkout = (await data<Listed>(preview, `${base}/data/sites?q=checkout`)).sites[0]?.label;
    const renamed = await change(preview, `${base}/data/sites/${checkout}/naming`, { name: "lisbon-trip" });
    const after = await urls();

    expect([before["sales-report"], before["lisbon-trip"], before.demo, before.handbook]).toEqual([real["sales-report"], real["lisbon-trip"], `${ORIGIN}${base}/`, `${ORIGIN}${base}/served/handbook-page/`]);
    expect(panel).toContain(`"${real["sales-report"]}"`);
    expect([sent.status, renamed.status]).toEqual([200, 200]);
    expect([after["sales-report"]?.startsWith(`${ORIGIN}${base}/served/sales-report--`), Object.values(after).filter((url) => url.startsWith("https://"))]).toEqual([true, []]);
  });

  // Drift: a stage of the gallery ends a sample site here alone, and the real install still serves it. A link to the real one would open a live site from a panel that says its link has stopped working; a site moved to the trash here is the same case.
  test("a sample site that ran out here, or is in the trash here, leads to the demo's own serving of it, where it is gone, and no longer to its real address", async () => {
    const real = { "winter-offer": "https://winter-offer--p1a2b3.example.org/", "sales-report": "https://sales-report--p1a2b3.example.org/" };
    const preview = await openPreview(true, readRealSites(real));
    const urls = async (view: string): Promise<Record<string, string>> => Object.fromEntries((await data<Listed>(preview, `/data/sites${view}`)).sites.map((site) => [site.name, site.url]));
    const before = await urls("");
    const ended = await open(preview, "/state/expired/panel");
    const { sites } = await data<Listed>(preview, "/data/sites?q=sales-report");
    const trashed = await change(preview, `/data/sites/${sites[0]?.label}/delete`);
    const after = { ...(await urls("")), ...(await urls("?view=trash")) };
    const own = (name: string): boolean => after[name]?.startsWith(`${ORIGIN}/served/${name}--`) === true;

    expect([before["winter-offer"], before["sales-report"]]).toEqual([real["winter-offer"], real["sales-report"]]);
    expect([ended.status, trashed.status]).toEqual([200, 200]);
    expect([own("winter-offer"), own("sales-report"), (await open(preview, new URL(after["winter-offer"] ?? ORIGIN).pathname)).status]).toEqual([true, true, 404]);
  });

  // Drift: the Activity screen shows the log as it is stored, newest first. A seed that wrote its history out of order would show days that jump back and forth.
  test("the seeded activity never rises in time down the list", async () => {
    const preview = await openPreview(false);
    const entries: { readonly at: number }[] = [];
    // Every page is read: the install's own first entry is the last row of the last one.
    for (let after: string | null = ""; after !== null; ) {
      const page: { readonly entries: readonly { readonly at: number }[]; readonly next: string | null } = await data(preview, `/data/activity${after === "" ? "" : `?after=${after}`}`);
      entries.push(...page.entries);
      after = page.next;
    }
    const rising = entries.filter((entry, index) => index > 0 && entry.at > (entries[index - 1]?.at ?? 0));

    expect(entries.length).toBeGreaterThan(200);
    expect(rising).toEqual([]);
  });

  // Drift: a seed that published its samples without their pages' own titles would show a site's name once its typed title is emptied, where the Edit dialog says the page's own title is used, as on an install a publish filled.
  test("a sample site whose typed title is taken away is called by its entry page's own title", async () => {
    const preview = await openPreview(false);
    const { sites } = await data<{ sites: readonly { readonly label: string; readonly title: string | null }[] }>(preview, "/data/sites?q=pricing");
    const [pricing] = sites;
    const emptied = await change(preview, `/data/sites/${pricing?.label}/naming`, { title: "" });
    const { site } = (await emptied.json()) as { readonly site: { readonly title: string | null; readonly title_typed: boolean } };

    expect([pricing?.title, site.title_typed, site.title]).toEqual(["Pricing", false, "Fernhollow Kettle Works: third quarter 2026 sales review"]);
  });

  test("the demo names no runtime and imports only portable source, its own files, and SQLite: without this it stops running in a browser or a Worker the day someone reaches for a file or a process", () => {
    const reach = [
      'import { readFileSync } from "node:fs";',
      'import { serve } from "bun";',
      'import { run } from "../../../cli/src/commands/run";',
      'import "../../../cli/src/commands/run";',
      "import { HOST } from '../../scripts/running';",
      'import { Hono } from "hono";',
      'import other from "sql.js/dist/sql-asm.js";',
      'export const loaded = await import("../../../app/tests/console/support/console");',
      "export const home = process.env.HOME;",
      "export const file = Bun.file(home);",
      "export const bytes = Buffer.from(home);",
    ];
    const portable = [
      "// A Buffer, a process, and Bun are named in a comment alone.",
      'import { base } from "./base";',
      'import { seed } from "../preview/seed";',
      'import { keptStore } from "../browser/kept-store";',
      'import { listSites } from "../../../app/src/sites/list";',
      'import { open } from "../../../core/src/database/open";',
      'import initSqlJs from "sql.js";',
      'import browserSqlJs from "sql.js/dist/sql-wasm-browser.js";',
    ];
    const refused = plantedLint({
      "packages/demo/src/preview/added.ts": `${reach.join("\n")}\n`,
      "packages/demo/src/preview/kept.ts": `${portable.join("\n")}\n`,
      "packages/demo/scripts/added.ts": `${reach.join("\n")}\n`,
    });

    expect(refused).toEqual([
      "noNodejsModules: packages/demo/src/preview/added.ts:1",
      "noRestrictedGlobals: packages/demo/src/preview/added.ts:10",
      "noRestrictedGlobals: packages/demo/src/preview/added.ts:11",
      "noRestrictedGlobals: packages/demo/src/preview/added.ts:9",
      ...reach.slice(0, 8).map((_, line) => `noRestrictedImports: packages/demo/src/preview/added.ts:${line + 1}`),
    ]);
  });

  test.each([
    ["the seeded install", "/", "/reset"],
    ["the install that holds nothing", "/empty/", "/empty/reset"],
  ])("a change sent from a preview page changes the install, and the Reset the dashboard of %s names brings the sample data back: without this the controls are pictures", async (_, dashboard, reset) => {
    const preview = await openPreview(false);
    const names = async (query: string): Promise<string[]> => (await data<Listed>(preview, `/data/sites${query}`)).sites.map((site) => site.name);
    const { sites } = await data<Listed>(preview, "/data/sites?q=sales-report");
    const sent = await change(preview, `/data/sites/${sites[0]?.label}/delete`);
    const trashed = [await names("?q=sales-report"), await names("?view=trash")];
    const started = await preview.fetch(new Request(`${ORIGIN}${reset}`, { method: "POST", headers: { Origin: ORIGIN } }));

    expect([sent.status, ((await sent.json()) as { site: { state: string } }).site.state]).toEqual([200, "trash"]);
    expect([trashed[0], trashed[1]?.includes("sales-report")]).toEqual([[], true]);
    expect((await shellOf(await (await open(preview, dashboard)).text())).boot.demo).toEqual({ reset });
    expect([started.status, started.headers.get("Location")]).toEqual([303, "/"]);
    expect([await names("?q=sales-report"), (await names("?view=trash")).includes("sales-report")]).toEqual([["sales-report"], false]);
  }, SEED_MS);

  // Drift: the dashboard keeps no session, so a page that set a cookie would be one a browser keeps for nothing; and `/login` is a screen path like any other, with no stand-in page left behind it.
  test("a preview page hands the browser no cookie, and the old login address is the dashboard's own page", async () => {
    const preview = await openPreview(false);
    const pages = await Promise.all(["/", "/login", "/settings?as=visitor"].map((path) => preview.fetch(new Request(`${ORIGIN}${path}`))));

    expect(pages.map((answer) => [answer.status, answer.headers.getSetCookie(), answer.headers.get("Location")])).toEqual([
      [200, [], null],
      [200, [], null],
      [403, [], null],
    ]);
  });

  test("the API takes the seeded admin token and writes addresses of the preview: without this the printed token and the listed addresses are of no use", async () => {
    const preview = await openPreview(false);
    const listed = await preview.fetch(new Request(`${ORIGIN}/api/sites`, { headers: { Authorization: `Bearer ${preview.token()}` } }));
    const text = await listed.text();

    expect(listed.status).toBe(200);
    expect(text).toContain(`"${ORIGIN}/served/lisbon-page/"`);
    expect(text).not.toContain("https://");
  });

  // Drift: the notice of a newer version has no other way to be seen on this machine: no scheduled run happens here, and the real website names no release above a development build.
  test("the seeded install knows of a release one minor version above its own, learned from a stand-in and not from the network", async () => {
    const preview = await openPreview(false);
    const who = await preview.fetch(new Request(`${ORIGIN}/api/whoami`, { headers: { Authorization: `Bearer ${preview.token()}` } }));

    expect(((await who.json()) as { update?: unknown }).update).toEqual({ current: VERSION, newest: "1.1.0", released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases", database: false });
  });

  // Drift: an address that names no site under `/served/` was sent on to itself with one more slash, and a browser followed that until it gave up.
  test("the place of the served sites, asked with no site after it, is not found and sends the browser nowhere", async () => {
    const preview = await openPreview(false);
    const asked = await Promise.all(["/served/", "/served//"].map((path) => preview.fetch(new Request(`${ORIGIN}${path}`))));

    expect(asked.map((answer) => [answer.status, answer.headers.get("Location")])).toEqual([
      [404, null],
      [404, null],
    ]);
  });
});

/** Open the demo as the command does for an install without a domain, asked at the three origins of `LOCAL`; `listed` gives it the page of every state. */
async function openLocal(listed = false): Promise<Preview> {
  return createPreview({ openDriver: () => new BunSqliteDriver(), samples: await readSamples(), version: VERSION, gallery: listed, client: CLIENT, noDomain: LOCAL });
}

/** Follow a whole address through its redirects, as a browser would: each hop is asked at the host it names. */
async function visit(preview: Preview, address: string): Promise<Response> {
  let at = address;
  let response = await preview.fetch(new Request(at));

  for (let hop = 0; hop < MAX_HOPS && response.status >= 300 && response.status < 400; hop += 1) {
    at = new URL(response.headers.get("Location") ?? "", at).href;
    response = await preview.fetch(new Request(at));
  }

  return response;
}

/** The sites the dashboard of a preview without a domain lists, by name. */
async function listedAt(preview: Preview): Promise<Readonly<Record<string, Listed["sites"][number]>>> {
  const { sites } = (await (await preview.fetch(new Request(`${LOCAL.admin}/data/sites`))).json()) as Listed;

  return Object.fromEntries(sites.map((site) => [site.name, site]));
}

/** Send one change as the dashboard's client does, from a page at the dashboard's own origin. */
function changeAt(preview: Preview, path: string, body: unknown): Promise<Response> {
  return preview.fetch(new Request(`${LOCAL.admin}${path}`, { method: "POST", headers: { ...CHANGE_HEADERS, Origin: LOCAL.admin }, body: JSON.stringify(body) }));
}

describe("the local preview of an install without a domain", () => {
  // Drift: the three hosts are three origins only while each answers its own side. A site host that answered the dashboard's data, or a dashboard host that served a site's page, would put a site's script and the dashboard on one origin.
  // Drift: a link with a made-up id would lead on to an unlisted site, which a link alone opens.
  test("each host answers its own side alone: the dashboard's serves no site, a site host serves no path of the dashboard, the API, or the preview, and a site's address without its slash, or a private one's from before a reset, leads there", async () => {
    const preview = await openLocal();
    const sites = await listedAt(preview);
    const [deck, report] = [sites["launch-deck"]?.label, sites["sales-report"]?.label];
    const others = [LOCAL.sites, LOCAL.private].flatMap((host) => ["/api/whoami", "/data/sites", "/login/", "/gallery/", "/"].map((path) => `${host}${path}`));
    const asked: readonly (readonly [address: string, answer: Answered, init?: RequestInit])[] = [
      [`${LOCAL.admin}/`, [200, null, true]],
      [`${LOCAL.admin}/lisbon/`, [200, null, true]],
      [`${LOCAL.admin}/${deck}/`, [200, null, true]],
      [`${LOCAL.sites}/lisbon/`, [200, null, false]],
      [`${LOCAL.sites}/${deck}/`, [200, null, false]],
      [`${LOCAL.sites}/${deck}`, [302, `/${deck}/`, false]],
      [`${LOCAL.private}/sales-report--000000000000/q3.html?x=1`, [302, `/${report}/q3.html?x=1`, false]],
      // A link alone opens an unlisted site: one with another id is sent to the login's side, as the product sends it, and finds nothing there.
      [`${LOCAL.sites}/launch-deck--000000000000/deck.js?x=1`, [302, `${LOCAL.private}/launch-deck--000000000000/deck.js?x=1`, false]],
      [`${LOCAL.private}/launch-deck--000000000000/deck.js?x=1`, [404, null, false]],
      [`${LOCAL.private}/${report}/`, [200, null, false]],
      [`${LOCAL.private}/${report}/?as=visitor`, [404, null, false]],
      [`${LOCAL.private}/lisbon/`, [404, null, false]],
      ...others.map((address) => [address, [404, null, false]] as const),
      [`${LOCAL.sites}/reset`, [405, null, false], { method: "POST" }],
    ];
    const answered = await Promise.all(
      asked.map(async ([address, , init]) => {
        const answer = await preview.fetch(new Request(address, init));

        return [address, [answer.status, answer.headers.get("Location"), (await answer.text()).includes("app-test.js")]] as const;
      }),
    );

    expect(answered).toEqual(asked.map(([address, answer]) => [address, answer]));
    // The reset posted to a site host started nothing over: the sample keeps its id.
    expect((await listedAt(preview))["launch-deck"]?.label).toBe(deck);
  });

  // Drift: the layout writes an address and reads it back. One the dashboard shows that a request then reads as another site, or as none, is a Copy button that hands out a dead link.
  test("the address the dashboard gives a private, an unlisted, and a public sample is on the host of its kind, and a request to it is answered with that sample's own page", async () => {
    const preview = await openLocal();
    const [samples, sites] = [await readSamples(), await listedAt(preview)];
    const pageOf = (sample: string): string => new TextDecoder().decode(samples[sample]?.files.find((file) => file.path === "index.html")?.bytes);
    const rows = [
      ["sales-report", "sales-report", `${LOCAL.private}/sales-report--`],
      ["launch-deck", "launch-deck", `${LOCAL.sites}/launch-deck--`],
      ["lisbon-trip", "trip-summary", `${LOCAL.sites}/lisbon/`],
    ] as const;
    const served = await Promise.all(
      rows.map(async ([name, sample, start]) => {
        const url = sites[name]?.url ?? "";
        const answer = await preview.fetch(new Request(url));

        return [name, url.startsWith(start), answer.status, (await answer.text()) === pageOf(sample)];
      }),
    );

    expect(served).toEqual(rows.map(([name]) => [name, true, 200, true]));
  });

  // Drift: without a domain the Link column shows a path of one of the two site hosts. A dashboard that was not told those hosts would read no pasted address, and this kind of install alone would find nothing.
  test("a site's address at one of the two site hosts, pasted into the search of the Sites screen, lists that site alone, and the same path at the dashboard's host lists none", async () => {
    const preview = await openLocal();
    const sites = await listedAt(preview);
    const found = async (typed: string): Promise<readonly string[]> =>
      ((await (await preview.fetch(new Request(`${LOCAL.admin}/data/sites?q=${encodeURIComponent(typed)}`))).json()) as Listed).sites.map((site) => site.name);
    const [lisbon, deck, report] = [sites["lisbon-trip"]?.url ?? "", sites["launch-deck"]?.url ?? "", sites["sales-report"]?.url ?? ""];
    const typed = [lisbon, lisbon.replace("http://", ""), `${lisbon}day-two.html?x=1`, deck, report, report.replace(LOCAL.private, LOCAL.admin)];

    expect(lisbon).toBe(`${LOCAL.sites}/lisbon/`);
    expect(await Promise.all(typed.map(found))).toEqual([["lisbon-trip"], ["lisbon-trip"], ["lisbon-trip"], ["launch-deck"], ["sales-report"], []]);
  });

  // Drift: a link handed out while a site was unlisted must still open once it is private, behind the login, and the other way round. A redirect that dropped the file or the query would land every such link on the site's first page.
  test("a site moved between unlisted and private moves between the two site hosts, and its address at the other host leads to it with the path and the query kept", async () => {
    const preview = await openLocal();
    const before = (await listedAt(preview))["launch-deck"];
    const file = `/${before?.label}/deck.js?x=1`;
    const shut = await changeAt(preview, `/data/sites/${before?.label}/access`, { access: "private" });
    const moved = (await listedAt(preview))["launch-deck"]?.url;
    const old = await preview.fetch(new Request(`${LOCAL.sites}${file}`));
    const opened = await changeAt(preview, `/data/sites/${before?.label}/access`, { access: "unlisted" });
    const back = await preview.fetch(new Request(`${LOCAL.private}${file}`));

    expect([before?.url, shut.status, moved, opened.status]).toEqual([`${LOCAL.sites}/${before?.label}/`, 200, `${LOCAL.private}/${before?.label}/`, 200]);
    expect([old.status, old.headers.get("Location"), back.status, back.headers.get("Location")]).toEqual([302, `${LOCAL.private}${file}`, 302, `${LOCAL.sites}${file}`]);
    expect((await visit(preview, `${LOCAL.private}${file}`)).status).toBe(200);
  });

  // Drift: the app writes every address over https and without a port. One that reached a page, the data, or the API as written would send a browser, or the command line, to a host nothing listens on.
  test("no page and no data of the dashboard names an address of the install as the app writes it, every site's address is at one of the two site origins, and the API says the path layout with the hosts a browser here asks", async () => {
    const preview = await openLocal();
    const sites = Object.values(await listedAt(preview));
    const paths = [...SCREENS, "/data/sites", "/data/sites?view=trash", "/data/activity", "/data/usage", "/data/settings", "/data/domain", "/data/frame", ...sites.map((site) => `/data/sites/${site.label}`)];
    const answers = await Promise.all(
      paths.map(async (path) => {
        const answer = await visit(preview, `${LOCAL.admin}${path}`);

        return [path, await answer.text(), answer.status] as const;
      }),
    );
    const added = await changeAt(preview, "/data/people/add", { login: "nora@sites.localhost" });
    const bearer = { headers: { Authorization: `Bearer ${preview.token()}` } };
    const who = (await (await preview.fetch(new Request(`${LOCAL.admin}/api/whoami`, bearer))).json()) as { readonly layout: unknown };
    const listed = await (await preview.fetch(new Request(`${LOCAL.admin}/api/sites`, bearer))).text();

    expect(sites.length).toBeGreaterThan(8);
    expect(answers.filter(([, , status]) => status !== 200).map(([path]) => path)).toEqual([]);
    expect(answers.flatMap(([path, text]) => (text.match(APP_ADDRESS) ?? []).map((found) => [path, found]))).toEqual([]);
    // An email at a host of the install is no address of a site: it is written back as it was typed.
    expect([added.status, (await added.text()).includes('"nora@sites.localhost"')]).toEqual([200, true]);
    expect(sites.filter((site) => !site.url.startsWith(`${LOCAL.sites}/`) && !site.url.startsWith(`${LOCAL.private}/`))).toEqual([]);
    expect(who.layout).toEqual({ kind: "path", sites_host: "sites.localhost:4400", private_host: "private.localhost:4400" });
    expect([listed.includes(`"${LOCAL.sites}/lisbon/"`), listed.includes("https://")]).toEqual([true, false]);
  });

  // Drift: the gallery's links are written for one origin. On three, a link to a served site that stayed a path of the dashboard's host would open the dashboard's "no such screen".
  test("every link of the gallery answers the status the gallery states, a link to a site at the host that serves it", async () => {
    const preview = await openLocal(true);
    const entries = await preview.entries();
    const answered = await Promise.all(entries.map(async (entry) => [entry.path, (await visit(preview, new URL(entry.path, LOCAL.admin).href)).status] as const));

    expect(entries.filter((entry) => entry.group === "Served sites" && !entry.path.startsWith("http://") && !entry.path.startsWith("/state/"))).toEqual([]);
    expect(answered.filter(([path, status]) => status !== (entries.find((entry) => entry.path === path)?.status ?? 200))).toEqual([]);
  });

  // Drift: the sample site that stands for the demo holds one page, which sends its visitor to the dashboard. Two folders up is the dashboard on one origin; on three it is the root of the sites' host, which serves no site.
  test("the sample site that stands for the demo sends its visitor, and its one link leads, to the dashboard: across to the dashboard's host on three origins, two folders up on one, under a base path too", async () => {
    const base = "/poplin/demo";
    const based = await createPreview({ openDriver: () => new BunSqliteDriver(), samples: await readSamples(), version: VERSION, client: CLIENT, base });
    const rows = [
      [await openLocal(), `${LOCAL.sites}/demo/`, `${LOCAL.admin}/`],
      [await openPreview(false), `${ORIGIN}/served/demo-page/`, `${ORIGIN}/`],
      [based, `${ORIGIN}${base}/served/demo-page/`, `${ORIGIN}${base}/`],
    ] as const;
    const led = await Promise.all(
      rows.map(async ([preview, address]) => {
        const page = await (await preview.fetch(new Request(address))).text();
        const targets = [/url=([^"]+)"/.exec(page)?.[1], /href="([^"]+)"/.exec(page)?.[1]].map((target) => new URL(target ?? "missing", address).href);
        const opened = await Promise.all(targets.map(async (target) => (await (await preview.fetch(new Request(target))).text()).includes("app-test.js")));

        return [targets, opened];
      }),
    );

    expect(led).toEqual(rows.map(([, , home]) => [[home, home], [true, true]]));
  }, SEED_MS);

  // Drift: the seed's remembered check and the Domain screen's own runs are two plugs. One of them left on the pieces of an install under a domain would list records and routes that an install without one cannot have.
  test("the check the seed remembers and a Check on the Domain screen name the same pieces, none of them a piece of an install under a domain but the login's, and the token form asks for no domain", async () => {
    const preview = await openLocal();
    const pieces = (rows: readonly { readonly piece: string }[]): readonly string[] => rows.map((row) => row.piece);
    const seeded = (await (await preview.fetch(new Request(`${LOCAL.admin}/data/domain`))).json()) as { form: { tokenNote: string }; last: { rows: [] } };
    const run = await changeAt(preview, "/data/domain/check", {});
    const checked = pieces(((await run.json()) as { rows: [] }).rows);
    const ofDomain = pieces(((await (await change(await openPreview(false), "/data/domain/check", { token: "sample-token" })).json()) as { rows: [] }).rows);

    expect([run.status, checked.length > 0, pieces(seeded.last.rows)]).toEqual([200, true, checked]);
    expect([checked.filter((piece) => ofDomain.includes(piece) && !piece.startsWith("Login")), seeded.form.tokenNote.includes("domain")]).toEqual([[], false]);
  }, SEED_MS);

  // Drift: the flag is read by the command, which alone knows the port the three hosts answer on. A flag it dropped would start the install with a domain, and one that wrote another port would list sites nothing serves.
  test("the command started with --no-domain lists its sites at the sites host of its own port, serves one there, and its dashboard host does not", async () => {
    const port = freePort();
    const ask = (host: string, path: string): Promise<Response> => fetch(`http://${HOST}:${port}${path}`, { headers: { Host: `${host}.localhost:${port}` }, redirect: "manual" });

    try {
      await start(port, undefined, ["--no-domain"]);
      const listed = (await (await ask("poplin", "/data/sites?access=public&sort=name&dir=asc")).json()) as Listed;
      const [site, home] = [await ask("sites", "/lisbon/"), await ask("poplin", "/lisbon/")];

      expect(listed.sites.map((each) => each.url)).toContain(`http://sites.localhost:${port}/lisbon/`);
      expect([site.status, (await site.text()).includes("<script"), home.status, (await shellOf(await home.text())).files.length]).toEqual([200, false, 200, 2]);
    } finally {
      await stopRunning(port);
    }

    expect(existsSync(pidFile(port))).toBe(false);
  }, 90_000);
});
