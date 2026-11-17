import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishedPins } from "../packages/core/src/records/release";
import { publishedRelease } from "../packages/core/src/records/update";
import { newestRelease } from "../website/src/lib/changelog";
import { demoEntry } from "../website/src/lib/demo";

const ROOT = join(import.meta.dir, "..");

const WEBSITE = join(ROOT, "website");

const SITE = { PAGES_ORIGIN: "https://site.example.com", PAGES_BASE_PATH: "/poplin/" };

const BUILD_SETTINGS = ["DEMO_URL", "DEMO_URL_NO_DOMAIN", "POPLIN_CHANGELOG", "POPLIN_RELEASE_PINS", "PAGES_ORIGIN", "PAGES_BASE_PATH"];

const DEMO = "https://demo-page.example.com/";

const PAGES = ["index.html", "404.html"];

const DEMO_NO_DOMAIN = "https://demo-page.example.workers.dev/demo/";

const WITH = { label: "With a domain", href: DEMO };

const WITHOUT = { label: "Without a domain", href: DEMO_NO_DOMAIN };

const ENTRIES: readonly (readonly [what: string, domain: string | undefined, noDomain: string | undefined, entry: ReturnType<typeof demoEntry>])[] = [
  ["neither value", undefined, undefined, { kind: "none" }],
  ["two empty values", "", "", { kind: "none" }],
  ["the domain's alone", DEMO, undefined, { kind: "one", link: WITH }],
  ["the other's alone", undefined, DEMO_NO_DOMAIN, { kind: "one", link: WITHOUT }],
  ["both", DEMO, DEMO_NO_DOMAIN, { kind: "two", links: [WITH, WITHOUT] }],
  ["both, the domain's not https", "http://demo-page.example.com/", DEMO_NO_DOMAIN, { kind: "one", link: WITHOUT }],
  ["both, the other's no address", DEMO, "demo-page", { kind: "one", link: WITH }],
  ["both, neither https", "ftp://demo-page.example.com/", "demo-page", { kind: "none" }],
  ["an address with no closing slash", "https://demo-page.example.com", undefined, { kind: "one", link: WITH }],
];

const BUILDS: readonly {
  readonly what: string;
  readonly domain?: string;
  readonly noDomain?: string;
  readonly bar: readonly string[];
  readonly menu: readonly string[];
  readonly scriptless: readonly string[];
  readonly home: readonly string[];
}[] = [
  { what: "no value", bar: [], menu: [], scriptless: [], home: [] },
  { what: "an https address", domain: DEMO, bar: [DEMO], menu: [], scriptless: [], home: [DEMO] },
  { what: "an address that is not https", domain: "http://demo-page.example.com/", bar: [], menu: [], scriptless: [], home: [] },
  { what: "a value that is no address", domain: "demo-page", bar: [], menu: [], scriptless: [], home: [] },
  { what: "the address without a domain alone", noDomain: DEMO_NO_DOMAIN, bar: [DEMO_NO_DOMAIN], menu: [], scriptless: [], home: [] },
  { what: "both addresses", domain: DEMO, noDomain: DEMO_NO_DOMAIN, bar: [], menu: [DEMO, DEMO_NO_DOMAIN], scriptless: [DEMO], home: [DEMO] },
];

const FIRST_RELEASE = `## 0.1.0 (2026-11-20)


### Features

* a folder becomes a site with one call ([1a2b3c4](https://github.com/example/poplin/commit/1a2b3c4))
`;

const LATER_RELEASE = `## [0.2.0](https://github.com/example/poplin/compare/v0.1.0...v0.2.0) (2026-12-04)


### Bug Fixes

* an empty folder is refused ([4f5e6d7](https://github.com/example/poplin/commit/4f5e6d7))

`;

const BUNDLE_DIGEST = "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae";

