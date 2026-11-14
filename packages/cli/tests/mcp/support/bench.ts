// A bench for the MCP tests: the real API of an install in memory, `poplin mcp` run in process on two pipes, and the SDK's client on their other ends.

import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/client";
import { type JSONRPCMessage, parseJSONRPCMessage } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { type ApiInstall, ORIGIN, openApi } from "../../../../app/tests/api/support/install";
import type { Io } from "../../../src/commands/records";
import { run } from "../../../src/commands/run";
import { sendUnlessAborted } from "../../commands/support/harness";

/** What a test may answer a request with in the install's place; nothing lets the install answer. */
type Hook = (request: Request) => Response | undefined | Promise<Response | undefined>;

/** What one tool call answered: whether it is a tool error, its text, and its structured content. */
export interface Answer {
  readonly error: boolean;
  readonly text: string;
  readonly data: Record<string, unknown>;
}

/**
 * A running server and the means to call it.
 *
 * `written` holds every line the server wrote on its stdout and `logged` every line on its stderr; `sent` lists every request to the install as its method and path.
 * `stop` stops the server as the person's first Ctrl-C does, and answers its exit code.
 */
export interface McpBench {
  readonly install: ApiInstall;
  readonly client: Client;
  readonly written: readonly string[];
  readonly logged: string[];
  readonly sent: string[];
  hook: Hook | undefined;
  readonly call: (tool: string, args?: Record<string, unknown>) => Promise<Answer>;
  readonly write: (line: string) => void;
  readonly close: () => Promise<number>;
  readonly stop: () => Promise<number>;
}

/**
 * Read every line the server wrote as the protocol message it must be, with the SDK's own check.
 *
 * @throws the SDK's error for the first line that is no JSON-RPC message
 */
export function protocolMessages(lines: readonly string[]): JSONRPCMessage[] {
  return lines.map((line) => parseJSONRPCMessage(JSON.parse(line)));
}

/** Fail when a token is in anything the server wrote or logged: a token goes to the install and nowhere else. */
function assertNoToken(bench: McpBench, tokens: readonly string[]): void {
  const said = [...bench.written, ...bench.logged].join("\n");
  const leaked = tokens.find((token) => said.includes(token));

  if (leaked !== undefined) throw new Error(`a token was written: ${said.replaceAll(leaked, "<the token>")}`);
}

/**
 * Start `poplin mcp` in process against a fresh install and connect the SDK's client to it.
 *
 * @param env - the environment, in place of the admin's login
 * @param home - the home folder the saved login is looked for under
 */
export async function openMcp(home: string, env?: Readonly<Record<string, string | undefined>>): Promise<McpBench> {
  const install = await openApi();
  const login = env ?? { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: install.tokens.admin };
  const tokens = [...Object.values(install.tokens), login.POPLIN_TOKEN ?? ""].filter((token) => token !== "");
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  const logged: string[] = [];
  const sent: string[] = [];
  const stopping = new AbortController();

  const io: Io = {
    out: () => {
      throw new Error("the server printed a line on stdout");
    },
    err: (text) => logged.push(text),
    status: () => {
      throw new Error("the server wrote a progress line");
    },
    fetch: (target, init) =>
      sendUnlessAborted(init.signal, async () => {
        const request = new Request(target, init);
        const url = new URL(request.url);
        sent.push(`${request.method} ${url.pathname}${url.search}`);

        return (await bench.hook?.(request)) ?? install.api.fetch(request);
      }),
    machine: { env: { POPLIN_CONFIG_DIR: `${home}/config`, ...login }, platform: process.platform, home },
    terminal: { asks: true, progress: true },
    ask: async () => {
      throw new Error("the server asked a question");
    },
    timeoutMs: 2000,
    computer: "laptop",
    open: () => undefined,
    pause: async () => "over",
    stopped: stopping.signal,
  };

  const exited = run(["mcp"], io, { input, output });
  const client = new Client({ name: "bench", version: "1.0.0" });

  const bench: McpBench = {
    install,
    client,
    get written() {
      return text.split("\n").filter((line) => line !== "");
    },
    logged,
    sent,
    hook: undefined,
    call: async (tool, args = {}) => {
      const result = await client.callTool({ name: tool, arguments: args });
      const [first] = Array.isArray(result.content) ? result.content : [];
      assertNoToken(bench, tokens);

      return {
        error: result.isError === true,
        text: first?.type === "text" ? first.text : "",
        data: { ...(result.structuredContent as Record<string, unknown> | undefined) },
      };
    },
    write: (line) => {
      input.write(`${line}\n`);
    },
    close: async () => {
      await client.close();
      input.end();
      const code = await exited;
      assertNoToken(bench, tokens);

      return code;
    },
    stop: () => {
      stopping.abort();

      return exited;
    },
  };

  output.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  // The SDK's stream transport, turned around: it reads what the server writes and writes what the server reads.
  await client.connect(new StdioServerTransport(output, input));

  return bench;
}
