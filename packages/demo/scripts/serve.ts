// Start the demo on this machine: `bun run preview`, with `--port <port>`, `--watch`, `--dev`, and `--gallery`.
//
//   bun run preview              the demo on http://127.0.0.1:4400, after stopping the one already there
//   bun run preview --watch      the same, started anew whenever a source file it loads changes
//   bun run preview --dev        the same, with the dashboard's client served hot by its dev server: an edit shows without a reload
//   bun run preview --gallery    the same, with every page and state listed at /gallery
//   bun run preview:stop         stop it
//
// This file and its neighbours start the server and keep the pid file. The demo itself is `../src/preview/`, which names no runtime.

import { basename, join } from "node:path";

import manifest from "../../cli/package.json" with { type: "json" };
import type { ClientFiles } from "../../app/src/console/shell";
import { BunSqliteDriver } from "../../core/tests/database/support/bun-sqlite-driver";
import { createPreview } from "../src/preview/preview";
import { buildClient, CLIENT as CONSOLE, readClient } from "../../dashboard/scripts/client-build";
import { readSamples } from "./samples";
import { DEFAULT_PORT, HOST, markRunning, PID_PATH, pidFile, readFlags, stopRunning, unmarkRunning } from "./running";

/** The flag of bun itself that starts a script anew whenever a file it loads changes. */
const WATCH_FLAG = "--watch";

/** The signals that end the preview. */
const END_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** The folder the client's build is written into. */
const CONSOLE_DIST = join(CONSOLE, "dist");

/** The environment variable the watched preview is started with: its holder builds the client on every change, so the preview builds nothing itself. */
const CLIENT_WATCHED = "POPLIN_CLIENT_WATCHED";

/** The environment variable the preview behind the dev server is started with, holding the dev server's port: the client comes from the dev server, so the preview builds none and hands out the dev entry, and a stop of the dev server's port ends it. */
const CLIENT_DEV = "POPLIN_CLIENT_DEV";

/** The highest port there is. */
const MOST_PORT = 65_535;

/** The environment variable that tells the dev server which preview it stands in front of. */
const PREVIEW_ORIGIN = "POPLIN_PREVIEW_ORIGIN";

/** What the shell page loads as the client's script and stylesheet under the dev server: the dev server's own client, then the client's dev entry, which brings its styles. Neither ever changes, so a browser may keep both. */
const DEV_FILES: Readonly<Record<string, { readonly body: string; readonly type: string }>> = {
  "app.js": { body: 'import "/@vite/client";\nimport "/src/dev.ts";\n', type: "text/javascript;charset=utf-8" },
  "app.css": { body: "", type: "text/css;charset=utf-8" },
};

/** The client under the dev server: the two files above, by their own names. */
const DEV_CLIENT: ClientFiles = {
  entry: async () => ({ script: "app.js", style: "app.css" }),
  file: async (name) => (Object.hasOwn(DEV_FILES, name) ? DEV_FILES[name] : undefined),
};

/** The built client, read from disk at every request, so a new build shows without a restart: its names from the build's manifest, and each file by its name. */
const BUILT_CLIENT: ClientFiles = {
  entry: async () => (await readClient(CONSOLE_DIST)).entry,

  file: async (name) => {
    const file = Bun.file(join(CONSOLE_DIST, basename(name)));
    if (!(await file.exists())) return undefined;

    return { body: new Uint8Array(await file.arrayBuffer()), type: file.type };
  },
};

/** Wait for the first of two processes that run as one to end, end the other, and answer the code of the one that ended. A signal that ends this process ends both. */
async function together(client: Bun.Subprocess, watched: Bun.Subprocess): Promise<number> {
  for (const signal of END_SIGNALS) {
    process.on(signal, () => {
      client.kill(signal);
      watched.kill(signal);
    });
  }

  const code = await Promise.race([client.exited, watched.exited]);
  client.kill();
  watched.kill();

  return code;
}

/** Run this script again under bun's watch mode and wait for it: the watched process is the preview, and this one only holds the terminal. Beside it the client is built anew whenever its own sources change. */
async function watch(args: readonly string[]): Promise<number> {
  const client = Bun.spawn([process.execPath, "run", "watch"], { cwd: CONSOLE, stdio: ["ignore", "ignore", "inherit"] });
  const watched = Bun.spawn([process.execPath, WATCH_FLAG, import.meta.path, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, [CLIENT_WATCHED]: "1" },
  });

  return together(client, watched);
}

/**
 * Run the client's dev server on the port, in front of a watched preview on the port after it, and wait for the preview: the dev server is what a browser opens.
 *
 * The preview is this script again under bun's watch mode, so a change of the server's side starts it anew; the dev server shows a change of the client at once.
 */
async function develop(port: number, args: readonly string[]): Promise<number> {
  const behind = port + 1;
  if (behind > MOST_PORT) throw new RangeError(`--dev takes a port under ${MOST_PORT}: the preview behind it listens on the next one`);

  // A preview already on the dev server's port gives the port up first, as a plain start does.
  await stopRunning(port);
  const client = Bun.spawn([process.execPath, "run", "dev", "--port", String(port)], {
    cwd: CONSOLE,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, [PREVIEW_ORIGIN]: `http://${HOST}:${behind}` },
  });
  const watched = Bun.spawn([process.execPath, WATCH_FLAG, import.meta.path, "--port", String(behind), ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, [CLIENT_DEV]: String(port) },
  });
  console.log(`poplin local preview, hot: http://${HOST}:${port}/   (the preview behind it: http://${HOST}:${behind}/)`);

  return together(client, watched);
}

async function serve(port: number, gallery: boolean): Promise<void> {
  await stopRunning(port);
  if (process.env[CLIENT_WATCHED] === undefined && process.env[CLIENT_DEV] === undefined) await buildClient(CONSOLE_DIST);

  const preview = await createPreview({
    openDriver: () => new BunSqliteDriver(),
    samples: await readSamples(),
    version: manifest.version,
    gallery,
    client: process.env[CLIENT_DEV] === undefined ? BUILT_CLIENT : DEV_CLIENT,
  });
  const server = Bun.serve({
    hostname: HOST,
    port,
    fetch: (request) => (new URL(request.url).pathname === PID_PATH ? new Response(String(process.pid)) : preview.fetch(request)),
  });
  // Behind the dev server the preview answers on that port too, so it is stopped by either.
  const ports = process.env[CLIENT_DEV] === undefined ? [port] : [port, Number(process.env[CLIENT_DEV])];
  for (const marked of ports) markRunning(marked);

  for (const signal of END_SIGNALS) {
    process.on(signal, () => {
      for (const marked of ports) unmarkRunning(marked);
      void server.stop(true).then(() => process.exit(0));
    });
  }

  console.log(`poplin local preview: http://${HOST}:${port}/
  Sample data, held in memory. Nothing leaves this machine. A restart starts it over.${gallery ? `\n  Every page and state: http://${HOST}:${port}/gallery` : ""}
  API token of the sample admin: ${preview.token()}
  Stop it: bun run preview:stop${port === DEFAULT_PORT ? "" : ` --port ${port}`}   (pid ${process.pid}, pid file ${pidFile(port)})`);
}

const flags = readFlags(process.argv.slice(2));
if (flags.dev) process.exit(await develop(flags.port, flags.gallery ? ["--gallery"] : []));

if (flags.watch) process.exit(await watch(["--port", String(flags.port), ...(flags.gallery ? ["--gallery"] : [])]));

await serve(flags.port, flags.gallery);
