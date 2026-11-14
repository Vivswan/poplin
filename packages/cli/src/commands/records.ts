// What the modules that run a command share: the machine's ends a command talks through, and what a command comes to.

import type { Client, Fetch } from "../client/client";
import type { Machine } from "../local/login-file";
import type { Problem } from "./problems";
import type { Request } from "./requests";

/** One shape of the parser's requests, kept when it is of a command named and narrowed to those commands. */
type Narrowed<One, Kind> = One extends { readonly kind: infer Kinds } ? ([Kind & Kinds] extends [never] ? never : Omit<One, "kind"> & { readonly kind: Kind & Kinds }) : never;

/** The requests of the commands named and of no other. The parser reads several commands into one shape, which this takes apart. */
export type RequestOf<Kind extends Request["kind"]> = Narrowed<Request, Kind>;

/** Everything a command touches outside its own arguments, so a test can stand in for each. */
export interface Io {
  /** Prints one line of the result, on stdout. */
  readonly out: (line: string) => void;

  /** Prints one line that is no result, on stderr: an error, a hint, a note. */
  readonly err: (line: string) => void;

  /** Rewrites the one progress line, on stderr. It is called only when `terminal.progress` holds. */
  readonly status: (text: string) => void;

  /** What sends the requests. */
  readonly fetch: Fetch;

  /** The environment, the platform, and the home folder the login is found by. */
  readonly machine: Machine;

  /** Whether a person can be asked a question, and whether a progress line would be seen. */
  readonly terminal: { readonly asks: boolean; readonly progress: boolean };

  /** Asks one question on the terminal and answers the line typed. */
  readonly ask: (question: string) => Promise<string>;

  /** How long one call may take, in milliseconds, in place of the client's defaults. */
  readonly timeoutMs?: number;
}

/** What a command that talks to an install runs with. */
export interface Session {
  /** The client of the install. */
  readonly client: Client;

  /** The machine's ends. */
  readonly io: Io;

  /** The origin of the install, for a command that prints it. */
  readonly server: string;

  /** Where the login came from. */
  readonly source: "environment" | "file";
}

/**
 * What a command came to.
 *
 * `value` is what `--json` prints, `lines` what a person reads on stdout, and `notes` go to stderr either way. `found` is set by a command that did its work and found something wrong, and exits as a failure.
 */
export type Outcome =
  | { readonly ok: true; readonly value: unknown; readonly lines: readonly string[]; readonly notes?: readonly string[]; readonly found?: "failed" }
  | { readonly ok: false; readonly problem: Problem };
