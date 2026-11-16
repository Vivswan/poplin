// What the live scripts share: the account a run acts on, the one way a line leaves the process, and where the install of that account answers.
//
//   POPLIN_LIVE_INSTALL   domain, or absent   the install of the account that holds a domain: its zone is found, and every hostname sits under it
//                         account address     the install of the account that holds none: the account's free address is read, and its three hosts sit under that
//
// Every value that names the account, the zone, the free address, or a login is hidden before anything is printed: the runner masks it, and each line is rewritten here as well.

import { appendFileSync } from "node:fs";
import * as core from "@actions/core";
import { BaseSubdomains } from "cloudflare/resources/workers/subdomains";

import { type AccountAddresses, parseAccountAddresses } from "../../src/zone/address-layout";
import { type CloudflareFailure, type Connection, callCloudflare, listZones, type Zone } from "../../src/zone/client";
import { type DomainLayout, parseDomainLayout } from "../../src/zone/layout";
import type { BoundInstall } from "../../src/zone/zone-binding";

/** The Worker's name on the test account. */
export const SCRIPT = "poplin";

/** The bucket that holds the test install's sites. No install of a person has a bucket of this name. */
export const BUCKET = "poplin-live-sites";

/** What stands where a hidden value would have been printed. */
const HIDDEN = "[hidden]";

/** The toolkit's annotation of each level. */
const ANNOTATE = { error: core.error, warning: core.warning, notice: core.notice };

/** The statuses Cloudflare refuses a token with that lacks a permission. */
const NOT_PERMITTED: ReadonlySet<number> = new Set([401, 403]);

/** The variable that says which kind of install the run's account holds. */
const KIND_VARIABLE = "POPLIN_LIVE_INSTALL";

/** Every kind of install a run can be told. */
const KINDS: ReadonlySet<string> = new Set<BoundInstall["kind"]>(["domain", "account address"]);

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

  /** Marks the step with an error, a warning, or a notice. */
  readonly annotate: (level: keyof typeof ANNOTATE, text: string) => void;

  /** Adds Markdown to the step summary. */
  readonly summarize: (markdown: string) => void;

  /** Sets one output of the step. The value must hold nothing hidden. */
  readonly output: (name: string, value: string) => void;
}

/** A step that cannot go on: `skipped` for something the account or the token lacks, `failed` for anything else. Neither text quotes Cloudflare. */
export type Stop = { readonly kind: "skipped"; readonly needs: string } | { readonly kind: "failed"; readonly what: string };

/** The test install of a run's account, by its kind: its checked layout, the hostname its dashboard and its API answer on, and its zone, which an install on the account's free address has none of. */
export type Found =
  | { readonly kind: "domain"; readonly zone: Zone; readonly layout: DomainLayout; readonly adminHost: string }
  | { readonly kind: "account address"; readonly zone: undefined; readonly layout: AccountAddresses; readonly adminHost: string };

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
  const isSet = (file: string | undefined): file is string => file !== undefined && file !== "";

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
      if (remember(value)) core.setSecret(value);
    },
    redact,
    say: (line) => console.log(redact(line)),
    annotate: (level, text) => ANNOTATE[level](redact(text)),
    summarize: (markdown) => {
      if (isSet(env.GITHUB_STEP_SUMMARY)) appendFileSync(env.GITHUB_STEP_SUMMARY, `${redact(markdown)}\n`);
    },
    output: (name, value) => {
      if (isSet(env.GITHUB_OUTPUT)) core.setOutput(name, redact(value));
    },
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
 * Say why a script stopped, as an error on the log and a bold line in the step summary.
 *
 * @param what - what the script could not do, as the start of a sentence
 * @returns the exit code of a stopped script: a skip stops the run as a failure does, so a run that checked nothing is never green
 */
export function reportStop(run: Run, stop: Stop, what: string): number {
  const reason = stop.kind === "skipped" ? `it needs ${stop.needs}` : stop.what;
  run.summarize(`**${what}: ${reason}.**\n`);
  run.annotate("error", `${what}: ${reason}.`);

  return 1;
}

/** Find the zone of an install with a domain: the one `CLOUDFLARE_ZONE_NAME` names, or the account's only zone. */
async function findZone(run: Run, env: Readonly<Record<string, string | undefined>>): Promise<Found | Stop> {
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

  return { kind: "domain", zone, layout: layout.value, adminHost: layout.value.adminHostname };
}

/** Read the account's free address, under which an install without a domain answers on three hosts. */
async function findFreeAddress(run: Run): Promise<Found | Stop> {
  const read = await callCloudflare(run.connection, (api) => new BaseSubdomains(api).get({ account_id: run.accountId }));
  if (!read.ok) return stopOf(read, "Workers Scripts: Edit");

  // Hidden as the end of a hostname, which is how every line would hold it: the bare name may be a common word, and hiding that would rewrite other text.
  run.hide(`${read.value.subdomain}.workers.dev`);
  const layout = parseAccountAddresses({ account_address: read.value.subdomain }, SCRIPT);
  if (!layout.ok) return { kind: "failed", what: `the account's free address is none an install can use (${layout.refusal})` };

  return { kind: "account address", zone: undefined, layout: layout.value, adminHost: layout.value.adminHost };
}

/**
 * Find the test install of the run's account, of the kind `POPLIN_LIVE_INSTALL` names.
 *
 * @returns where the install answers, with every name of the zone or of the free address hidden, or why there is none
 */
export async function findInstall(run: Run, env: Readonly<Record<string, string | undefined>> = process.env): Promise<Found | Stop> {
  const kind = env[KIND_VARIABLE] ?? "";
  if (kind !== "" && !KINDS.has(kind)) return { kind: "failed", what: `${KIND_VARIABLE} names no kind of install` };

  return kind === "account address" ? findFreeAddress(run) : findZone(run, env);
}
