import { expect, test } from "bun:test";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serveStatic } from "../../scripts/static-host";

/** The path the host under test serves its folder at. */
const AT = "/poplin/demo/";

/** What the host answers each request with: its status, and where it sends the browser. */
const ANSWERS: readonly (readonly [method: string, path: string, status: number, location: string | null])[] = [
  ["GET", "/poplin/demo/", 200, null],
  ["GET", "/poplin/demo/sw.js", 200, null],
  ["GET", "/poplin/demo/a%20file.txt", 200, null],
  ["GET", "/", 302, AT],
  ["GET", "/poplin/demo", 302, AT],
  ["GET", "/poplin/demo/settings", 404, null],
  ["GET", "/poplin/demo/%E0%A4%A", 404, null],
  ["GET", "/another-page/", 404, null],
  ["POST", "/poplin/demo/reset", 405, null],
];

test("a path with a malformed percent escape gets the static host's 404 page, and every other request its usual answer: without this the host answers 500 where a real one answers 404", async () => {
  using parent = mkdtempDisposableSync(join(tmpdir(), "poplin-host-"));
  const folder = join(parent.path, "site");
  await Bun.write(join(folder, "index.html"), "<p>first page</p>");
  await Bun.write(join(folder, "sw.js"), "// worker");
  await Bun.write(join(folder, "a file.txt"), "spaced");
  const server = serveStatic({ folder, at: AT, port: 0 });

  try {
    const asked = ANSWERS.map(async ([method, path]) => {
      const answer = await fetch(`http://${server.hostname}:${server.port}${path}`, { method, redirect: "manual" });

      return [method, path, answer.status, answer.headers.get("Location")];
    });

    expect(await Promise.all(asked)).toEqual(ANSWERS.map((row) => [...row]));
  } finally {
    await server.stop(true);
  }
});
