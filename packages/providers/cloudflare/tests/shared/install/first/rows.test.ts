// The lines of `poplin install` and `poplin doctor --repair` over an account whose refusals quote private values.
// Without these a row could pass a sentence of Cloudflare's on, and whatever it quotes (an id, an address, a key) would be printed to a terminal and kept in the log of a job.

import { describe, expect, test } from "bun:test";

import type { Io } from "../../../../../../cli/src/commands/records";
import { plainScreen } from "../../../../../../cli/src/local/screen";
import { run } from "../../../../../../cli/src/commands/run";
import { TOKEN_VARIABLE } from "../../../../../../cli/src/install/ask";
import type { InstallEnds, Provider } from "../../../../../../cli/src/install/records";
import { installer } from "../../../../src/shared/install/first/installer";
import { freshAccount, harnessOf, LOGIN } from "../../../live/support/harness-world";
import { ACCOUNT, TOKEN } from "../support/fake-install";
import { markersIn, PLANTED, REFUSED_WORDS } from "../support/planted";

/** The two kinds of install, each by the words that name its place. */
const KINDS = [
  { kind: "domain", place: ["--domain=example.com", `--account=${ACCOUNT}`] },
  { kind: "account address", place: ["--no-domain", `--account=${ACCOUNT}`] },
] as const;

/** The words of an install that asks nothing, before its place. */
const INSTALL = ["install", "cloudflare", `--user=${LOGIN}`, "--yes", "--adopt"];

/** The words of a repair that asks nothing, before its place. */
const REPAIR = ["doctor", "--repair", "--yes"];

/** Each command in each look it prints its rows in: plain lines, the one JSON value, and the plain lines of a dry run. A repair is of an install that stands whole. */
const COMMANDS = [
  { line: "install", words: [...INSTALL, "--no-log-in"], whole: false },
  { line: "install --json", words: [...INSTALL, "--no-log-in", "--json"], whole: false },
  { line: "install --dry-run", words: [...INSTALL, "--dry-run"], whole: false },
  { line: "doctor --repair", words: REPAIR, whole: true },
  { line: "doctor --repair --json", words: [...REPAIR, "--json"], whole: true },
  { line: "doctor --repair --dry-run", words: [...REPAIR, "--dry-run"], whole: true },
] as const;

/** What a command that printed a refusal, and nothing Cloudflare said of it, reads as: the refusal's own words are on stdout, and no planted value is in either stream. */
const CLEAN: Read = { told: true, stdout: [], stderr: [] };

/** Everything one command printed, by where it went. */
interface Printed {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What a test reads of one command's streams. */
interface Read {
  readonly told: boolean;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/** Run the words after `poplin` through the command's own entry, with the token in its variable and nobody to ask. */
async function printed(words: readonly string[], ends: Pick<InstallEnds, "reach" | "sleep">): Promise<Printed> {
  const [out, err]: [string[], string[]] = [[], []];
  const screen = plainScreen({ out: (line) => void out.push(line), err: (line) => void err.push(line) });
  const io: Io = {
    out: (line) => void out.push(line),
    screen: plainScreen({ out: (line) => void out.push(line), err: (line) => void err.push(line), status: () => undefined, ask: async () => "" }),
    fetch: (input, init) => ends.reach.fetch(input, init),
    machine: { env: { [TOKEN_VARIABLE]: TOKEN }, platform: process.platform, home: "/nowhere" },
    terminal: { asks: false, progress: false },
    computer: "test-computer",
    open: async () => false,
    pause: async () => "over",
    stopped: new AbortController().signal,
  };
  const code = await run(words, io, undefined, () => ({ providers: async () => [installer as Provider], screen, input: async () => "", reach: ends.reach, sleep: ends.sleep }));

  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** Read one command's streams: whether it said the refusal, and the kind of each planted value in each stream. */
function read(ran: Printed): Read {
  return { told: ran.stdout.includes(REFUSED_WORDS), stdout: markersIn(ran.stdout), stderr: markersIn(ran.stderr) };
}

describe.each(KINDS)("an install on its $kind whose token Cloudflare refuses in a sentence that quotes private values", ({ kind, place }) => {
  // Drift: the rows of both commands are the plug's own, printed as they come. A writer that lets Cloudflare's sentence into a row prints the key, the id, the email and the hostname it quotes.
  test.each(COMMANDS)("$line says each refusal by its status and codes, and prints no value the sentence quotes", async ({ words, whole }) => {
    const { account, world } = await harnessOf(freshAccount(), kind);
    const made = whole ? (await printed([...INSTALL, "--no-log-in", ...place], world.ends)).code : 0;
    Object.assign(account, PLANTED);

    expect([made, read(await printed([...words, ...place], world.ends))]).toEqual([0, CLEAN]);
  });
});
