// Scope: the pages are asked in process, as a browser would ask them. One test starts the real command on free ports; watch mode is not started here.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { BunSqliteDriver } from "../packages/core/tests/database/support/bun-sqlite-driver";
import { createPreview } from "../packages/demo/src/preview/preview";
import { HOST, PID_PATH, pidFile, stopRunning } from "../packages/demo/scripts/running";
import { readSamples } from "../packages/demo/scripts/samples";
import { plantedRepository, repositoryFiles } from "./support/repository-files";

/** The version the demo's installs are told they run. */
const VERSION = "1.0.0";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The source of the demo: the module every host runs, and the host that runs it in a browser with no server. */
const DEMO_SOURCE = new Bun.Glob("packages/demo/src/*/*.ts");

/** What only one runtime has: its own modules and globals. */
const RUNTIME_NAME = /\bBun\.|["'](?:bun|node):|\bprocess\.|import\.meta\.(?:dir|path|main)|\bBuffer\b/g;

/** An import: the first group is what it names. */
const IMPORT = /from "([^"]+)"/g;

/** Where the demo may import from: its own two folders, the portable source of the app and of core, and SQLite built for a browser. */
const PORTABLE_IMPORT = /^(?:\.\/|\.\.\/(?:preview|browser)\/|\.\.\/\.\.\/\.\.\/(?:app|core)\/src\/|sql\.js(?:\/dist\/sql-wasm-browser\.js)?$)/;

/** The command that starts a preview. */
const SERVE = join(import.meta.dir, "..", "packages", "demo", "scripts", "serve.ts");

/** How long a started preview is given to answer, in milliseconds. */
const START_MS = 10_000;

/** The origin the test asks the preview at. */
const ORIGIN = "http://127.0.0.1:4400";

/** The most redirects one link is followed through. */
const MAX_HOPS = 4;

/** More pages than a click-through from the home page reaches. */
const MAX_PAGES = 600;

/** A link of a page: the value of an `href` that is a path of the preview. */
const LOCAL_LINK = /href="(\/[^"]*)"/g;

