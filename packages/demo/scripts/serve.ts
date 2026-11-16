// Start the demo on this machine: `bun run preview`, with `--port <port>`, `--watch`, `--dev`, `--gallery`, and `--no-domain`.
//
//   bun run preview              the demo on http://127.0.0.1:4400, after stopping the one already there
//   bun run preview --watch      the same, started anew whenever a source file it loads changes
//   bun run preview --dev        the same, with the dashboard's client served hot by its dev server: an edit shows without a reload
//   bun run preview --gallery    the same, with every page and state listed at /gallery
//   bun run preview --no-domain  an install without a domain: the dashboard at http://poplin.localhost:4400, its sites as paths of sites.localhost and private.localhost
//   bun run preview:stop         stop it
//
// This file and its neighbours start the server and keep the pid file. The demo itself is `../src/preview/`, which names no runtime.

import { constants } from "node:os";
import { basename, join } from "node:path";

import concurrently, { type CloseEvent } from "concurrently";

import manifest from "../../cli/package.json" with { type: "json" };
import type { ClientFiles } from "../../app/src/console/shell";
import { BunSqliteDriver } from "../../core/tests/database/support/bun-sqlite-driver";
import type { LocalOrigins } from "../src/preview/kind";
import { createPreview } from "../src/preview/preview";
import { buildClient, CLIENT as CONSOLE, readClient } from "../../dashboard/scripts/client-build";
import { readSamples } from "./samples";
import { DEFAULT_PORT, HOST, markRunning, PID_PATH, pidFile, readFlags, stopRunning, unmarkRunning } from "./running";

/** The flag of bun itself that starts a script anew whenever a file it loads changes. */
const WATCH_FLAG = "--watch";

/** The flag of this script that makes the sample install one without a domain. */
const NO_DOMAIN_FLAG = "--no-domain";

/** This script's file, as it is named from its own folder. */
const THIS_SCRIPT = basename(import.meta.path);

/** What a shell adds to a signal's number to answer the exit code of a process the signal ended. */
const SIGNAL_BASE = 128;

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

/** The first label of each host of a preview without a domain; every name under `localhost` is this machine. */
const LOCAL_LABELS = { admin: "poplin", sites: "sites", private: "private" } as const;

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

/** The exit code of a process as the library tells its end: the code itself, or, for one a signal ended, what a shell answers for that signal. */
function exitCodeOf(ended: CloseEvent | undefined): number {
  if (typeof ended?.exitCode === "number") return ended.exitCode;

  return SIGNAL_BASE + (constants.signals[ended?.exitCode as NodeJS.Signals] ?? 0);
}

/**
 * Run the client's process and the watched preview as one, and wait: when either ends the other is ended, and a signal that ends this process ends both.
 *
 * Each command line is made of plain words only, a script of the client and this script by its place in its own folder, so nothing in it needs quoting for a shell.
 *
 * @param client - the script of the client to run, in the client's folder, with its flags, and what it adds to the environment
 * @param watched - the flags this script is run again with under bun's watch mode, and what that adds to the environment
 * @returns the exit code of the one that ended first
 */
async function together(
  client: { readonly script: string; readonly flags?: readonly string[]; readonly env?: Readonly<Record<string, string>> },
  watched: { readonly flags: readonly string[]; readonly env: Readonly<Record<string, string>> },
): Promise<number> {
  const { result } = concurrently(
    [
      { name: "client", command: ["bun", "run", client.script, ...(client.flags ?? [])].join(" "), cwd: CONSOLE, env: client.env ?? {} },
      { name: "preview", command: ["bun", WATCH_FLAG, THIS_SCRIPT, ...watched.flags].join(" "), cwd: import.meta.dir, env: watched.env },
    ],
    { killOthersOn: ["success", "failure"], raw: true },
  );
  // The library answers every process's end, in the order they ended, whether or not one of them failed.
  const [first] = await result.catch((ended: readonly CloseEvent[]) => ended);

  return exitCodeOf(first);
}

