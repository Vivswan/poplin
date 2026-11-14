// Start the demo on this machine: `bun run preview`, with `--port <port>`, `--watch`, and `--gallery`.
//
//   bun run preview              the demo on http://127.0.0.1:4400, after stopping the one already there
//   bun run preview --watch      the same, started anew whenever a source file it loads changes
//   bun run preview --gallery    the same, with every page and state listed at /gallery
//   bun run preview:stop         stop it
//
// This file and its neighbours start the server and keep the pid file. The demo itself is `../src/preview/`, which names no runtime.

import { BunSqliteDriver } from "../../core/tests/database/support/bun-sqlite-driver";
import { createPreview } from "../src/preview/preview";
import { readSamples } from "./samples";
import { DEFAULT_PORT, HOST, markRunning, PID_PATH, pidFile, readFlags, stopRunning, unmarkRunning } from "./running";

/** The flag of bun itself that starts a script anew whenever a file it loads changes. */
const WATCH_FLAG = "--watch";

/** The signals that end the preview. */
const END_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** Run this script again under bun's watch mode and wait for it: the watched process is the preview, and this one only holds the terminal. */
async function watch(args: readonly string[]): Promise<number> {
  const watched = Bun.spawn([process.execPath, WATCH_FLAG, import.meta.path, ...args], { stdio: ["inherit", "inherit", "inherit"] });
  for (const signal of END_SIGNALS) process.on(signal, () => watched.kill(signal));

  return watched.exited;
}

async function serve(port: number, gallery: boolean): Promise<void> {
  await stopRunning(port);

  const preview = await createPreview({ openDriver: () => new BunSqliteDriver(), samples: await readSamples(), gallery });
  const server = Bun.serve({
    hostname: HOST,
    port,
    fetch: (request) => (new URL(request.url).pathname === PID_PATH ? new Response(String(process.pid)) : preview.fetch(request)),
  });
  markRunning(port);

  for (const signal of END_SIGNALS) {
    process.on(signal, () => {
      unmarkRunning(port);
      void server.stop(true).then(() => process.exit(0));
    });
  }

  console.log(`poplin local preview: http://${HOST}:${port}/
  Sample data, held in memory. Nothing leaves this machine. A restart starts it over.${gallery ? `\n  Every page and state: http://${HOST}:${port}/gallery` : ""}
  API token of the sample admin: ${preview.token()}
  Stop it: bun run preview:stop${port === DEFAULT_PORT ? "" : ` --port ${port}`}   (pid ${process.pid}, pid file ${pidFile(port)})`);
}

const flags = readFlags(process.argv.slice(2));
if (flags.watch) process.exit(await watch(["--port", String(flags.port), ...(flags.gallery ? ["--gallery"] : [])]));

await serve(flags.port, flags.gallery);
