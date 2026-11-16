// An agent's app writes whatever it likes on the server's stdin, and a model fills in the tool arguments. No message may crash the server, leave a call unanswered, or put anything but a protocol message on stdout.
//
// A publish reads the folder it is given, so a fuzzed path would walk whatever part of the disk it names: a publish is given one of PATHS.

import { afterAll, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import fc from "fast-check";

import { createClient } from "../../packages/cli/src/client/client";
import { run } from "../../packages/cli/src/commands/run";
import { protocolMessages } from "../../packages/cli/tests/mcp/support/bench";
import { TOOL_INPUTS } from "../../packages/core/src/actions/tool-inputs";
import { STARTED_UPDATE } from "../../packages/core/src/actions/start-update";
import { UPDATE_STATE } from "../../packages/core/src/actions/update";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const SERVER = "https://poplin.example.com";
const TOKEN = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;
const CRASHED = "poplin failed in a way it has no word for";
const SCRATCH = mkdtempSync(join(tmpdir(), "poplin-fuzz-"));
const FOLDER = join(SCRATCH, "report");
const TOOL_NAMES = Object.keys(TOOL_INPUTS);
const ARGUMENT_NAMES = [...new Set(Object.values(TOOL_INPUTS).flatMap((schema) => Object.keys(schema.entries)))];
const METHODS = [
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "prompts/list",
  "notifications/cancelled",
  "logging/setLevel",
  "server/discover",
];
const HELLO = {
  jsonrpc: "2.0",
  id: "hello",
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "a fuzz target", version: "1.0.0" } },
};
const READY = { jsonrpc: "2.0", method: "notifications/initialized" };
const LAST = { jsonrpc: "2.0", id: "the-last", method: "ping" };
const SITES = ["report--k3f9x2ab71qz", "k3f9x2ab71qz", "report", "docs", "./report", "", TOKEN];
const PATHS = [FOLDER, join(FOLDER, "index.html"), join(SCRATCH, "no-such-folder"), ""];
const ANSWERS: readonly (Response | undefined)[] = [
  undefined,
  new Response(JSON.stringify({ error: { code: "not_found", message: `nothing here for ${TOKEN}` } }), { status: 404 }),
  new Response(JSON.stringify({ sites: [] }), { status: 200 }),
  new Response("<html>a login page</html>", { status: 200 }),
  new Response(JSON.stringify({ upload: { id: "0123456789abcdef", state: "pending", version: 1, files: 1, bytes: 1, expires: 0 } }), { status: 200 }),
];

interface Session {
  readonly code: number;
  readonly written: readonly string[];
  readonly logged: readonly string[];
  readonly asked: readonly string[];
}

const property = fuzzTarget(import.meta.file);
const UPDATE_PATHS = await updatePaths();

const ids = fc.oneof(fc.integer(), fc.string({ maxLength: 8 }), fc.constant(null));
const strings = fc.oneof(
  fc.constantFrom(...SITES, "7d", "never", "2026-12-01", "public", "unlisted", "private"),
  hostile(fc.constantFrom(...SITES, "7d", "public")),
);
const values = fc.oneof(
  { arbitrary: strings, weight: 4 },
  { arbitrary: fc.boolean(), weight: 2 },
  { arbitrary: fc.integer({ min: -2, max: 9 }), weight: 1 },
  { arbitrary: fc.jsonValue(), weight: 2 },
);
const toolArguments = fc
  .tuple(
    fc.dictionary(fc.oneof({ arbitrary: fc.constantFrom(...ARGUMENT_NAMES), weight: 6 }, { arbitrary: fc.string({ maxLength: 6 }), weight: 1 }), values, {
      maxKeys: 6,
    }),
    fc.constantFrom(...PATHS),
    fc.boolean(),
  )
  .map(([asked, path, withPath]) => {
    const { path: fuzzed, ...rest } = asked;

    return withPath || fuzzed !== undefined ? { ...rest, path } : rest;
  });
const toolCalls = fc.record({ name: fc.constantFrom(...TOOL_NAMES), arguments: toolArguments });
const calls = toolCalls.map((params) => JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params }));
const requests = fc
  .record(
    {
      jsonrpc: fc.constantFrom("2.0", "1.0", 2),
      id: ids,
      method: fc.oneof(fc.constantFrom(...METHODS), hostile(fc.constantFrom(...METHODS))),
      params: fc.jsonValue(),
    },
    { requiredKeys: [] },
  )
  .map((message) => JSON.stringify(message));