/** Any address of the install's own domain, which no local page may send a browser to. */
const INSTALL_ADDRESS = /(?:href|action|formaction)="[^"]*example\.com[^"]*"/g;

/** What the demo's source in a repository names of one runtime, and what it imports from outside the places it may, each as `[file, what]`; `files` counts the files read. */
async function demoReach(root: string): Promise<{ files: number; runtime: string[][]; imports: string[][] }> {
  const files = repositoryFiles(root).filter((path) => DEMO_SOURCE.match(path));
  const texts = await Promise.all(files.map(async (file) => [file, await Bun.file(join(root, file)).text()] as const));
  const imports = texts.flatMap(([file, text]) => Array.from(text.matchAll(IMPORT), ([, path = ""]) => [file, path]));

  return {
    files: files.length,
    runtime: texts.flatMap(([file, text]) => (text.match(RUNTIME_NAME) ?? []).map((found) => [file, found])),
    imports: imports.filter(([, path = ""]) => !PORTABLE_IMPORT.test(path)),
  };
}

/** Follow a path through its redirects, as a browser would. */
async function open(preview: Awaited<ReturnType<typeof createPreview>>, path: string): Promise<Response> {
  let response = await preview.fetch(new Request(`${ORIGIN}${path}`));

  for (let hop = 0; hop < MAX_HOPS && response.status >= 300 && response.status < 400; hop += 1) {
    response = await preview.fetch(new Request(new URL(response.headers.get("Location") ?? "", `${ORIGIN}${path}`)));
  }

  return response;
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

/** Whether a page that is no 200 is the product's own answer: a refused login, or serving's one 404 for a site that is expired or in the trash, which the Sites table links all the same. */
function isHonest(path: string, status: number): boolean {
  if (path.includes("preview-login=refused")) return status === 403;

  return status === 404 && (path.startsWith("/served/") || path.startsWith("/login?return=%2Fserved%2F"));
}

/** Open the demo as the command does: over bun's SQLite and the real sample sites. */
async function openPreview(gallery: boolean): Promise<Awaited<ReturnType<typeof createPreview>>> {
  return createPreview({ openDriver: () => new BunSqliteDriver(), samples: await readSamples(), version: VERSION, gallery });
}

describe("the local preview", () => {
  test("two previews run side by side on two ports, a second start on a port replaces the first, and a stop leaves no server and no pid file: without this a restart leaves a stray server behind", async () => {
    const [one, other] = [freePort(), freePort()];

    try {
      const first = await start(one);
      const beside = await start(other);
      const second = await start(one, first);

      expect(new Set([first, beside, second]).size).toBe(3);
      expect((await fetch(`http://${HOST}:${other}/`)).status).toBe(200);
      expect(await stopRunning(one)).toBe(second);
      expect(await fetch(`http://${HOST}:${one}/`).catch(() => "gone")).toBe("gone");
      expect(await stopRunning(other)).toBe(beside);
    } finally {
      await Promise.all([stopRunning(one), stopRunning(other)]);
    }

    expect([one, other].map((port) => existsSync(pidFile(port)))).toEqual([false, false]);
  }, 30_000);

  test("the seed runs and every link of the gallery answers the status the gallery states: without this a change to the app leaves the preview with dead pages", async () => {
    const preview = await openPreview(true);
    const entries = await preview.entries();
    const gallery = await (await open(preview, "/gallery")).text();
    const answered = await Promise.all(entries.map(async (entry) => [entry.path, (await open(preview, entry.path)).status] as const));

    expect(entries.length).toBeGreaterThan(80);
    expect(entries.filter((entry) => !gallery.includes(`href="${Bun.escapeHTML(entry.path)}"`))).toEqual([]);
    expect(answered.filter(([path, status]) => status !== (entries.find((entry) => entry.path === path)?.status ?? 200))).toEqual([]);
  });

  test("under a base path every link, form, redirect, and written address carries the base, and a demo its host already holds is not seeded again: without this a host that cannot give the demo its root shows links that leave it", async () => {
    const base = "/poplin/demo";
    const drivers = [new BunSqliteDriver(), new BunSqliteDriver()];
    const [seeded] = drivers;
    const host = { samples: await readSamples(), version: VERSION, gallery: false, base };
    const first = await createPreview({ ...host, openDriver: () => drivers.shift() ?? new BunSqliteDriver() });
    const resumed = await createPreview({ ...host, resumed: true, openDriver: () => seeded ?? new BunSqliteDriver() });
    const home = await (await first.fetch(new Request(`${ORIGIN}${base}/`))).text();
    const paths = Array.from(home.matchAll(/(?:href|action)="([^"#]*)"/g), ([, path = ""]) => path);
    const [, page = ""] = /href="([^"]*\/sites\/sales-report--[^"]*)"/.exec(home) ?? [];
    const again = await (await resumed.fetch(new Request(`${ORIGIN}${base}/`))).text();
    const stranger = await first.fetch(new Request(`${ORIGIN}${base}/settings?as=visitor`));

    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter((path) => !path.startsWith(`${base}/`))).toEqual([]);
    expect(home).toContain(`127.0.0.1:4400${base}/served/lisbon-page/`);
    expect((await first.fetch(new Request(`${ORIGIN}${page}`))).status).toBe(200);
    expect([stranger.status, stranger.headers.get("Location")]).toEqual([302, `${base}/login?return=%2Fsettings`]);
    expect((await first.fetch(new Request(`${ORIGIN}${base}/setup`))).headers.get("Location")).toBe(`${base}/setup/fresh`);
    expect((await first.fetch(new Request(`${ORIGIN}/settings`))).status).toBe(404);
    expect(again).toContain(page);
  });

  test("the bar's scheme switch on the answer to a form comes back to a page that can be opened: without this a change of scheme after a check lands on an address only a form reaches", async () => {
    const preview = await openPreview(false);
    const answer = await (await open(preview, "/state/domain/check")).text();
    const [, back = ""] = /href="(\/theme\/dark\?to=[^"]*)"/.exec(answer) ?? [];

    expect(decodeURIComponent(back)).toBe("/theme/dark?to=/state/domain/check");
    expect((await open(preview, back)).status).toBe(200);
  });

  test("clicking on from the home page reaches only pages that answer, carry the bar, and name no hostname of the install: without this a click leaves for a hostname that does not exist, or ends where nothing leads back", async () => {
    const preview = await openPreview(false);
    const stated = new Map((await preview.entries()).map((entry) => [entry.path, entry.status ?? 200]));
    const seen = new Map<string, { readonly status: number; readonly text: string; readonly type: string }>();
    const waiting = ["/"];

    for (let path = waiting.pop(); path !== undefined && seen.size < MAX_PAGES; path = waiting.pop()) {
      const response = await open(preview, path);
      const page = { status: response.status, type: response.headers.get("Content-Type") ?? "", text: await response.text() };
      const links = Array.from(page.text.matchAll(LOCAL_LINK), ([, link = ""]) => link.replaceAll("&amp;", "&"));
      seen.set(path, page);
      waiting.push(...links.filter((link) => !seen.has(link) && !waiting.includes(link) && !link.startsWith("/theme/")));
    }

    const pages = [...seen];
    const html = pages.filter(([, page]) => page.type.startsWith("text/html"));

    expect(pages.filter(([path, page]) => page.status !== (stated.get(path) ?? 200) && !isHonest(path, page.status)).map(([path, page]) => [path, page.status])).toEqual([]);
    expect(html.flatMap(([path, page]) => (page.text.match(INSTALL_ADDRESS) ?? []).map((found) => [path, found]))).toEqual([]);
    expect(html.filter(([, page]) => !page.text.includes('id="preview-bar"')).map(([path]) => path)).toEqual([]);
    expect(["/", "/tokens", "/settings", "/activity", "/usage", "/domain", "/setup/fresh", "/state/allow/waiting", "/?view=trash"].filter((path) => !seen.has(path))).toEqual([]);
    expect([...seen.keys()].filter((path) => path.startsWith("/gallery"))).toEqual([]);
    expect((await open(preview, "/gallery")).status).toBe(404);
    expect(pages.filter(([path]) => path.startsWith("/served/")).length).toBeGreaterThan(8);
    expect(seen.size).toBeLessThan(MAX_PAGES);
  });

  test("the demo names no runtime and imports only portable source, its own files, and SQLite: without this it stops running in a browser or a Worker the day someone reaches for a file or a process", async () => {
    const { files, runtime, imports } = await demoReach(ROOT);

    expect(files).toBeGreaterThan(5);
    expect(runtime).toEqual([]);
    expect(imports).toEqual([]);
  });

  // Drift: a guard that lists the disk reads what is no part of the repository, and fails in the one checkout that holds it.
  test("a runtime's name and an import from outside are named in a new file not yet added, and not in a file the repository is told to leave out or in a build folder", async () => {
    const reach = 'import { readFileSync } from "node:fs";\n';
    using tree = plantedRepository(
      {
        "packages/demo/src/preview/added.ts": reach,
        "packages/demo/src/preview/scratch.ts": reach,
        "packages/demo/src/built/bundle.ts": reach,
      },
      { excluded: ["scratch.ts"], ignored: ["built/"] },
    );

    expect(await demoReach(tree.path)).toEqual({
      files: 1,
      runtime: [["packages/demo/src/preview/added.ts", '"node:']],
      imports: [["packages/demo/src/preview/added.ts", "node:fs"]],
    });
  });

  test("a form sent from a preview page changes the install, and a reset brings the sample data back: without this the forms are pictures", async () => {
    const preview = await openPreview(false);
    const page = (await preview.entries()).find((entry) => entry.name.startsWith("Private, three versions"))?.path ?? "";
    const [, csrf = ""] = /name="csrf" value="([^"]+)"/.exec(await (await open(preview, page)).text()) ?? [];
    const sent = await preview.fetch(
      new Request(`${ORIGIN}${page}/delete`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf }).toString(),
      }),
    );

    expect([sent.status, sent.headers.get("Location")]).toEqual([303, `${page}?done=trashed`]);
    expect(await (await open(preview, "/?view=trash")).text()).toContain("sales-report");

    await preview.fetch(new Request(`${ORIGIN}/reset`, { method: "POST" }));

    expect(await (await open(preview, "/?view=trash")).text()).not.toContain("sales-report");
  });

  test("the API takes the seeded admin token and writes addresses of the preview: without this the printed token and the listed addresses are of no use", async () => {
    const preview = await openPreview(false);
    const listed = await preview.fetch(new Request(`${ORIGIN}/api/sites`, { headers: { Authorization: `Bearer ${preview.token()}` } }));
    const text = await listed.text();

    expect(listed.status).toBe(200);
    expect(text).toContain(`"${ORIGIN}/served/lisbon-page/"`);
    expect(text).not.toContain("https://");
  });
});
