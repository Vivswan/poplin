// The older build's own code, taken from the folder older-build.ts made. What installs the older build, fills it, and starts its update is that build's code, never this commit's.
//
//   install     its `live:converge`, as a child told not to start over, on an account the upgrade left no install on: `poplin install` of its own build
//   seedToken   its row of a token, in its database
//   openBench   its command line and its MCP server, run in this process
//   take        its start of an update, over its database's API driver, fed the release this commit's build is published as
//
// A part is typed as this commit's: the older build is another version's code, which no type here describes. One that moved or changed since fails where it is called.

import { join } from "node:path";
import { Writable } from "node:stream";
import type { startUpdate } from "@poplin/core/src/actions/start-update";
import type { Login } from "@poplin/core/src/auth/logins";
import type { SqlDatabase } from "@poplin/core/src/database/sql-database";

import { part, type Tree } from "../../../../tests/migrations/support/trees";
import type { liveAddresses } from "../live/addresses";
import type { openBench } from "../live/bench";
import type { apiDriver } from "../src/shared/database/api-driver";
import type { createSelfUpdate } from "../src/shared/release/update/self-update";
import type { seedToken } from "../scripts/live/tokens";
import { type Run, SCRIPT } from "../scripts/live/util";
import { versionOf } from "./older-build";

/** The provider's package, from a tree's root. */
const PACKAGE = join("packages", "providers", "cloudflare");

/** The script of the older build that makes the test install, as its package names it. */
const INSTALL_SCRIPT = "live:converge";

/** What tells that script to remove nothing, whatever the environment it inherits asks: the upgrade's own removal came before it. */
const NO_START_OVER = { POPLIN_LIVE_START_OVER: "false" } as const;

/** The parts of a build that start an update of an install. */
export interface UpdateParts {
  readonly startUpdate: typeof startUpdate;
  readonly SqlDatabase: typeof SqlDatabase;
  readonly apiDriver: typeof apiDriver;
  readonly createSelfUpdate: typeof createSelfUpdate;
}

/** What a start of an update is given. */
export interface Taking {
  /** The account, and the token that stands where the install's kept key does. */
  readonly run: Pick<Run, "connection" | "accountId">;

  /** The database the install is bound to. */
  readonly databaseId: string;

  /** The admin the start is noted under. */
  readonly holder: Login;

  /** The version the install runs. */
  readonly running: string;

  /** Answers the project's website and the release's page. */
  readonly feed: (url: string, init: RequestInit) => Promise<Response>;

  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;
}

/** What a child came to when it ended, as one run of the older build's install does. */
export interface Ended {
  /** The exit code of its script. */
  readonly code: number;

  /** Each line the script printed on its standard output. */
  readonly said: readonly string[];
}

/** The older build, as an upgrade uses it. */
export interface Older {
  /** The version it says. */
  readonly version: string;

  /** Makes the test install with its own commands, on an account that holds none, and goes on with one it began. */
  readonly install: () => Promise<Ended>;

  /** Stores an admin's token in its database. */
  readonly seedToken: typeof seedToken;

  /** Opens its command line on the install. */
  readonly openBench: typeof openBench;

  /** Writes the addresses of the install as it lays them out. */
  readonly liveAddresses: typeof liveAddresses;

  /** Starts an update of the install as it would start one itself. */
  readonly take: (given: Taking) => ReturnType<typeof startUpdate>;
}

/**
 * Start an update with a build's own code: the release is picked, fetched, and checked by its rules, the entry of the log is written, and the files are put in place by its upload.
 *
 * The minute's count of starts is the one thing left out: it is kept by a binding of the Worker, which nothing outside the Worker reaches.
 *
 * @returns what the build's own start answers
 */
export function takeWith(parts: UpdateParts, given: Taking): ReturnType<typeof startUpdate> {
  const { connection, accountId } = given.run;
  const database = new parts.SqlDatabase(parts.apiDriver(connection, { accountId, databaseId: given.databaseId }));
  const self = parts.createSelfUpdate({
    key: { connection },
    worker: { accountId, script: SCRIPT },
    version: given.running,
    last: undefined,
    now: given.now,
    fetch: (url, init) => given.feed(url, init),
    logsKept: async () => (await database.readSettings())?.provider_logs !== false,
  });
  const counters = { takeMinute: async () => ({ ok: true }) as const };

  return parts.startUpdate({ database, now: given.now }, { scope: "admin", holder: given.holder }, { version: given.running }, { self, counters });
}

/**
 * Run a script as a child, with what it prints on this process's own as it comes.
 *
 * @param env - what the child is run with
 * @returns its exit code and every line of its standard output, which an upgrade reads the row of a failed install from; what it prints as errors is shown and not kept
 */
export async function runChild(command: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<Ended> {
  const child = Bun.spawn([...command], { env: { ...env }, stdio: ["ignore", "pipe", "inherit"] });
  const [shown, kept] = child.stdout.tee();
  // This process prints after the child ended, so its own stdout stays open.
  const [said, code] = await Promise.all([new Response(kept).text(), child.exited, shown.pipeTo(Writable.toWeb(process.stdout), { preventClose: true })]);

  return { code, said: said.split("\n") };
}

/**
 * Open the older build in its folder.
 *
 * @param folder - the tree older-build.ts made, with its packages installed and its Worker built
 * @param env - what its install is run with: the account, its token, and the kind of install
 * @throws {Error} a part the upgrade uses is not where the older build is known to hold it
 */
export async function openOlder(folder: string, env: Readonly<Record<string, string | undefined>>): Promise<Older> {
  const tree: Tree = { root: folder, name: "the older build" };
  const update: UpdateParts = {
    startUpdate: await part(tree, "packages/core/src/actions/start-update.ts", "startUpdate"),
    SqlDatabase: await part(tree, "packages/core/src/database/sql-database.ts", "SqlDatabase"),
    apiDriver: await part(tree, `${PACKAGE}/src/shared/database/api-driver.ts`, "apiDriver"),
    createSelfUpdate: await part(tree, `${PACKAGE}/src/shared/release/update/self-update.ts`, "createSelfUpdate"),
  };
  const child = [process.execPath, "run", "--silent", "--cwd", join(folder, PACKAGE), INSTALL_SCRIPT];

  return {
    version: versionOf(folder),
    install: () => runChild(child, { ...env, ...NO_START_OVER }),
    seedToken: await part(tree, `${PACKAGE}/scripts/live/tokens.ts`, "seedToken"),
    openBench: await part(tree, `${PACKAGE}/live/bench.ts`, "openBench"),
    liveAddresses: await part(tree, `${PACKAGE}/live/addresses.ts`, "liveAddresses"),
    take: (given) => takeWith(update, given),
  };
}