const FIRST_NEWS = { version: "0.1.0", released: "2026-11-20", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.1.0", schema: 1 };

const LATER_NEWS = { version: "0.2.0", released: "2026-12-04", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.2.0", schema: 2 };

const FIRST_PIN = { bundle: BUNDLE_DIGEST, schema: 1 };

const LATER_PIN = { bundle: BUNDLE_DIGEST, schema: 2 };

const CHANGELOGS: readonly {
  readonly what: string;
  readonly changelog: string;
  readonly pins: Readonly<Record<string, object>> | undefined;
  readonly named: ReturnType<typeof publishedPins>;
  readonly foot: string;
  readonly latest: unknown;
  readonly read: ReturnType<typeof publishedRelease>;
}[] = [
  { what: "no version released", changelog: "# Changelog\n", pins: {}, named: {}, foot: "poplin", latest: { version: null }, read: null },
  { what: "one version, its digests published", changelog: `# Changelog\n\n${FIRST_RELEASE}`, pins: { "0.1.0": FIRST_PIN }, named: { "0.1.0": FIRST_PIN }, foot: "poplin 0.1.0", latest: FIRST_NEWS, read: FIRST_NEWS },
  {
    what: "two versions, the digests of both published",
    changelog: `# Changelog\n\n${LATER_RELEASE}${FIRST_RELEASE}`,
    pins: { "0.2.0": LATER_PIN, "0.1.0": FIRST_PIN },
    named: { "0.2.0": LATER_PIN, "0.1.0": FIRST_PIN },
    foot: "poplin 0.2.0",
    latest: LATER_NEWS,
    read: LATER_NEWS,
  },
  {
    what: "two versions, the newer with no digest published",
    changelog: `# Changelog\n\n${LATER_RELEASE}${FIRST_RELEASE}`,
    pins: { "0.1.0": FIRST_PIN },
    named: { "0.1.0": FIRST_PIN },
    foot: "poplin 0.1.0",
    latest: FIRST_NEWS,
    read: FIRST_NEWS,
  },
  {
    what: "two versions, the newer with its schema alone and no digest of its built files",
    changelog: `# Changelog\n\n${LATER_RELEASE}${FIRST_RELEASE}`,
    pins: { "0.2.0": { schema: 2 }, "0.1.0": FIRST_PIN },
    named: { "0.1.0": FIRST_PIN },
    foot: "poplin 0.1.0",
    latest: FIRST_NEWS,
    read: FIRST_NEWS,
  },
  { what: "one version, in a build with no step that looks for digests", changelog: `# Changelog\n\n${FIRST_RELEASE}`, pins: undefined, named: {}, foot: "poplin", latest: { version: null }, read: null },
];

/** Builds the website into a folder, with the build settings it is given and no other. */
function build(outDir: string, settings: Record<string, string | undefined>): void {
  const inherited = Object.entries(process.env).filter(([name]) => !BUILD_SETTINGS.includes(name));
  const given = Object.entries(settings).filter(([, value]) => value !== undefined);
  const env = Object.fromEntries([...inherited, ...given]);
  const built = Bun.spawnSync(["bun", "run", "--cwd", WEBSITE, "build", "--outDir", outDir], { env, stdout: "pipe", stderr: "pipe" });

  if (built.exitCode !== 0) {
    throw new Error(`The website did not build: ${built.stderr.toString()}`);
  }
}

/** The addresses that name the demo among the links one part of a page holds, in the order of the page. */
function demoLinks(html: string, part: "header nav" | "main"): string[] {
  const links: string[] = [];
  const anchors = new HTMLRewriter().on(`${part} a[href]`, { element: (anchor) => void links.push(anchor.getAttribute("href") ?? "") });
  anchors.transform(html);

  return links.filter((link) => link.includes("demo-page"));
}

/** The demo's addresses a piece of a page names, in the order it names them. */
function named(piece: string): string[] {
  return [DEMO, DEMO_NO_DOMAIN].filter((address) => piece.includes(address)).sort((one, other) => piece.indexOf(one) - piece.indexOf(other));
}

/** The addresses the top bar's menu is built holding, in its order: the menu's own links exist only once a browser opens it. */
function menuLinks(html: string): string[] {
  const held: string[] = [];
  const islands = new HTMLRewriter().on("header nav li:first-child astro-island[props]", { element: (island) => void held.push(island.getAttribute("props") ?? "") });
  islands.transform(html);

  return named(held.join(""));
}

/** The addresses the top bar links where no script runs, and so no menu opens. */
function scriptlessLinks(html: string): string[] {
  const held: string[] = [];
  const reader = new HTMLRewriter().on("header nav li:first-child noscript", { text: (chunk) => void held.push(chunk.text) });
  reader.transform(html);

  return named(held.join(""));
}

/** The address of the first link of the top bar. */
function firstLink(html: string): string | undefined {
  const links: string[] = [];
  const anchors = new HTMLRewriter().on("header nav a[href]", { element: (anchor) => void links.push(anchor.getAttribute("href") ?? "") });
  anchors.transform(html);

  return links[0];
}

/** The line of a page's footer that names the product and its newest version. */
function footLine(html: string): string {
  let line = "";
  const reader = new HTMLRewriter().on("footer p", {
    text: (chunk) => {
      line += chunk.text;
    },
  });
  reader.transform(html);

  return line.trim();
}

describe("the built website", () => {
  test.each(BUILDS)(
    "holds no copy of the demo, and links to the running one first in the top bar and from the home page, only at an https address it was given, with a menu when given both ($what): without this a page gets a dead link, or one kind's demo is not offered",
    ({ what, domain, noDomain, bar, menu, scriptless, home }) => {
      using site = mkdtempDisposableSync(join(tmpdir(), "poplin-website-"));
      build(site.path, { DEMO_URL: domain, DEMO_URL_NO_DOMAIN: noDomain });
      const pages = PAGES.map((page) => readFileSync(join(site.path, page), "utf8"));

      expect(existsSync(join(site.path, "demo")), what).toBe(false);
      expect(pages.map((page) => demoLinks(page, "header nav"))).toEqual(PAGES.map(() => [...bar]));
      expect(pages.map((page) => menuLinks(page))).toEqual(PAGES.map(() => [...menu]));
      expect(pages.map((page) => scriptlessLinks(page))).toEqual(PAGES.map(() => [...scriptless]));
      if (bar[0] !== undefined) expect(pages.map((page) => firstLink(page))).toEqual(PAGES.map(() => bar[0]));
      expect(demoLinks(pages[0] ?? "", "main")).toEqual([...home]);
    },
    120_000,
  );

  test.each(CHANGELOGS)(
    "names in releases.json every release whose digests and schema were found, and in latest.json and the footer the newest of those ($what): without this an install is told of a release with no attested built files, or of one never released",
    ({ what, changelog, pins, named, foot, latest, read }) => {
      using site = mkdtempDisposableSync(join(tmpdir(), "poplin-website-"));
      using source = mkdtempDisposableSync(join(tmpdir(), "poplin-changelog-"));
      const file = join(source.path, "CHANGELOG.md");
      const pinsFile = join(source.path, "release-pins.json");
      writeFileSync(file, changelog);
      writeFileSync(pinsFile, JSON.stringify(pins ?? {}));
      build(site.path, { ...SITE, POPLIN_CHANGELOG: file, POPLIN_RELEASE_PINS: pins === undefined ? undefined : pinsFile });

      const published = readFileSync(join(site.path, "latest.json"), "utf8");

      expect(JSON.parse(published), what).toEqual(latest);
      expect(publishedRelease(published), "what an install reads from the file").toEqual(read);
      expect(publishedPins(readFileSync(join(site.path, "releases.json"), "utf8")), "what an install reads as the releases it may take").toEqual(named);
      expect(footLine(readFileSync(join(site.path, "index.html"), "utf8")), what).toBe(foot);
      expect(existsSync(join(site.path, "changelog")), "the release notes are on the repository, not the site").toBe(false);
    },
    120_000,
  );
});

describe("the top bar's demo entry", () => {
  test.each(ENTRIES)("is nothing, one link, or a menu of two, from the https addresses among the build's two values (%s): without this the bar offers a dead link, or a menu with one item", (what, domain, noDomain, entry) => {
    expect(demoEntry({ domain, noDomain }), what).toEqual(entry);
  });
});

describe("the changelog", () => {
  test("names the version the release tooling records as the newest: without this latest.json tells installs of a version that was never released, or hides one that was", () => {
    const file = join(ROOT, "CHANGELOG.md");
    const newest = newestRelease(existsSync(file) ? readFileSync(file, "utf8") : "");
    const manifest: Record<string, string> = JSON.parse(readFileSync(join(ROOT, ".release-please-manifest.json"), "utf8"));

    expect(newest?.version ?? "0.0.0").toBe(manifest["."] ?? "");
  });
});
