// Fails a run when the Workers runtime logs an exception nothing caught or a warning of its own: Vitest sees what a test throws, and never what the runtime prints.

import type { Reporter, Vitest } from "vitest/node";

/** How the runtime begins a line about an exception no code caught, and one about a warning of its own. */
const FAULT = /^(?:uncaught exception|console warning);/;

/** The digits of a form boundary, which differ from one form to the next. */
const BOUNDARY = /(?<=boundary=)[0-9a-f]+/;

/** The lines that are no fault of the install or of a test, a boundary's digits left out. One is dropped from the log until a run has printed it `most` times. */
const KNOWN: readonly Known[] = [
  // The bucket's local simulation leaves a promise of its own unhandled when an upload is cut: twice for each of the three tests of tests/shared/storage/r2.test.ts that cut one.
  { line: "uncaught exception; source = Uncaught (in promise); stack = Error: Network connection lost.", most: 6 },

  // Cloudflare's SDK reads an empty form as text before a client's first form request.
  // That is once in each of the six tests of setup.test.ts that write a variable onto the Worker, of the four rows of request-budget.test.ts that repair, and in the one test of start.test.ts that writes the key there.
  // And once wherever a release is uploaded: in the one test of sweep.test.ts and the one of worker.test.ts, and in the three rows of request-budget.test.ts that take an update.
  {
    line:
      'console warning; message = Called .text() on an HTTP body which does not appear to be text. The body\'s Content-Type is "multipart/form-data; boundary=". ' +
      "The result will probably be corrupted. Consider checking the Content-Type header before interpreting entities as text.",
    most: 16,
  },

  // A job that is stopped is terminated in the middle of a step, which the Workflow's local simulation logs as its engine aborting: up to twice for the one test of tests/shared/jobs/workflow.test.ts that cancels a copy.
  { line: /^uncaught exception; exception = workerd\/api\/actor-state\.c\+\+:\d+: failed: broken\.outputGateBroken; jsg\.Error: Aborting engine: User called terminate/, most: 2 },

  // A job whose round fails for good ends by throwing, so Cloudflare shows the instance as errored: once from the simulation's stand-in for the step, once from the job's own `run`, in the one test of tests/shared/jobs/workflow.test.ts that fails a round.
  { line: /^uncaught exception; source = Uncaught \(in promise\); stack = Error: the bucket is away\n/, most: 2 },
];

/** A line the runtime may print, whole or by how it begins where the rest names a place in the runtime, and the most times one run may print it. */
interface Known {
  readonly line: string | RegExp;
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

    const printed = message.replace(BOUNDARY, "");
    const known = KNOWN.find((entry) => (typeof entry.line === "string" ? entry.line === printed : entry.line.test(printed)));
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
