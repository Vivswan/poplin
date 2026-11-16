// What `poplin install` reaches in this process: the providers beside the built command, the terminal, standard input, and the network.

import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";

import type { Io } from "../commands/records";
import { loadProviders } from "../local/providers";
import { processScreen } from "../local/screen";
import type { InstallEnds } from "./records";

/** The folder of the providers, beside the file this code is built into. */
const PROVIDERS = fileURLToPath(new URL("./providers/", import.meta.url));

/** The value of `TERM` on a terminal that takes no control sequence. */
const PLAIN_TERMINAL = "dumb";

/**
 * The ends of this process.
 *
 * Colour shows on a stream that is a terminal, unless `NO_COLOR` is set or the terminal takes no control sequence. A request and a wait end when the person stops the command.
 *
 * @param io - the machine's ends, whose stop ends each request and each wait
 */
export function processEnds(io: Io): InstallEnds {
  const { env } = io.machine;
  const plain = (env.NO_COLOR ?? "") !== "" || env.TERM === PLAIN_TERMINAL;

  return {
    providers: () => loadProviders(PROVIDERS),
    screen: processScreen({ out: process.stdout, err: process.stderr, colour: { out: process.stdout.isTTY === true && !plain, err: process.stderr.isTTY === true && !plain } }),
    input: () => text(process.stdin),
    reach: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal == null ? io.stopped : AbortSignal.any([init.signal, io.stopped]) }),
      now: () => Date.now(),
    },
    sleep: async (milliseconds) => {
      if ((await io.pause(milliseconds)) === "interrupted") throw new Error("the command was stopped");
    },
  };
}
