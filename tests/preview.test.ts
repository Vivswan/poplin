// Scope: the preview is asked in process, as a browser and the dashboard's client would ask it. One test starts the real command on free ports; watch mode is not started here.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readShell } from "../packages/app/tests/console/support/shell";
import { BunSqliteDriver } from "../packages/core/tests/database/support/bun-sqlite-driver";
import { withAddresses } from "../packages/demo/src/preview/addresses";
import { createPreview } from "../packages/demo/src/preview/preview";
import { readRealSites } from "../packages/demo/src/preview/real-sites";
import { HOST, PID_PATH, pidFile, stopRunning } from "../packages/demo/scripts/running";
import { readSamples } from "../packages/demo/scripts/samples";
import { plantedLint } from "./support/planted-lint";

/** The version the demo's installs are told they run. */
const VERSION = "1.0.0";

/** The command that starts a preview. */
const SERVE = join(import.meta.dir, "..", "packages", "demo", "scripts", "serve.ts");

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

/** Start the preview's command on a port and wait until a preview other than `before` answers there with its pid. */
async function start(port: number, before?: number): Promise<number> {
  Bun.spawn([process.execPath, SERVE, "--port", String(port)], { stdio: ["ignore", "ignore", "inherit"] });

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
    ["the setup screen", "/setup/fresh", [""]],
  ] as const)("every screen of %s answers the page that loads the client under its own place, and its files and its data answer there", async (_, place, screens) => {
    const preview = await openPreview(false);
    const pages = await Promise.all(screens.map(async (screen) => shellOf(await (await open(preview, `${place}${screen}`)).text())));
    const files = await Promise.all((pages[0]?.files ?? []).map(async (file) => [file, (await open(preview, file)).status] as const));
    const asked = place.startsWith("/setup") ? await change(preview, `${place}/data/repair`, { token: "sample-token" }) : await preview.fetch(new Request(`${ORIGIN}${place}/data/sites`));

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
    const stranger = await ask(first, `${base}/empty/settings?as=visitor`);
    const back = await ask(first, `${stranger.headers.get("Location")}&preview-login=admin`);
    const bare = await ask(first, `${(await ask(first, `${base}/empty?as=visitor`)).headers.get("Location")}&preview-login=admin`);
    const links: string[] = [];
    withAddresses(await (await ask(first, (await ask(first, `${base}/settings?as=visitor`)).headers.get("Location") ?? "")).text(), (link) => `${links.push(link)}`);
    const chosen = await ask(first, links.find((link) => link.includes("preview-login=admin"))?.replaceAll("&amp;", "&") ?? "");

    expect([home.boot.base, home.boot.demo?.reset, empty.boot.base, empty.boot.demo?.reset]).toEqual([base, `${base}/reset`, `${base}/empty`, `${base}/empty/reset`]);
    expect(home.files).toEqual([`${base}/assets/app-test.css`, `${base}/assets/app-test.js`]);
    expect((await ask(first, `${base}/assets/app-test.js`)).status).toBe(200);
    expect(listed.sites.map((site) => site.url)).toContain(`${ORIGIN}${base}/served/lisbon-page/`);
    expect([stranger.status, stranger.headers.get("Location")]).toEqual([302, `${base}/empty/login?return=%2Fempty%2Fsettings`]);
    expect([back.status, back.headers.get("Location")]).toEqual([302, `${base}/empty/settings`]);
    expect([bare.status, bare.headers.get("Location")]).toEqual([302, `${base}/empty`]);
    expect([chosen.status, chosen.headers.get("Location")]).toEqual([302, `${base}/settings`]);
    expect((await ask(first, `${base}/setup`)).headers.get("Location")).toBe(`${base}/setup/fresh`);
    expect((await ask(first, "/settings")).status).toBe(404);
    expect(again.sites.map((site) => site.label)).toEqual(listed.sites.map((site) => site.label));
  });

  // Drift: the note of the last check of the domain can only be looked at where an install remembers one. A seed with none, or one a Check could not change, would leave the healthy and the broken state unseen.
  test("the seeded install remembers a healthy domain, a Check on the Domain screen leaves a broken login to act on, and a reset brings the healthy one back", async () => {
    const preview = await openPreview(false);
    const note = async (): Promise<unknown> => {
      const answer = await preview.fetch(new Request(`${ORIGIN}/api/domain`, { headers: { Authorization: `Bearer ${preview.token()}` } }));
      const { check, note: raised } = (await answer.json()) as { check: { run: string; pieces: unknown[] } | null; note: unknown };

      return [answer.status, check?.run, check?.pieces.length, raised];
    };
    const seeded = await note();
    const run = await change(preview, "/data/domain/check", { token: "sample-token" });
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

  // Drift: the session cookie is made for the install's own domain. Handed to a browser at this origin it would be kept for a domain it never asks.
  test("a login on a preview page hands the browser no cookie", async () => {
    const preview = await openPreview(false);
    const login = await preview.fetch(new Request(`${ORIGIN}/login?preview-login=admin`));

    expect([login.status, login.headers.getSetCookie()]).toEqual([302, []]);
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
});
