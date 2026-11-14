// A local stand-in for the Cloudflare API: a test hands it the replies, written by hand in the documented envelope, and reads back what was asked.

import type { Connection } from "../../../src/zone/client";
import { type Asked, bodyOf, refusal } from "./replies";

/**
 * Serve hand-written replies on a local port for the length of one test.
 *
 * @param respond - answers one request; anything it does not know is a 404 in Cloudflare's envelope
 * @param run - receives the connection to the fake and the live list of what was asked
 */
export async function withFake(
  respond: (asked: Asked) => Response | undefined,
  run: (connection: Connection, asked: readonly Asked[]) => Promise<void>,
): Promise<void> {
  const asked: Asked[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const entry = { method: request.method, path: `${url.pathname}${url.search}`, key: request.headers.get("authorization"), body: await bodyOf(request) };

      asked.push(entry);

      return respond(entry) ?? refusal(404, 7003, "No route for that URI");
    },
  });

  try {
    await run({ key: "test-key", baseUrl: `http://localhost:${server.port}` }, asked);
  } finally {
    await server.stop(true);
  }
}
