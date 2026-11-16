import { expect, test } from "bun:test";
import { existsSync, mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomUtils, parseDocument } from "htmlparser2";

import { DEFAULT_ICON } from "../../../app/src/sites/default-icon";
import { readFiles } from "../../../cli/src/files/read";
import { buildDemo } from "../../scripts/build";

/** The most the worker's script may weigh as a host sends it, in bytes: it holds the product's code and the sample sites, and nothing of the dashboard's client, which the host serves beside it. */
const SCRIPT_BUDGET = 220_000;

/** The most every file of the built demo may weigh together, in bytes gzipped. The client is about 460,000 of it, and a first visit loads about 845,000: the worker, SQLite, and the client's first scripts, stylesheet, and one font. */
const TOTAL_BUDGET = 1_100_000;

/** A file of the dashboard's client as the build names it: the name holds a hash of the file's content. */
const CLIENT_FILE = /^assets\/[\w-]+-[\w-]{8}\.(?:js|css|woff2|svg)$/;

/** A module of one runtime, as a bundle names it: an import a browser cannot resolve. */
const RUNTIME_MODULE = /["'`](?:node|bun):[a-z_/]+["'`]|\brequire\(/g;

/** How long a test that builds the demo may take, in milliseconds: each build runs the build of the dashboard's client as a process of its own, which on a slow machine passes the five seconds a test gets. */
const BUILD_MS = 60_000;

// Drift: a dependency's server branch rides along unseen, the dashboard's client rides inside the worker's script, or every publish of the demo starts each visitor over.
// Drift: the first page links an icon the build no longer writes under that name, so a browser's tab shows none; or the file goes out as no picture, from this machine's host or as a published site.
test("the built demo stays inside its budget, ships the dashboard's client and the icon its first page links as files beside its worker, names no module a browser lacks, and builds the same bytes twice", async () => {
  using first = mkdtempDisposableSync(join(tmpdir(), "poplin-demo-"));
  using second = mkdtempDisposableSync(join(tmpdir(), "poplin-demo-"));
  const built = await buildDemo({ out: first.path });
  await buildDemo({ out: second.path });
  const weights = Object.fromEntries(built.map((file) => [file.name, file.gzipped]));
  const script = readFileSync(join(first.path, "sw.js"), "utf8");
  const client = Object.keys(weights).filter((name) => name.startsWith("assets/"));
  const links = DomUtils.getElementsByTagName("link", parseDocument(readFileSync(join(first.path, "index.html"), "utf8")));
  const icon = links.find((link) => link.attribs.rel === "icon")?.attribs.href ?? "";
  const published = await readFiles(first.path);

  expect([Bun.file(join(first.path, icon)).type, published.ok ? published.files.find((file) => file.path === icon)?.contentType : published.reason]).toEqual(["image/svg+xml", "image/svg+xml"]);
  expect(readFileSync(join(first.path, icon), "utf8")).toBe(DEFAULT_ICON);

  expect(Object.keys(weights).filter((name) => !client.includes(name))).toEqual(["index.html", "sw.js", "sql-wasm.wasm", "404.html"]);
  expect([client.filter((name) => !CLIENT_FILE.test(name)), client.filter((name) => name.endsWith(".css")).length]).toEqual([[], 1]);
  expect(client.filter((name) => !script.includes(name.slice("assets/".length)) || !existsSync(join(first.path, name)))).toEqual([]);
  expect(weights["sw.js"]).toBeLessThan(SCRIPT_BUDGET);
  expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBeLessThan(TOTAL_BUDGET);
  expect(script.match(RUNTIME_MODULE) ?? []).toEqual([]);
  expect(readFileSync(join(second.path, "sw.js"), "utf8")).toBe(script);
}, BUILD_MS);

test("the built 404 page sends an address inside the demo through the first page at the site's root: without this a link to a page inside the demo, on a site that holds the demo at its root, ends on Not found", async () => {
  using site = mkdtempDisposableSync(join(tmpdir(), "poplin-site-"));
  await buildDemo({ out: site.path });
  const sent: string[] = [];
  const page = parseDocument(readFileSync(join(site.path, "404.html"), "utf8"));
  const script = DomUtils.getElementsByTagName("script", page).map((found) => DomUtils.textContent(found)).join("");

  new Function("location", script)({ pathname: "/activity", search: "?kind=sites", hash: "#content", replace: (address: string) => sent.push(address) });

  expect(sent).toEqual(["/?to=%2Factivity%3Fkind%3Dsites#content"]);
}, BUILD_MS);
