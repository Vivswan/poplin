import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type Dirent, existsSync, promises as fs, mkdirSync, mkdtempDisposableSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

import { readFiles } from "../../src/files/read";

const PAGE = "<!doctype html><title>Notes</title>";
const MANY = 5000;
const WINDOWS = process.platform === "win32";
const POSIX_ONLY: ReadonlySet<string> = new Set(["a link to a system file", "a file with a line break in its name"]);
const UNREADABLE = WINDOWS ? undefined : 0o000;

/** A fixture entry: a file's text, or where a link points; a target starting with `/` is kept, any other is joined to the fixture's root. */
type Entry = string | { readonly link: string };

type Layout = Readonly<Record<string, Entry>>;

interface Listed {
  readonly path: string;
  readonly size: number;
  readonly contentType: string;
}

function build(root: string, layout: Layout): void {
  for (const [path, entry] of Object.entries(layout)) {
    const at = join(root, path);
    mkdirSync(dirname(at), { recursive: true });

    if (typeof entry === "string") {
      writeFileSync(at, entry);
      continue;
    }

    const target = entry.link.startsWith("/") ? entry.link : join(root, entry.link);
    // Windows wants the kind of link said, and cannot tell it from a target that is missing.
    symlinkSync(target, at, existsSync(target) && statSync(target).isDirectory() ? "dir" : "file");
  }
}

/** A refusal as every platform would word it: the fixture's own path cut out, and `/` between a path's parts. */
function portable(reason: string, root: string): string {
  const quoted = JSON.stringify(root).slice(1, -1);
  const rootless = reason.replaceAll(quoted, "<root>");
  if (sep === "/") return rootless;

  return rootless.replaceAll(JSON.stringify(sep).slice(1, -1), "/");
}

/** Runs `readFiles` on a fixture that is removed whatever happens, with the fixture's own path cut out of the answer. */
async function listing(layout: Layout, target: string): Promise<unknown> {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-files-"));
  const root = await fs.realpath(scratch.path);
  build(root, layout);

  const listed = await readFiles(join(root, target));
  if (!listed.ok) return { ok: false, reason: portable(listed.reason, root) };

  const files: Listed[] = listed.files.map(({ path, size, contentType }) => ({ path, size, contentType }));

  return { ...listed, files };
}

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

afterEach(() => {
  spyOn(fs, "readdir").mockRestore();
});

