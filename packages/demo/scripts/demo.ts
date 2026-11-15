// See the demo as a static host serves it: `bun run demo` builds the static files and serves them on this machine.
//
//   bun run demo                 http://127.0.0.1:4420/poplin/demo/, after stopping the one already there
//   bun run demo --port 4421     another port, beside it
//   bun run demo:stop            stop it

import { buildDemo, DIST } from "./build";
import { HOST, markRunning, pidFile, readFlags, stopRunning, unmarkRunning } from "./running";
import { serveStatic } from "./static-host";

/** The port of a demo started without one. */
const DEFAULT_PORT = 4420;

/** The path the host serves the demo's folder at: under a folder, where the demo's own base path shows. */
const AT = "/poplin/demo/";

/** The signals that end the host. */
const END_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** Build the demo, then serve it until a signal ends it; the demo already on the port is stopped first. */
async function serve(port: number): Promise<void> {
  await stopRunning(port);

  const built = await buildDemo({ out: DIST });
  const server = serveStatic({ folder: DIST, at: AT, port });
  markRunning(port);

  for (const signal of END_SIGNALS) {
    process.on(signal, () => {
      unmarkRunning(port);
      void server.stop(true).then(() => process.exit(0));
    });
  }

  console.log(`poplin demo, as static files: http://${HOST}:${port}${AT}
  The files bun run demo:build writes: ${built.map((file) => `${file.name} ${Math.round(file.gzipped / 1000)} KB`).join(", ")} (gzipped).
  It runs inside the browser, over sample data. Closing its last tab starts it over.
  Stop it: bun run demo:stop${port === DEFAULT_PORT ? "" : ` --port ${port}`}   (pid ${process.pid}, pid file ${pidFile(port)})`);
}

await serve(readFlags(process.argv.slice(2), DEFAULT_PORT).port);
