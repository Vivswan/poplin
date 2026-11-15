import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEBSITE = join(import.meta.dir, "..", "website");

const DEMO = "https://demo-page.example.com/";

const BUILDS: readonly (readonly [what: string, value: string | undefined, links: readonly string[]])[] = [
  ["no value", undefined, []],
  ["an https address", DEMO, [DEMO]],
  ["an address that is not https", "http://demo-page.example.com/", []],
  ["a value that is no address", "demo-page", []],
];

/** Builds the website into a folder, with the address of the running demo the build is given, or none. */
function build(outDir: string, demoUrl: string | undefined): void {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "DEMO_URL"));
  const env = demoUrl === undefined ? inherited : { ...inherited, DEMO_URL: demoUrl };
  const built = Bun.spawnSync(["bun", "run", "--cwd", WEBSITE, "build", "--outDir", outDir], { env, stdout: "pipe", stderr: "pipe" });

  if (built.exitCode !== 0) {
    throw new Error(`The website did not build: ${built.stderr.toString()}`);
  }
}

/** The addresses a page links to that name the demo, in the order of the page. */
function demoLinks(html: string): string[] {
  const links: string[] = [];
  const anchors = new HTMLRewriter().on("a[href]", { element: (anchor) => void links.push(anchor.getAttribute("href") ?? "") });
  anchors.transform(html);

  return links.filter((link) => link.includes("demo-page"));
}

describe("the built website", () => {
  test.each(BUILDS)(
    "holds no copy of the demo, and links to the running one only at an https address it was given (%s): without this a build puts the demo back on the site, or the home page gets a dead link",
    (what, value, links) => {
      using site = mkdtempDisposableSync(join(tmpdir(), "poplin-website-"));
      build(site.path, value);
      const home = readFileSync(join(site.path, "index.html"), "utf8");

      expect(existsSync(join(site.path, "demo")), what).toBe(false);
      expect(demoLinks(home)).toEqual([...links]);
    },
    120_000,
  );
});