describe("readFiles on a folder", () => {
  test("lists every file but hidden ones and node_modules: without this a publish uploads a secret or a dependency tree", async () => {
    const layout: Layout = {
      "site/index.html": PAGE,
      "site/css/site.css": "body{}",
      "site/js/app.js": "1",
      "site/img/logo.png": "png",
      "site/LICENSE": "free",
      "site/txt": "a file named like an extension",
      "site/notes.unknownext": "?",
      "site/\uff21.txt": "wide",
      "site/\u{1f600}.txt": "astral",
      "site/.env": "TOKEN=1",
      "site/.git/config": "[core]",
      "site/.DS_Store": "",
      "site/docs/.draft.html": "hidden page",
      "site/node_modules/left/index.js": "0",
      "site/a/b/c/node_modules/deep/index.js": "0",
      "site/a/b/c/kept.txt": "kept",
    };

    expect(await listing(layout, "site")).toEqual({
      ok: true,
      files: [
        { path: "LICENSE", size: 4, contentType: "application/octet-stream" },
        { path: "a/b/c/kept.txt", size: 4, contentType: "text/plain" },
        { path: "css/site.css", size: 6, contentType: "text/css" },
        { path: "img/logo.png", size: 3, contentType: "image/png" },
        { path: "index.html", size: 35, contentType: "text/html" },
        { path: "js/app.js", size: 1, contentType: "text/javascript" },
        { path: "notes.unknownext", size: 1, contentType: "application/octet-stream" },
        { path: "txt", size: 30, contentType: "application/octet-stream" },
        // A store lists by UTF-8 bytes, where U+FF21 comes before U+1F600; by UTF-16 units it would come after.
        { path: "\uff21.txt", size: 4, contentType: "text/plain" },
        { path: "\u{1f600}.txt", size: 6, contentType: "text/plain" },
      ],
      count: 10,
      bytes: 94,
      skipped: 6,
      name: { ok: true, value: "site" },
    });
  });

  test("follows a link that stays inside the folder, to a file or to a folder: without this a linked asset folder silently drops out of the site", async () => {
    const layout: Layout = {
      "site/index.html": PAGE,
      "site/shared/logo.svg": "<svg/>",
      "site/logo.svg": { link: "site/shared/logo.svg" },
      "site/assets": { link: "site/shared" },
    };

    expect(await listing(layout, "site")).toMatchObject({
      files: [
        { path: "assets/logo.svg", size: 6, contentType: "image/svg+xml" },
        { path: "index.html", size: 35, contentType: "text/html" },
        { path: "logo.svg", size: 6, contentType: "image/svg+xml" },
        { path: "shared/logo.svg", size: 6, contentType: "image/svg+xml" },
      ],
      count: 4,
      bytes: 53,
    });
  });

  test("lists 5,000 files in store order without opening one: without this a large site is read into memory before a byte is sent", async () => {
    // Where the platform can forbid reading a file, none here may be read: a listing that opened one would fail.
    using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-files-"));
    const names = Array.from(Array(MANY).keys(), (index) => `${String(index % 50).padStart(2, "0")}/${String(index).padStart(4, "0")}.txt`);
    writeFileSync(join(scratch.path, "index.html"), PAGE, { mode: UNREADABLE });

    for (const name of [...names].reverse()) {
      mkdirSync(dirname(join(scratch.path, name)), { recursive: true });
      writeFileSync(join(scratch.path, name), "x", { mode: UNREADABLE });
    }

    // Written out by hand: folder 00 holds 0000, 0050, 0100 and so on, and a store lists folder by folder.
    const folders = Array.from(Array(50).keys(), (folder) => names.filter((name) => name.startsWith(`${String(folder).padStart(2, "0")}/`)));
    const listed = await readFiles(scratch.path);
    const paths = listed.ok ? listed.files.map((file) => file.path) : listed.reason;

    expect<unknown>(paths).toEqual([...folders.flat(), "index.html"]);
    expect(listed).toMatchObject({ count: MANY + 1, bytes: MANY + PAGE.length });
  }, 60_000);

  test("opens a listed file as its bytes, again on every call: without this an upload retry would send an empty body", async () => {
    using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-files-"));
    build(scratch.path, { "index.html": PAGE, "data/rows.csv": "a,b\n1,2\n" });

    const listed = await readFiles(scratch.path);
    if (!listed.ok) throw new Error(listed.reason);
    const [rows] = listed.files;

    expect([rows?.path, await text(rows?.open() as ReadableStream<Uint8Array>), await text(rows?.open() as ReadableStream<Uint8Array>)]).toEqual([
      "data/rows.csv",
      "a,b\n1,2\n",
      "a,b\n1,2\n",
    ]);
  });
});

describe("readFiles on one page", () => {
  test("publishes the page as index.html and leaves its siblings behind: without this a page in a downloads folder publishes the folder", async () => {
    const layout: Layout = { "work/Q3-Report.HTML": PAGE, "work/private.txt": "sibling", "work/index.html": "another page, twice as long as the first one" };

    expect(await listing(layout, "work/Q3-Report.HTML")).toEqual({
      ok: true,
      files: [{ path: "index.html", size: 35, contentType: "text/html" }],
      count: 1,
      bytes: 35,
      skipped: 0,
      name: { ok: true, value: "q3-report" },
    });
  });
});

