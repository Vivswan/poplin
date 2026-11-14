// Stop the local preview: `bun run preview:stop`, with `--port` for one started on another port.

import { readFlags, stopRunning } from "./running";

const { port } = readFlags(process.argv.slice(2));
const stopped = await stopRunning(port);

console.log(stopped === undefined ? `No preview runs on port ${port}.` : `Stopped the preview on port ${port} (pid ${stopped}).`);
