// `poplin mcp` run in process on two pipes, with the SDK's client on their other ends.

import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import type { Io } from "../../../src/commands/records";
import { run } from "../../../src/commands/run";

/** The two pipes of a server: `input` is what it reads, `output` what it writes. */
interface Pipes {
  readonly input: PassThrough;
  readonly output: PassThrough;
}

/** A running server, the SDK's client connected to it, and its pipes. `close` ends the session as a client does, and answers the server's exit code. */
export interface McpSession extends Pipes {
  readonly client: Client;
  readonly exited: Promise<number>;
  readonly close: () => Promise<number>;
}

/**
 * Start `poplin mcp` in process and connect the SDK's client to it.
 *
 * @param pipes - the pipes to run on, for a caller that listens to them from the first byte
 * @returns the session, once the client and the server have greeted each other
 */
export async function openSession(io: Io, pipes: Pipes = { input: new PassThrough(), output: new PassThrough() }): Promise<McpSession> {
  const exited = run(["mcp"], io, pipes);
  const client = new Client({ name: "bench", version: "1.0.0" });

  // The SDK's stream transport, turned around: it reads what the server writes and writes what the server reads.
  await client.connect(new StdioServerTransport(pipes.output, pipes.input));

  return {
    ...pipes,
    client,
    exited,
    close: async () => {
      await client.close();
      pipes.input.end();

      return exited;
    },
  };
}