describe("readFiles refusals", () => {
  // Drift: each row is a way a file the user did not mean to publish, or one no store can keep, would otherwise reach the upload.
  const rows: ReadonlyArray<readonly [string, Layout, string, unknown]> = [
    ["a path that does not exist", {}, "missing", '"<root>/missing" does not exist'],
    ["a single file that is not HTML", { "notes.md": "# notes" }, "notes.md", '"<root>/notes.md" is not a folder or an .html file'],
    [
      "a folder with a page but no index.html at its top",
      { "site/about.html": PAGE, "site/docs/index.html": PAGE },
      "site",
      'the folder "<root>/site" has no index.html at its top',
    ],
    ["a folder whose index.html is a folder", { "site/index.html/page.html": PAGE }, "site", 'the folder "<root>/site" has no index.html at its top'],
    [
      "a folder that is empty once hidden files and node_modules are left out",
      { "site/.env": "TOKEN=1", "site/node_modules/index.html": PAGE, "site/.well-known/index.html": PAGE },
      "site",
      'the folder "<root>/site" holds nothing to publish; hidden files and node_modules are never sent',
    ],
    [
      "a link to a system file",
      { "site/index.html": PAGE, "site/hosts.txt": { link: "/etc/hosts" } },
      "site",
      expect.stringMatching(/^the link "hosts\.txt" points outside the folder, at "(\/private)?\/etc\/hosts"; remove it$/),
    ],
    [
      "a link to a folder beside the folder",
      { "site/index.html": PAGE, "sitemap/secret.txt": "s", "site/more": { link: "sitemap" } },
      "site",
      'the link "more" points outside the folder, at "<root>/sitemap"; remove it',
    ],
    [
      "a link below the top that climbs out",
      { "site/index.html": PAGE, "site/a/b/up": { link: "." } },
      "site",
      'the link "a/b/up" points outside the folder, at "<root>"; remove it',
    ],
    [
      "a page that is itself a link",
      { "site/secret.txt": "s", "page.html": { link: "site/secret.txt" } },
      "page.html",
      '"<root>/page.html" is a link, to "<root>/site/secret.txt"; name the page itself',
    ],
    [
      "a link back to a folder that holds it",
      { "site/index.html": PAGE, "site/a/b/loop": { link: "site/a" } },
      "site",
      'the link "a/b/loop" loops back to a folder that holds it; remove it',
    ],
    [
      "a link to the folder itself",
      { "site/index.html": PAGE, "site/self": { link: "site" } },
      "site",
      'the link "self" loops back to a folder that holds it; remove it',
    ],
    [
      "a link to itself",
      { "site/index.html": PAGE, "site/again": { link: "site/again" } },
      "site",
      expect.stringMatching(/^the link "again" cannot be followed \([A-Z]+\); fix or remove it$/),
    ],
    [
      "a link to a missing file",
      { "site/index.html": PAGE, "site/gone.css": { link: "site/removed.css" } },
      "site",
      expect.stringMatching(/^the link "gone\.css" cannot be followed \([A-Z]+\); fix or remove it$/),
    ],
    [
      "a link with a plain name to a hidden file",
      { "site/index.html": PAGE, "site/.env": "TOKEN=1", "site/settings.txt": { link: "site/.env" } },
      "site",
      'the link "settings.txt" points at ".env", which is hidden or under node_modules; remove it',
    ],
    [
      "a link into node_modules",
      { "site/index.html": PAGE, "site/node_modules/left/index.js": "0", "site/vendor": { link: "site/node_modules/left" } },
      "site",
      'the link "vendor" points at "node_modules/left", which is hidden or under node_modules; remove it',
    ],
    [
      "a name holding the mark Node leaves for bytes that are not UTF-8",
      { "site/index.html": PAGE, "site/docs/\ufffd.txt": "x" },
      "site",
      '"docs/\ufffd.txt" has a name that is not valid text; rename or remove it',
    ],
    [
      "a file whose name decodes to a parent folder",
      { "site/index.html": PAGE, "site/docs/%2e%2E/page.html": PAGE },
      "site",
      'the file "docs/%2e%2E/page.html" has a name that cannot be stored (dot-segment); rename or remove it',
    ],
    [
      "a file with a line break in its name",
      { "site/index.html": PAGE, "site/two\nlines.txt": "x" },
      "site",
      'the file "two\\nlines.txt" has a name that cannot be stored (bad-character); rename or remove it',
    ],
    [
      "a file whose name is not in the form a store keeps",
      { "site/index.html": PAGE, "site/resume\u0301.txt": "x" },
      "site",
      'the file "resume\u0301.txt" has a name that cannot be stored (not-normalized); rename or remove it',
    ],
  ];

  for (const [mistake, layout, target, reason] of rows) {
    // Windows has no /etc/hosts and allows no line break in a file name.
    test.skipIf(WINDOWS && POSIX_ONLY.has(mistake))(`refuses ${mistake}`, async () => {
      expect(await listing(layout, target)).toEqual({ ok: false, reason });
    });
  }

  test("refuses a file named with half a surrogate pair: without this a Windows file name reaches the store as a key it cannot keep", async () => {
    // No POSIX file system hands Node such a name, so the folder's entries are stood in for.
    const entry = { name: "half\ud800.txt", isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false } as Dirent;
    spyOn(fs, "readdir").mockResolvedValue([entry] as never);

    expect(await listing({ "site/index.html": PAGE }, "site")).toEqual({
      ok: false,
      reason: 'the file "half\\ud800.txt" has a name that cannot be stored (bad-character); rename or remove it',
    });
  });
});

describe("readFiles default name", () => {
  // Drift: the name becomes a hostname label, so a folder name core refuses must ask for --name, never guess one or stop the listing.
  test.each([
    ["q3-report", { ok: true, value: "q3-report" }],
    ["Field-Notes", { ok: true, value: "field-notes" }],
    ["My Site", { ok: false, reason: 'no usable name, pass --name: "My Site" cannot name a site (bad-character)' }],
    ["q3", { ok: false, reason: 'no usable name, pass --name: "q3" cannot name a site (too-short)' }],
  ] as ReadonlyArray<readonly [string, unknown]>)("of a folder called %j", async (folder, name) => {
    expect(await listing({ [`${folder}/index.html`]: PAGE }, folder)).toMatchObject({ ok: true, count: 1, name });
  });
});
