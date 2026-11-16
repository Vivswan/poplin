// What the live checks share: a check, what an install may lack, and what a check came to.

import type { JobRun } from "../scripts/live/job-run";
import type { LiveAddresses } from "./addresses";

/** Something a check needs that an install, its account, or a run may lack. `person` is always lacking: such a check is done by hand. */
type Capability = "token" | "letters" | "access" | "guard-rules" | "https-redirect" | "rate-rule" | "bot-block" | "many-files" | "login-list" | "kept-key" | "upload-key" | "settled-upload-key" | "jobs" | "job-copy" | "person";

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

/** A site of the run that checks only read, with its page's whole body, and the one file it holds beside the page: its path from the page, and its whole text. */
export interface Shared {
  readonly site: LiveSite;
  readonly text: string;
  readonly beside: { readonly path: string; readonly text: string };
}

/** An install as an outsider and a token holder reach it. */
export interface Bench {
  /** Every address of the install as a stranger types it, in the layout the install has. */
  readonly addresses: LiveAddresses;

  /** Where the dashboard, the login, and the API answer. */
  readonly admin: string;

  /** What every site name of this run starts with. */
  readonly prefix: string;

  /** What the install lacks, with the reason. */
  readonly missing: Missing;

  /** Sends one request as a stranger: no token, no cookie, no redirect followed. One whose connection is cut off before any answer is sent once more, unless it is a change asked of the API. */
  readonly visit: (address: string, init?: RequestInit) => Promise<Response>;

  /** Reads the emails the login in front of the install lets in, at the provider itself and with the run's own key there. A run with no such key rejects. */
  readonly loginList: () => Promise<readonly string[]>;

  /** Runs one command line of the CLI, with `--json`, as the token holder. */
  readonly cli: (...words: readonly string[]) => Promise<Ran>;

  /** How many requests the token holder's commands and tools have sent so far. */
  readonly asked: () => number;

  /** How many files those commands have sent so far, by where each sending went: to the install itself, or `away`, to another place a ticket named. A file sent twice counts twice. */
  readonly sentFiles: () => { readonly install: number; readonly away: number };

  /** Calls one tool of the MCP server as the token holder and answers its structured content. */
  readonly mcp: (tool: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

  /** Writes a folder that holds one page and answers its path. */
  readonly folder: (text: string) => string;

  /** Writes a folder of many small files, an `index.html` among them, and answers its path. */
  readonly manyFiles: () => string;

  /** How many files a site holds that one request of a copy does not take, so that the install's job copies the rest. */
  readonly largeCopy: number;

  /** Reads, at the provider itself and with the run's own key there, how the job of one upload went. A run with no such key rejects, and so does a provider that holds no such job. */
  readonly jobRun: (upload: string) => Promise<JobRun>;

  /** Publishes a new site through the CLI. */
  readonly publish: (draft: Draft) => Promise<LiveSite>;

  /** The run's one site of an access for the checks that only read it, published at the first ask. A check that changes its site publishes its own. */
  readonly shared: (access: "private" | "unlisted") => Promise<Shared>;

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
