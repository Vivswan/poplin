// `poplin mcp`: the MCP server on the stdin and stdout of this process. stdout carries protocol messages and nothing else.

import type { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { problemLines } from "../commands/problems";
import type { Host } from "./records";
import { serveMcp } from "./server";

/** The exit code of a server whose agent closed the connection. */
const CLOSED = 0;

/** The two ends the protocol is spoken on. */
export interface Pipes {
  /** Where the agent's app writes its messages: the process's stdin. */
  readonly input: Readable;

  /** Where the server writes its own, one JSON value a line: the process's stdout. */
  readonly output: Writable;
}

/** Say on stderr that no login can be used, for the person who reads the agent app's log. The server runs all the same, and every tool call answers the same problem. */
async function warnOfNoLogin(host: Host): Promise<void> {
  const session = await host.session();
  if (session === "logged-out") return host.log("poplin mcp: not logged in; every tool call answers no_login until POPLIN_SERVER and POPLIN_TOKEN are set");

  if ("code" in session) host.log(await host.withoutTokens(`poplin mcp: ${problemLines(session).join("; ")}`));
}

/**
 * Serve the MCP tools over stdio until the agent's app closes stdin.
 *
 * A machine with no login is served all the same: the server starts, and each tool call answers how to log in.
 *
 * @returns the exit code, once the connection is closed
 */
export async function serveOnPipes(host: Host, pipes: Pipes): Promise<number> {
  // The agent's app closing its end, or the pipe breaking, ends the session alike.
  const closed = finished(pipes.input, { writable: false }).catch(() => undefined);
  const server = serveMcp(host, new StdioServerTransport(pipes.input, pipes.output));

  await warnOfNoLogin(host).catch(() => undefined);
  await closed;
  await server.close();

  return CLOSED;
}
