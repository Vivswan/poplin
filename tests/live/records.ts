// What the live checks share: a check, what an install may lack, and what a check came to.

/** Something a check needs that an install, its account, or a run may lack. `person` is always lacking: such a check is done by hand. */
type Capability = "token" | "letters" | "access" | "guard-rules" | "https-redirect" | "rate-rule" | "bot-block" | "many-files" | "person";

/** Why each lacking capability is lacking, in words that name no host and no account. */
export type Missing = Partial<Record<Capability, string>>;

/** A site as the install answers it: the fields the checks read. */
export interface LiveSite {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly access: "private" | "unlisted" | "public";
  readonly url: string;
  readonly addresses: { readonly site: string; readonly public: string | null };
  readonly live_version: number;
  readonly state: string;
}

/** What one command printed with `--json`: its exit code and the one value on stdout. */
export interface Ran {
  readonly code: number;
  readonly value: Record<string, unknown>;
}

/** What a site is published with. `text` is the page's whole body, which a check looks for in an answer. */
export interface Draft {
  readonly access: LiveSite["access"];
  readonly text: string;
}

/** An install as an outsider and a token holder reach it. */
export interface Bench {
  /** The domain every hostname of the install sits under. */
  readonly domain: string;

  /** Where the dashboard, the login, and the API answer. */
  readonly admin: string;

  /** What every site name of this run starts with. */
  readonly prefix: string;

  /** What the install lacks, with the reason. */
  readonly missing: Missing;

  /** Sends one request as a stranger: no token, no cookie, no redirect followed. */
  readonly visit: (address: string, init?: RequestInit) => Promise<Response>;

  /** Runs one command line of the CLI, with `--json`, as the token holder. */
  readonly cli: (...words: readonly string[]) => Promise<Ran>;

  /** Calls one tool of the MCP server as the token holder and answers its structured content. */
  readonly mcp: (tool: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

  /** Writes a folder that holds one page and answers its path. */
  readonly folder: (text: string) => string;

  /** Writes a folder of many small files, an `index.html` among them, and answers its path. */
  readonly manyFiles: () => string;

  /** Publishes a new site through the CLI. */
  readonly publish: (draft: Draft) => Promise<LiveSite>;

  /** An empty path under the bench's scratch folder, for a file a command writes. */
  readonly scratchFile: (name: string) => string;

  /** Waits so many milliseconds, for a block in front of the install to lapse. */
  readonly pause: (ms: number) => Promise<void>;

  /** The time a pause moves on, in milliseconds. */
  readonly now: () => number;

  /** Prints one line of what a check that passed met. The line holds nothing an install wrote and no address. */
  readonly say: (line: string) => void;
}

/** One check. `needs` lists what it cannot run without; `run` throws when the install answers wrong. */
export interface Check {
  readonly id: string;
  readonly name: string;
  readonly needs: readonly Capability[];
  readonly run: (bench: Bench) => Promise<void>;
}

/** What a check came to. A `skipped` check did not run, and `reason` says what it needs. */
export type Outcome =
  | { readonly id: string; readonly name: string; readonly result: "passed" }
  | { readonly id: string; readonly name: string; readonly result: "skipped"; readonly reason: string }
  | { readonly id: string; readonly name: string; readonly result: "failed" };

/** Thrown by a check that finds, while it runs, that the install lacks what it needs. */
export class Skip extends Error {}
