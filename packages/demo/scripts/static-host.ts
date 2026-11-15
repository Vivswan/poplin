// A static host for the built demo: files only, under a base path, the 404 page for the rest, and no answer to a form.

import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

import { notFoundPage } from "./deep-links";
import { HOST, PID_PATH } from "./running";

/** How long a browser keeps a file. */
const CACHE = "max-age=600";

/** What the host serves, and where. */
interface Hosted {
  /** The built demo's folder. */
  readonly folder: string;

  /** The path the folder is served at, with its closing slash, such as `/poplin/demo/`. */
  readonly at: string;

  /** The port to listen on; 0 takes a free one. */
  readonly port: number;
}

/** The file a path under the demo names, or `undefined` when the folder holds none: a folder's address is its `index.html`. */
function fileAt(folder: string, inside: string): string | undefined {
  const file = normalize(join(folder, inside === "" || inside.endsWith("/") ? `${inside}index.html` : inside));
  if (!file.startsWith(`${folder}${sep}`) || !existsSync(file) || !statSync(file).isFile()) return undefined;

  return file;
}

/**
 * Start a static host on this machine alone.
 *
 * @returns the running server. The origin's root and the folder's address without its slash lead to the demo; a path with no file gets a 404 page that sends a deep link of the demo through its first page
 */
export function serveStatic(hosted: Hosted): ReturnType<typeof Bun.serve> {
  const folder = normalize(hosted.folder);

  return Bun.serve({
    hostname: HOST,
    port: hosted.port,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed\n", { status: 405 });

      if (pathname === PID_PATH) return new Response(String(process.pid));

      if ((pathname === "/" && hosted.at !== "/") || `${pathname}/` === hosted.at) return new Response(null, { status: 302, headers: { Location: hosted.at } });

      const file = pathname.startsWith(hosted.at) ? fileAt(folder, decodeURIComponent(pathname.slice(hosted.at.length))) : undefined;
      if (file !== undefined) return new Response(Bun.file(file), { headers: { "Cache-Control": CACHE } });

      return new Response(notFoundPage(hosted.at), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
}
