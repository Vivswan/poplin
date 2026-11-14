// A local stand-in for the Cloudflare API: a test hands it the replies, written by hand in the documented envelope, and reads back what was asked.

import type { Connection } from "../src/cloudflare/client";

/** One request the code under test sent. `path` holds the query string too. */
export interface Asked {
  readonly method: string;
  readonly path: string;
  readonly key: string | null;
  readonly body: unknown;
}

/** Wrap a result in Cloudflare's success envelope. */
export function reply(result: unknown): Response {
  return Response.json({ success: true, errors: [], messages: [], result });
}

/** Cloudflare's failure envelope under an HTTP status. */
export function refusal(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status, headers });
}

/** One page of a list: the items on page one and nothing after, as a list that fits one page answers. */
export function page(asked: Asked, items: readonly unknown[]): Response {
  const number = Number(new URL(asked.path, "http://localhost").searchParams.get("page") ?? "1");

  return reply(number === 1 ? items : []);
}

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
      const text = await request.text();
      const entry = {
        method: request.method,
        path: `${url.pathname}${url.search}`,
        key: request.headers.get("authorization"),
        body: text === "" ? undefined : JSON.parse(text),
      };

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
