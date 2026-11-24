// The product's own install commands, run in this process on the test account: the lines a person types, with the answers of a run that asks nothing.
//
//   poplin install cloudflare   (--domain=<name> | --no-domain) --account=<id> --user=<email> --yes --adopt --no-log-in --json
//   poplin doctor --repair      (--domain=<name> | --no-domain) --account=<id> --yes --json
//   poplin uninstall cloudflare (--domain=<name> | --no-domain) --account=<id> --dry-run --json, then --confirm=<what the dry run says to type> --json
//
// The project's website and the release's page are answered from this commit's own build, so the release a command takes is the commit; every other request goes out as it is.
// A line a command says beside its value is printed with every hidden name taken out. No row's detail is printed: it may quote Cloudflare.

import { join } from "node:path";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import type { Reach } from "@poplin/core/src/install/installer";
import { type ReleasePins, releaseDigest } from "@poplin/core/src/records/release";
import * as v from "valibot";

import { homepage, version as OWN_VERSION } from "../../../../cli/package.json";
import type { Io } from "../../../../cli/src/commands/records";
import { plainScreen } from "../../../../cli/src/local/screen";
import { TOKEN_VARIABLE } from "../../../../cli/src/install/ask";
import { runInstall } from "../../../../cli/src/install/first/install";
import type { Provider } from "../../../../cli/src/install/records";
import { runUninstall } from "../../../../cli/src/install/remove/uninstall";
import { runRepair } from "../../../../cli/src/install/repair/repair";
import { installer } from "../../src/shared/install/first/installer";
import { bundleManifest, MAP_FILE, MODULE_FILE } from "../../src/shared/release/publish/bundle-manifest";
import { bundleAddress, MANIFEST_FILE } from "../../src/shared/release/publish/release-source";
import type { Found, Run } from "./util";

/** This package's folder. */
const PACKAGE = join(import.meta.dir, "..", "..");

/** Where the project's website names every release. */
const PINS_ADDRESS = new URL("releases.json", homepage).href;

/** What runs the words after each command. */
const COMMANDS = { install: runInstall, repair: runRepair, uninstall: runUninstall } as const;

/** One row of a command's value: its object, and what the run did to it, or a dry run would. */
const ROW = v.object({ object: v.string(), did: v.optional(v.string()), will: v.optional(v.string()), detail: v.string(), right: v.optional(v.string()), count: v.optional(v.number()) });

/** The value of a command that worked through its rows, or stopped before them, as far as a run reads it. */
const VALUE = v.object({
  problem: v.optional(v.string()),
  rows: v.optional(v.array(ROW)),
  confirm: v.optional(v.string()),
  found: v.optional(v.object({ version: v.optional(v.nullable(v.string())) })),
});

/** The files of one build of the Worker, and the tree they were built from. */
interface Built {
  /** The version the tree names. */
  readonly version: string;

  /** The tree's wrangler.jsonc, parsed. */
  readonly config: unknown;

  /** The built module and its source map. */
  readonly files: { readonly [MODULE_FILE]: Uint8Array<ArrayBuffer>; readonly [MAP_FILE]: Uint8Array<ArrayBuffer> };
}

/** This commit's build as a release the project published: its version, what the website would name of it, and each address a command fetches with what answers there. */
export interface Published {
  readonly version: string;
  readonly pin: ReleasePins[string];
  readonly pages: ReadonlyMap<string, string | Uint8Array<ArrayBuffer>>;
}

/** One row of a command, as a run sorts it. `detail` is never printed. */
export interface CommandRow {
  readonly object: string;
  readonly state: string;
  readonly detail: string;
  readonly right?: string | undefined;
  readonly count?: number | undefined;
}

/**
 * What a command came to.
 *
 * `rows` is a command that worked through its rows, whatever its exit code: `confirm` is what a removal's dry run says to type.
 * `stopped` is a command that stopped before any row, with its problem's code, and the version of an install that is there already. `unread` printed no value a run can read.
 */
export type Answer =
  | { readonly kind: "rows"; readonly rows: readonly CommandRow[]; readonly confirm: string | undefined }
  | { readonly kind: "stopped"; readonly problem: string; readonly version: string | undefined }
  | { readonly kind: "unread"; readonly code: number };

