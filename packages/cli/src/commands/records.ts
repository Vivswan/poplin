// What the modules that run a command share: the machine's ends a command talks through, and what a command comes to.

import type { AddressLayout } from "../../../core/src/sites/address-layout";
import type { Called, Client, Fetch } from "../client/client";
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

  /** Asks one question on the terminal and answers the line typed, or `undefined` once the person stopped the question. */
  readonly ask: (question: string) => Promise<string | undefined>;

  /** How long one call may take, in milliseconds, in place of the client's defaults. */
  readonly timeoutMs?: number;

  /** The name this computer gives itself when it asks to be logged in. */
  readonly computer: string;

  /** Hands an address to the person's browser, when this machine has one to open. It never throws, and a browser that did not open is not heard of. */
  readonly open: (address: string) => void;

  /** Waits so many milliseconds. It answers `interrupted`, at once, when the command is stopped during the wait or was before it. */
  readonly pause: (ms: number) => Promise<"over" | "interrupted">;

  /** Aborts when the person stops the command: the one way a command hears of it. No call is sent to the install from then on, but for the short ones that give an upload up. */
  readonly stopped: AbortSignal;
}

/** What a command that talks to an install runs with. */
export interface Session {
  /** The client of the install. Once the command is stopped, each of its calls fails as `stopped`, the ones on their way included. */
  readonly client: Client;

  /** The client a stopped command gives its upload up with: no stop ends its calls, and each waits a few seconds at most. */
  readonly afterStop: Client;

  /** The machine's ends. */
  readonly io: Io;

  /** The origin of the install, for a command that prints it. */
  readonly server: string;

  /** Asks the install how it lays out the addresses of its sites. An answer is kept, so the install is asked once however often this is called; a failure is not kept. */
  readonly layout: () => Promise<Called<AddressLayout>>;

  /** Where the login came from. */
  readonly source: "environment" | "file";
}

/**
 * What a command came to.
 *
 * `value` is what `--json` prints, `lines` what a person reads on stdout, and `notes` go to stderr either way.
 * `steps` follow the lines and say what to type next: they hold nothing of a site but its label. `found` is set by a command that did its work and found something wrong: it exits as a failure, or as `unreachable` where the install stopped answering.
 */
export type Outcome =
  | { readonly ok: true; readonly value: unknown; readonly lines: readonly string[]; readonly steps?: readonly string[]; readonly notes?: readonly string[]; readonly found?: "failed" | "unreachable" }
  | { readonly ok: false; readonly problem: Problem };
