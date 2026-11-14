// Fails a run when the Workers runtime logs an exception nothing caught or a warning of its own: Vitest sees what a test throws, and never what the runtime prints.

import type { Reporter, Vitest } from "vitest/node";

/** How the runtime begins a line about an exception no code caught, and one about a warning of its own. */
const FAULT = /^(?:uncaught exception|console warning);/;

/** The digits of a form boundary, which differ from one form to the next. */
const BOUNDARY = /(?<=boundary=)[0-9a-f]+/;

/** The lines that are no fault of the install or of a test, a boundary's digits left out. One is dropped from the log until a run has printed it `most` times. */
const KNOWN: readonly Known[] = [
  // The bucket's local simulation leaves a promise of its own unhandled when an upload is cut: twice for each of the three tests of tests/storage/r2.test.ts that cut one.
  { line: "uncaught exception; source = Uncaught (in promise); stack = Error: Network connection lost.", most: 6 },

  // Cloudflare's SDK reads an empty form as text before a client's first form request: once in each of the two tests of tests/worker/setup.test.ts that write a variable onto the Worker.
  {
    line:
      'console warning; message = Called .text() on an HTTP body which does not appear to be text. The body\'s Content-Type is "multipart/form-data; boundary=". ' +
      "The result will probably be corrupted. Consider checking the Content-Type header before interpreting entities as text.",
    most: 2,
  },
];

/** A line the runtime may print, and the most times one run may print it. */
interface Known {
  readonly line: string;
  readonly most: number;
}

/** A Vitest reporter that turns a line of the runtime's log into an error of the run, as Vitest does with an error no test caught. */
export class RuntimeLog implements Reporter {
  /** How often this run has printed each known line. */
  readonly #seen = new Map<Known, number>();

  /** Whether Vitest has counted the run's errors, after which it reads no more of them. */
  #counted = false;

  /** Decide what becomes of one message written to the terminal: `true` when it is printed as it came. */
  #passes(vitest: Vitest, message: string): boolean {
    if (!FAULT.test(message)) return true;

    const known = KNOWN.find((entry) => entry.line === message.replace(BOUNDARY, ""));
    const count = known === undefined ? 0 : (this.#seen.get(known) ?? 0) + 1;
    if (known !== undefined) this.#seen.set(known, count);
    if (known !== undefined && count <= known.most) return false;

    // Vitest reads its errors once, as the tests end, and the runtime may still be writing while it is stopped.
    process.exitCode = 1;
    if (this.#counted) return true;

    const why = known === undefined ? "the Workers runtime logged" : `the Workers runtime logged, more often than the ${known.most} times the tests account for,`;
    vitest.state.catchError(new Error(`${why} ${message}`), "Runtime Error");

    return false;
  }

  onInit(vitest: Vitest): void {
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);

      stream.write = ((...written: Parameters<typeof write>): boolean => {
        const [chunk] = written;
        if (typeof chunk === "string" && !this.#passes(vitest, chunk.trimEnd())) return true;

        return write(...written);
      }) as typeof stream.write;
    }
  }

  onTestRunStart(): void {
    this.#seen.clear();
    this.#counted = false;
  }

  onTestRunEnd(): void {
    this.#counted = true;
  }
}
