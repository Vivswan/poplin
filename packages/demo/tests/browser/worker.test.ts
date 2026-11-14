import { expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDemo } from "../../scripts/build";

/** The most the worker's script may weigh as a host sends it, in bytes: it holds the product's code and the sample sites. */
const SCRIPT_BUDGET = 150_000;

/** The most a first visit may load, in bytes gzipped: about what one photograph weighs. */
const TOTAL_BUDGET = 500_000;

/** A module of one runtime, as a bundle names it: an import a browser cannot resolve. */
const RUNTIME_MODULE = /["'`](?:node|bun):[a-z_/]+["'`]|\brequire\(/g;

test("the built demo stays inside its budget, names no module a browser lacks, and builds the same bytes twice: without this a dependency's server branch rides along unseen, or every deploy of the website starts each visitor over", async () => {
  using first = mkdtempDisposableSync(join(tmpdir(), "poplin-demo-"));
  using second = mkdtempDisposableSync(join(tmpdir(), "poplin-demo-"));
  const built = await buildDemo({ out: first.path });
  await buildDemo({ out: second.path });
  const weights = Object.fromEntries(built.map((file) => [file.name, file.gzipped]));
  const script = readFileSync(join(first.path, "sw.js"), "utf8");

  expect(Object.keys(weights)).toEqual(["index.html", "sw.js", "sql-wasm.wasm", "404.html"]);
  expect(weights["sw.js"]).toBeLessThan(SCRIPT_BUDGET);
  expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeLessThan(TOTAL_BUDGET);
  expect(script.match(RUNTIME_MODULE) ?? []).toEqual([]);
  expect(readFileSync(join(second.path, "sw.js"), "utf8")).toBe(script);
});

test("inside a website the build writes no 404 page of its own and puts the deep-link script into the site's: without this a link to a page inside the demo ends on the website's 404 page", async () => {
  using site = mkdtempDisposableSync(join(tmpdir(), "poplin-site-"));
  const notFound = join(site.path, "404.html");
  await Bun.write(notFound, "<!doctype html><html><head><title>No page</title></head><body>No page at this address.</body></html>");
  const built = await buildDemo({ out: join(site.path, "demo"), host: { notFound, at: "/poplin/demo/" } });
  const page = readFileSync(notFound, "utf8");

  expect(built.map((file) => file.name)).toEqual(["index.html", "sw.js", "sql-wasm.wasm"]);
  expect(page).toMatch(/<title>No page<\/title><script>[^<]*"\/poplin\/demo\/"[^<]*<\/script><\/head>/);
  expect(page).toContain("<body>No page at this address.</body>");
});