const lines = fc.oneof(
  { arbitrary: calls, weight: 4 },
  { arbitrary: requests, weight: 4 },
  { arbitrary: fc.constantFrom(JSON.stringify(HELLO), JSON.stringify(READY)), weight: 2 },
  {
    arbitrary: hostile(
      fc.constantFrom(
        JSON.stringify(HELLO),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_site", arguments: { site: "report" } } }),
      ),
    ),
    weight: 3,
  },
  { arbitrary: fc.jsonValue().map((value) => JSON.stringify(value)), weight: 1 },
);
const answers = fc.constantFrom(...ANSWERS);

/** The paths of the routes that update an install, as the client asks for them of a stand-in that answers nothing of use. */
async function updatePaths(): Promise<readonly string[]> {
  const paths: string[] = [];
  const client = createClient({
    server: SERVER,
    fetch: async (address) => {
      paths.push(new URL(address).pathname);

      return new Response("{}");
    },
  });

  await client.call(STARTED_UPDATE, (api) => api.update.$post({ query: {} }));
  await client.call(UPDATE_STATE, (api) => api.update.$get({ query: {} }));

  return paths;
}

/**
 * Run `poplin mcp` in process over two pipes: write the lines, wait until `done` holds of what the server wrote, close stdin, and wait for the exit.
 *
 * The machine is logged in, and every request to the install is answered with `answer`, or fails when there is none.
 */
async function serve(input: readonly string[], answer: Response | undefined, done: (written: readonly string[]) => boolean): Promise<Session> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const logged: string[] = [];
  const asked: string[] = [];
  let text = "";
  const written = (): string[] => text.split("\n").filter((line) => line !== "");

  const settled = new Promise<void>((resolve) => {
    stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      if (done(written())) resolve();
    });
  });

  const exited = run(
    ["mcp"],
    {
      out: (line) => logged.push(`on stdout: ${line}`),
      err: (line) => logged.push(line),
      status: (line) => logged.push(`a progress line: ${line}`),
      fetch: async (address) => {
        asked.push(new URL(address).pathname);
        if (answer === undefined) throw new Error(`no route to ${TOKEN}`);

        return answer.clone();
      },
      machine: { env: { POPLIN_SERVER: SERVER, POPLIN_TOKEN: TOKEN, POPLIN_CONFIG_DIR: join(SCRATCH, "config") }, platform: process.platform, home: SCRATCH },
      terminal: { asks: true, progress: true },
      ask: async () => "report--k3f9x2ab71qz",
      timeoutMs: 1000,
      computer: "laptop",
      open: () => undefined,
      pause: async () => "over",
      stopped: new AbortController().signal,
    },
    { input: stdin, output: stdout },
  );

  for (const line of input) stdin.write(`${line}\n`);

  await settled;
  stdin.end();

  return { code: await exited, written: written(), logged, asked };
}

function answered(written: readonly string[], id: unknown): boolean {
  return written.some((line) => line.includes(`"id":${JSON.stringify(id)}`));
}

function assertOnlyProtocol(session: Session): void {
  const said = [...session.written, ...session.logged].join("\n");

  expect(session.code).toBe(0);
  expect(() => protocolMessages(session.written)).not.toThrow();
  expect(said).not.toContain(CRASHED);
  expect(said).not.toContain(TOKEN);
  expect(session.logged.filter((line) => !line.startsWith("poplin mcp: "))).toEqual([]);
  // An agent replaces no code of the install: whatever it sends, no request goes to the routes that update it.
  expect(session.asked.filter((path) => UPDATE_PATHS.some((update) => path.startsWith(update)))).toEqual([]);
}

mkdirSync(FOLDER);
writeFileSync(join(FOLDER, "index.html"), "<title>Report</title>");
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

property(
  "whatever lines arrive on stdin, the server still answers a ping after them, exits 0 when stdin closes, and writes protocol messages alone with no token in them",
  fc.asyncProperty(fc.array(lines, { maxLength: 8 }), answers, async (input, answer) => {
    const session = await serve([JSON.stringify(HELLO), ...input, JSON.stringify(LAST)], answer, (written) => answered(written, LAST.id));

    assertOnlyProtocol(session);
  }),
);

property(
  "whatever arguments a tool is called with and whatever the install answers, every call gets its own result or error, and none is a crash",
  fc.asyncProperty(fc.array(toolCalls, { minLength: 1, maxLength: 6 }), answers, async (asked, answer) => {
    const sent = asked.map((params, id) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params }));
    const all = (written: readonly string[]): boolean => asked.every((_call, id) => answered(written, id));

    const session = await serve([JSON.stringify(HELLO), JSON.stringify(READY), ...sent], answer, all);
    const results = session.written.map((line) => JSON.parse(line)).filter((message) => typeof message.id === "number");

    assertOnlyProtocol(session);
    expect(results.filter((message) => message.result?.content?.[0]?.type !== "text" && message.error === undefined)).toEqual([]);
  }),
);
