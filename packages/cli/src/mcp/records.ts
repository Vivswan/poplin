// What the MCP server takes from the command that starts it.

import type { Problem } from "../commands/problems";
import type { Session } from "../commands/records";

/** The ends of the machine the server works through, so a test can stand in for each. */
export interface Host {
  /** Finds the install and the token for one tool call. The login is read anew each time, so one made while the server runs is used. */
  readonly session: () => Promise<Session | Problem | "logged-out">;

  /** Answers a value with every token this machine holds taken out of its texts. */
  readonly withoutTokens: <Value>(value: Value) => Promise<Value>;

  /** Prints one line for a person, on stderr. */
  readonly log: (line: string) => void;
}
