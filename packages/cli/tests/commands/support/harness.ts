// A bench for the command tests: the real API of an install in memory, the command run in process against it, and everything the command printed.

import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type ApiInstall, type LayoutInput, answered, ORIGIN, openApi } from "../../../../app/tests/api/support/install";
import type { Io } from "../../../src/commands/records";
import { run } from "../../../src/commands/run";
import { words } from "./command-line";

/** The scratch folders the tests made, removed by `cleanUp`. */
const SCRATCH: string[] = [];

/** What a test may answer a request with in the install's place; nothing lets the install answer. */
type Hook = (request: Request) => Response | undefined | Promise<Response | undefined>;

/** How one command is run. */
interface Options {
  /** The environment, in place of the admin's login. */
  readonly env?: Readonly<Record<string, string | undefined>>;

  /** Whether a terminal is there to ask on and to show progress on; neither unless said. */
  readonly terminal?: Io["terminal"];

  /** What the person types when asked. */
  readonly typed?: string;
}

/** What one command printed, and how it exited. `asked` holds the questions it put, `opened` the addresses it handed to a browser, and `waits` how long each of its waits was, in milliseconds. */
export interface Ran {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly status: string[];
  readonly asked: string[];
  readonly opened: string[];
  readonly waits: number[];
}

/**
 * An install and the means to run commands against it. `sent` lists every request as its method and path.
 *
 * A command's wait takes no time: it moves the install's clock on by as long, then calls `paused` with what the command printed so far, which may answer that the person stopped the command.
 * `stop` stops the command that is running, as the person's first Ctrl-C does: at any moment, a wait or not.
 */
export interface Bench {
  readonly install: ApiInstall;
  readonly sent: string[];
  readonly home: string;
  hook: Hook | undefined;
  paused: ((ran: Ran) => Promise<"over" | "interrupted" | undefined>) | undefined;
  readonly stop: () => void;
  readonly run: (line: string, options?: Options) => Promise<Ran>;
}

/** Make an empty folder that `cleanUp` removes; answers its path. */
export function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), "poplin-cli-"));
  SCRATCH.push(folder);

  return folder;
}

/** Remove every scratch folder; a test file calls it after each test. */
export function cleanUp(): void {
  for (const folder of SCRATCH.splice(0)) rmSync(folder, { recursive: true, force: true });
}

/**
 * Write a folder of pages to publish.
 *
 * @param name - the folder's name, which a new site takes
 * @returns the folder's path
 */
export function folderOf(name: string, pages: Readonly<Record<string, string>>): string {
  const folder = join(scratch(), name);

  for (const [path, text] of Object.entries(pages)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  return folder;
}

/**
 * Send a request as the platform's `fetch` does one with a signal: nothing is sent once the signal aborted, and a request on its way is then rejected at once.
 *
 * @param send - what sends the request and answers it
 */
export async function sendUnlessAborted(signal: AbortSignal | null | undefined, send: () => Promise<Response>): Promise<Response> {
  if (signal == null) return send();

  signal.throwIfAborted();
  const answered = new AbortController();
  const aborted = once(signal, "abort", { signal: answered.signal }).then(() => Promise.reject(signal.reason));

  try {
    return await Promise.race([send(), aborted]);
  } finally {
    answered.abort();
  }
}

/** What an install holds that only a finished upload may change: the sites, and the keys of the store. */
export async function stateOf(bench: Bench): Promise<unknown> {
  const sites = await answered(bench.install.routes.sites.$get());

  return [sites.body, await bench.install.keys()];
}

/** Fail when a token is anywhere in what a command printed: a token goes to the install and nowhere else. */
function assertNoToken(ran: Ran, tokens: readonly string[]): void {
  const printed = [...ran.out, ...ran.err, ...ran.status, ...ran.asked].join("\n");
  const leaked = tokens.find((token) => printed.includes(token));

  if (leaked !== undefined) throw new Error(`a token was printed: ${printed.replaceAll(leaked, "<the token>")}`);
}

/**
 * Open a fresh install and a way to run commands against it, logged in as the admin through the environment.
 *
 * Every run is checked for a printed token before it is handed back.
 *
 * @param layout - how the install says its site addresses are laid out, in place of hostnames that end in `page`
 */
export async function openBench(layout?: LayoutInput): Promise<Bench> {
  const install = await openApi(undefined, undefined, layout);
  const home = scratch();
  const sent: string[] = [];
  let stopping = new AbortController();

  const bench: Bench = {
    install,
    sent,
    home,
    hook: undefined,
    paused: undefined,
    stop: () => stopping.abort(),
    run: async (line, options = {}) => {
      const ran: Ran = { code: -1, out: [], err: [], status: [], asked: [], opened: [], waits: [] };
      const env = options.env ?? { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: install.tokens.admin };
      stopping = new AbortController();

      const io: Io = {
        out: (text) => ran.out.push(text),
        err: (text) => ran.err.push(text),
        status: (text) => ran.status.push(text),
        fetch: (input, init) =>
          sendUnlessAborted(init.signal, async () => {
            const request = new Request(input, init);
            const url = new URL(request.url);
            sent.push(`${request.method} ${url.pathname}${url.search}`);

            return (await bench.hook?.(request)) ?? install.api.fetch(request);
          }),
        machine: { env: { POPLIN_CONFIG_DIR: join(home, "config"), ...env }, platform: process.platform, home },
        terminal: options.terminal ?? { asks: false, progress: false },
        ask: async (question) => {
          ran.asked.push(question);

          return options.typed ?? "";
        },
        timeoutMs: 2000,
        computer: "test-computer",
        open: (address) => {
          ran.opened.push(address);
        },
        // A stop ends a wait, and a wait the test stops is the one stop the command hears of.
        pause: async (ms) => {
          install.clock.now += ms;
          ran.waits.push(ms);
          if ((await bench.paused?.(ran)) === "interrupted") stopping.abort();

          return stopping.signal.aborted ? "interrupted" : "over";
        },
        stopped: stopping.signal,
      };

      const code = await run(words(`poplin ${line}`), io);
      assertNoToken(ran, [...Object.values(install.tokens), env.POPLIN_TOKEN ?? ""].filter((token) => token !== ""));

      return { ...ran, code };
    },
  };

  return bench;
}

/** The one JSON value a command printed on stdout; fails when stdout holds anything else. */
export function jsonOf(ran: Pick<Ran, "out">): Record<string, unknown> {
  if (ran.out.length !== 1) throw new Error(`stdout holds ${ran.out.length} lines, not one JSON value: ${ran.out.join("\n")}`);

  return JSON.parse(ran.out[0] ?? "");
}

/**
 * Publish a folder of pages as a new site.
 *
 * @param flags - what the publish is run with beside the folder, such as `--unlisted`
 * @returns the site's label
 */
export async function published(bench: Bench, name: string, pages: Readonly<Record<string, string>>, flags = ""): Promise<string> {
  const made = jsonOf(await bench.run(`${folderOf(name, pages)} ${flags} --json`));

  return (made.site as { label: string }).label;
}
