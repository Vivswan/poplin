import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishedPins } from "../packages/core/src/records/release";
import { publishedRelease } from "../packages/core/src/records/update";
import { newestRelease } from "../website/src/lib/changelog";

const ROOT = join(import.meta.dir, "..");

const WEBSITE = join(ROOT, "website");

const SITE = { PAGES_ORIGIN: "https://site.example.com", PAGES_BASE_PATH: "/poplin/" };

const BUILD_SETTINGS = ["DEMO_URL", "POPLIN_CHANGELOG", "POPLIN_RELEASE_PINS", "PAGES_ORIGIN", "PAGES_BASE_PATH"];

const DEMO = "https://demo-page.example.com/";

const PAGES = ["index.html", "404.html"];

const BUILDS: readonly (readonly [what: string, value: string | undefined, links: readonly string[]])[] = [
  ["no value", undefined, []],
  ["an https address", DEMO, [DEMO]],
  ["an address that is not https", "http://demo-page.example.com/", []],
  ["a value that is no address", "demo-page", []],
];

const FIRST_RELEASE = `## 0.1.0 (2026-11-20)


### Features

* a folder becomes a site with one call ([1a2b3c4](https://github.com/example/poplin/commit/1a2b3c4))
`;

const LATER_RELEASE = `## [0.2.0](https://github.com/example/poplin/compare/v0.1.0...v0.2.0) (2026-12-04)


### Bug Fixes

* an empty folder is refused ([4f5e6d7](https://github.com/example/poplin/commit/4f5e6d7))

`;

const DIGEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const FIRST_NEWS = { version: "0.1.0", released: "2026-11-20", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.1.0" };

const LATER_NEWS = { version: "0.2.0", released: "2026-12-04", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.2.0" };

const CHANGELOGS: readonly {
  readonly what: string;
  readonly changelog: string;
  readonly pins: Readonly<Record<string, { source: string }>> | undefined;
  readonly foot: string;
  readonly latest: unknown;
  readonly read: ReturnType<typeof publishedRelease>;
}[] = [
  { what: "no version released", changelog: "# Changelog\n", pins: {}, foot: "poplin", latest: { version: null }, read: null },
  { what: "one version, its digest published", changelog: `# Changelog\n\n${FIRST_RELEASE}`, pins: { "0.1.0": { source: DIGEST } }, foot: "poplin 0.1.0", latest: FIRST_NEWS, read: { ...FIRST_NEWS, database: false } },
  {
    what: "two versions, both digests published",
    changelog: `# Changelog\n\n${LATER_RELEASE}${FIRST_RELEASE}`,
    pins: { "0.2.0": { source: DIGEST }, "0.1.0": { source: DIGEST } },
    foot: "poplin 0.2.0",
    latest: LATER_NEWS,
    read: { ...LATER_NEWS, database: false },
  },
  {
    what: "two versions, the newer with no digest published",
    changelog: `# Changelog\n\n${LATER_RELEASE}${FIRST_RELEASE}`,
    pins: { "0.1.0": { source: DIGEST } },
    foot: "poplin 0.1.0",
    latest: FIRST_NEWS,
    read: { ...FIRST_NEWS, database: false },
  },
  { what: "one version, in a build with no step that looks for digests", changelog: `# Changelog\n\n${FIRST_RELEASE}`, pins: undefined, foot: "poplin", latest: { version: null }, read: null },
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
    "holds no copy of the demo, and links to the running one, from the top of every page and from the home page, only at an https address it was given (%s): without this a build puts the demo back on the site, or a page gets a dead link",
    (what, value, links) => {
      using site = mkdtempDisposableSync(join(tmpdir(), "poplin-website-"));
      build(site.path, { DEMO_URL: value });
      const pages = PAGES.map((page) => readFileSync(join(site.path, page), "utf8"));

      expect(existsSync(join(site.path, "demo")), what).toBe(false);
      expect(pages.map((page) => demoLinks(page, "header nav"))).toEqual(PAGES.map(() => [...links]));
      expect(demoLinks(pages[0] ?? "", "main")).toEqual([...links]);
    },
    120_000,
  );

  test.each(CHANGELOGS)(
    "names in releases.json every release whose digest was found, and in latest.json and the footer the newest of those alone ($what): without this an install is told of a release its build refuses, or of one that was never released",
    ({ what, changelog, pins, foot, latest, read }) => {
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
      expect(publishedPins(readFileSync(join(site.path, "releases.json"), "utf8")), "what a build reads as the releases it may take").toEqual(pins ?? {});
      expect(footLine(readFileSync(join(site.path, "index.html"), "utf8")), what).toBe(foot);
      expect(existsSync(join(site.path, "changelog")), "the release notes are on the repository, not the site").toBe(false);
    },
    120_000,
  );
});

describe("the changelog", () => {
  test("names the version the release tooling records as the newest: without this latest.json tells installs of a version that was never released, or hides one that was", () => {
    const file = join(ROOT, "CHANGELOG.md");
    const newest = newestRelease(existsSync(file) ? readFileSync(file, "utf8") : "");
    const manifest: Record<string, string> = JSON.parse(readFileSync(join(ROOT, ".release-please-manifest.json"), "utf8"));

    expect(newest?.version ?? "0.0.0").toBe(manifest["."] ?? "");
  });
});
