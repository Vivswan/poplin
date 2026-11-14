// What the live scripts share: the account a run acts on, the one way a line leaves the process, and the zone the install lives on.
//
// Every value that names the account, the zone, or a login is hidden before anything is printed: the runner masks it, and each line is rewritten here as well.

import { appendFileSync } from "node:fs";

import { type CloudflareFailure, type Connection, listZones, type Zone } from "../../src/zone/client";
import { type DomainLayout, parseDomainLayout } from "../../src/zone/layout";

/** What stands where a hidden value would have been printed. */
const HIDDEN = "[hidden]";

/** The statuses Cloudflare refuses a token with that lacks a permission. */
const NOT_PERMITTED: ReadonlySet<number> = new Set([401, 403]);

/** One run of a live script: the account, the token for the one call, and the ways out of the process. */
export interface Run {
  /** The token for the one call. */
  readonly connection: Connection;

  /** The account the install lives in. */
  readonly accountId: string;

  /** What tells this run from another: the workflow run and its attempt. */
  readonly id: string;

  /** Marks a value as never to be printed. */
  readonly hide: (value: string) => void;

  /** A text with every hidden value taken out. */
  readonly redact: (text: string) => string;

  /** Prints one line. */
  readonly say: (line: string) => void;

  /** Adds Markdown to the step summary. */
  readonly summarize: (markdown: string) => void;

  /** Sets one output of the step. The value must hold nothing hidden. */
  readonly output: (name: string, value: string) => void;
}

/** A step that cannot go on: `skipped` for something the account or the token lacks, `failed` for anything else. Neither text quotes Cloudflare. */
export type Stop = { readonly kind: "skipped"; readonly needs: string } | { readonly kind: "failed"; readonly what: string };

/** The zone an install lives on and its checked layout. */
export interface Found {
  readonly zone: Zone;
  readonly layout: DomainLayout;
}

/** Tell a stop from what a step answers when it went on. */
export function isStop(value: object): value is Stop {
  return "kind" in value && (value.kind === "skipped" || value.kind === "failed");
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);

  return value;
}

/**
 * Open a run from the environment: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
 *
 * @throws {Error} one of the two is not set
 */
export function openRun(env: Readonly<Record<string, string | undefined>> = process.env): Run {
  const hidden: string[] = [];
  const redact = (text: string): string => hidden.reduce((safe, value) => safe.replaceAll(value, HIDDEN), text);
  const append = (file: string | undefined, text: string): void => {
    if (file !== undefined && file !== "") appendFileSync(file, text);
  };

  // Longest first, so a value that holds another is taken out whole. Answers whether the value is new.
  const remember = (value: string): boolean => {
    if (value === "" || hidden.includes(value)) return false;

    hidden.push(value);
    hidden.sort((one, other) => other.length - one.length);

    return true;
  };

  const run: Run = {
    connection: { key: required(env, "CLOUDFLARE_API_TOKEN") },
    accountId: required(env, "CLOUDFLARE_ACCOUNT_ID"),
    id: `${env.GITHUB_RUN_ID ?? "local"}-${env.GITHUB_RUN_ATTEMPT ?? "1"}`,
    hide: (value) => {
      if (remember(value)) console.log(`::add-mask::${value}`);
    },
    redact,
    say: (line) => console.log(redact(line)),
    summarize: (markdown) => append(env.GITHUB_STEP_SUMMARY, `${redact(markdown)}\n`),
    output: (name, value) => append(env.GITHUB_OUTPUT, `${name}=${redact(value)}\n`),
  };
  // The two secrets are masked by the runner already, so no mask line prints them.
  remember(run.connection.key);
  remember(run.accountId);

  return run;
}

/**
 * Read the login of a person the test install lets in, from `POPLIN_LIVE_LOGIN`.
 *
 * @returns the login, hidden, or `undefined` when the variable is not set
 */
export function liveLogin(run: Run, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const login = env.POPLIN_LIVE_LOGIN;
  if (login === undefined || login === "") return undefined;

  run.hide(login);

  return login;
}

/**
 * Say why a call to Cloudflare stopped a step.
 *
 * @param permission - the token permission the call needs
 * @returns `skipped` for a token that lacks the permission, `failed` with the status and the error codes for anything else
 */
export function stopOf(failure: CloudflareFailure, permission: string): Stop {
  if (failure.failure === "network") return { kind: "failed", what: "Cloudflare did not answer" };

  if (failure.failure === "rate-limited") return { kind: "failed", what: "Cloudflare asked to wait" };

  if (NOT_PERMITTED.has(failure.status)) return { kind: "skipped", needs: `the token permission ${permission}` };

  return { kind: "failed", what: `Cloudflare refused with status ${failure.status} and codes ${failure.errors.map((error) => error.code).join(", ")}` };
}

/**
 * Find the zone of the install: the one `CLOUDFLARE_ZONE_NAME` names, or the account's only zone.
 *
 * @returns the zone with its name and id hidden, or why there is none
 */
export async function findInstall(run: Run, env: Readonly<Record<string, string | undefined>> = process.env): Promise<Found | Stop> {
  const zones = await listZones(run.connection, run.accountId);
  if (!zones.ok) return stopOf(zones, "Zone: Read");

  for (const zone of zones.value) {
    run.hide(zone.name);
    run.hide(zone.id);
  }

  const named = env.CLOUDFLARE_ZONE_NAME;
  const [zone, ...others] = named === undefined || named === "" ? zones.value : zones.value.filter((candidate) => candidate.name === named);
  if (zone === undefined || others.length > 0) return { kind: "skipped", needs: "exactly one zone in the account, or the zone's name in CLOUDFLARE_ZONE_NAME" };

  const layout = parseDomainLayout({ domain: zone.name });
  if (!layout.ok) return { kind: "failed", what: `the zone's name is no domain an install can use (${layout.refusal})` };

  return { zone, layout: layout.value };
}