/** What a command reaches the world through, and rests by. */
export interface Ends {
  readonly reach: Reach;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

/** Read the build the workflow made of this commit, beside the tree's own version and Worker configuration. */
export async function readBuilt(): Promise<Built> {
  const file = (name: string): Promise<Uint8Array<ArrayBuffer>> => Bun.file(join(PACKAGE, "dist", name)).bytes();

  return {
    version: OWN_VERSION,
    config: Bun.JSONC.parse(await Bun.file(join(PACKAGE, "..", "..", "..", "wrangler.jsonc")).text()),
    files: { [MODULE_FILE]: await file(MODULE_FILE), [MAP_FILE]: await file(MAP_FILE) },
  };
}

/**
 * Make of a build what a release is: the manifest the release's own writer writes, and the line the website would name it by.
 *
 * @returns the build as published, at the addresses the product fetches a release from
 */
export async function publish(built: Built): Promise<Published> {
  const { version, files } = built;
  const manifest = await bundleManifest({ version, schema: OWN_SCHEMA, config: built.config, files });
  const pin = { bundle: await releaseDigest(new TextEncoder().encode(manifest)), schema: OWN_SCHEMA };
  const pages = new Map<string, string | Uint8Array<ArrayBuffer>>([
    [PINS_ADDRESS, JSON.stringify({ [version]: pin })],
    [bundleAddress(version, MANIFEST_FILE), manifest],
    [bundleAddress(version, MODULE_FILE), files[MODULE_FILE]],
    [bundleAddress(version, MAP_FILE), files[MAP_FILE]],
  ]);

  return { version, pin, pages };
}

/**
 * The world a command meets: the published build where the product asks for a release, and everything else as it is.
 *
 * @param pass - sends every other request
 */
export function reachOf(published: Published, pass: Reach["fetch"]): Reach {
  return {
    fetch: async (input, init) => {
      const page = published.pages.get(input instanceof Request ? input.url : String(input));

      return page === undefined ? pass(input, init) : new Response(page);
    },
    now: Date.now,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
  };
}

/** The provider's own options that say which install is meant: its place, and the account of the run. */
export function placeWords(run: Pick<Run, "accountId">, found: Found): readonly string[] {
  return [found.kind === "domain" ? `--domain=${found.layout.domain}` : "--no-domain", `--account=${run.accountId}`];
}

/** Read the one JSON value a command printed. */
function answerOf(printed: readonly string[], code: number): Answer {
  const [line = ""] = printed;
  const value = v.safeParse(v.pipe(v.string(), v.parseJson(), VALUE), line);
  if (!value.success) return { kind: "unread", code };

  const { rows, problem, found, confirm } = value.output;
  if (rows !== undefined) return { kind: "rows", rows: rows.map(({ did, will, ...row }) => ({ ...row, state: did ?? will ?? "" })), confirm };

  return problem === undefined ? { kind: "unread", code } : { kind: "stopped", problem, version: found?.version ?? undefined };
}

/**
 * Run one command of the product in this process, as a run that asks nothing, and read its value.
 *
 * @param words - the words after the command, `--json` among them
 * @returns what the command came to; each line it said beside its value went to the log, with every hidden name taken out
 */
export async function command(run: Run, name: keyof typeof COMMANDS, words: readonly string[], ends: Ends): Promise<Answer> {
  const printed: string[] = [];
  const io: Io = {
    out: (line) => void printed.push(line),
    screen: plainScreen({ out: (line) => void printed.push(line), err: run.say, status: () => undefined, ask: async () => "" }),
    fetch: (input, init) => ends.reach.fetch(input, init),
    machine: { env: { [TOKEN_VARIABLE]: run.connection.key }, platform: process.platform, home: PACKAGE },
    terminal: { asks: false, progress: false },
    computer: "live-checks",
    open: async () => false,
    pause: async (milliseconds) => {
      await ends.sleep(milliseconds);

      return "over";
    },
    stopped: new AbortController().signal,
  };
  const screen = plainScreen({ out: run.say, err: run.say });
  const code = await COMMANDS[name](words, io, { providers: async () => [installer as Provider], screen, input: async () => "", reach: ends.reach, sleep: ends.sleep });

  return answerOf(printed, code);
}
