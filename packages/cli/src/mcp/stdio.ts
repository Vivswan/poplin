// `poplin mcp`: the MCP server on the stdin and stdout of this process. stdout carries protocol messages and nothing else.

import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { exitCode } from "../commands/exit-codes";
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
  if (session === "logged-out") return host.log("poplin mcp: not logged in; every tool call answers no_login until this computer is logged in: poplin login --server <the install's address>");

  if ("code" in session) host.log(await host.withoutTokens(`poplin mcp: ${problemLines(session).join("; ")}`));
}

/**
 * Serve the MCP tools over stdio until the agent's app closes stdin, or the person stops the server.
 *
 * A machine with no login is served all the same: the server starts, and each tool call answers how to log in.
 *
 * @returns the exit code, once the connection is closed: a failure's when the person stopped the server
 */
export async function serveOnPipes(host: Host, pipes: Pipes): Promise<number> {
  // The agent's app closing its end, or the pipe breaking, ends the session alike.
  const closed = finished(pipes.input, { writable: false }).then(
    () => "closed" as const,
    () => "closed" as const,
  );
  const stopped = once(host.stopped, "abort").then(() => "stopped" as const);
  const server = serveMcp(host, new StdioServerTransport(pipes.input, pipes.output));

  await warnOfNoLogin(host).catch(() => undefined);
  const ended = await Promise.race([closed, stopped]);
  await server.close();

  if (ended === "closed") return CLOSED;

  host.log("poplin mcp: the server was stopped");

  return exitCode({ kind: "failed" });
}