/** Run this script again under bun's watch mode and wait for it: the watched process is the preview, and this one only holds the terminal. Beside it the client is built anew whenever its own sources change. */
function watch(args: readonly string[]): Promise<number> {
  return together({ script: "watch" }, { flags: args, env: { [CLIENT_WATCHED]: "1" } });
}

/**
 * Run the client's dev server on the port, in front of a watched preview on the port after it, and wait for the preview: the dev server is what a browser opens.
 *
 * The preview is this script again under bun's watch mode, so a change of the server's side starts it anew; the dev server shows a change of the client at once.
 */
async function develop(port: number, args: readonly string[]): Promise<number> {
  const behind = port + 1;
  const home = args.includes(NO_DOMAIN_FLAG) ? localOrigin("admin", port) : `http://${HOST}:${port}`;
  if (behind > MOST_PORT) throw new RangeError(`--dev takes a port under ${MOST_PORT}: the preview behind it listens on the next one`);

  // A preview already on the dev server's port gives the port up first, as a plain start does.
  await stopRunning(port);
  console.log(`poplin local preview, hot: ${home}/   (the preview behind it: http://${HOST}:${behind}/)`);

  return together(
    { script: "dev", flags: ["--port", String(port)], env: { [PREVIEW_ORIGIN]: `http://${HOST}:${behind}` } },
    { flags: ["--port", String(behind), ...args], env: { [CLIENT_DEV]: String(port) } },
  );
}

/** One origin of a preview without a domain, on a port of this machine. */
function localOrigin(host: keyof typeof LOCAL_LABELS, port: number): string {
  return `http://${LOCAL_LABELS[host]}.localhost:${port}`;
}

/** The three origins of a preview without a domain that listens on a port: the dashboard's is the port a browser opens, which behind the dev server is the dev server's. */
function localOrigins(port: number): LocalOrigins {
  const front = process.env[CLIENT_DEV] === undefined ? port : Number(process.env[CLIENT_DEV]);

  return { admin: localOrigin("admin", front), sites: localOrigin("sites", port), private: localOrigin("private", port) };
}

async function serve({ port, gallery, noDomain }: Pick<ReturnType<typeof readFlags>, "port" | "gallery" | "noDomain">): Promise<void> {
  await stopRunning(port);
  const origins = noDomain ? localOrigins(port) : undefined;
  const home = origins?.admin ?? `http://${HOST}:${port}`;
  if (process.env[CLIENT_WATCHED] === undefined && process.env[CLIENT_DEV] === undefined) await buildClient(CONSOLE_DIST);

  const preview = await createPreview({
    openDriver: () => new BunSqliteDriver(),
    samples: await readSamples(),
    version: manifest.version,
    gallery,
    client: process.env[CLIENT_DEV] === undefined ? BUILT_CLIENT : DEV_CLIENT,
    ...(origins === undefined ? {} : { noDomain: origins }),
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

  console.log(`poplin local preview: ${home}/${origins === undefined ? "" : `\n  An install without a domain. Its open sites: ${origins.sites}/   Its private sites: ${origins.private}/`}
  Sample data, held in memory. Nothing leaves this machine. A restart starts it over.${gallery ? `\n  Every page and state: ${home}/gallery` : ""}
  API token of the sample admin: ${preview.token()}
  Stop it: bun run preview:stop${port === DEFAULT_PORT ? "" : ` --port ${port}`}   (pid ${process.pid}, pid file ${pidFile(port)})`);
}

const flags = readFlags(process.argv.slice(2));
const passed = [...(flags.gallery ? ["--gallery"] : []), ...(flags.noDomain ? [NO_DOMAIN_FLAG] : [])];
if (flags.dev) process.exit(await develop(flags.port, passed));

if (flags.watch) process.exit(await watch(["--port", String(flags.port), ...passed]));

await serve(flags);
