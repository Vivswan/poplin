// What sends a live run's requests runs against a server of this process: whether a request opens its own connection is the runtime's doing.
// A runtime that stopped honouring the switch would bring back publishes cut off on a closed connection, on the test install alone.

import { afterAll, describe, expect, test } from "bun:test";

import { sendLive } from "../../../scripts/live/send";

/** A server that answers each request with the port its connection came from. */
const SERVER = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request, server) => new Response(String(server.requestIP(request)?.port)) });

/** How many requests each case sends, one after another. */
const REQUESTS = 4;

/** How many connections so many requests of one kind came over. */
async function connections(init: RequestInit): Promise<number> {
  const ports = new Set<string>();
  for (let sent = 0; sent < REQUESTS; sent += 1) ports.add(await (await sendLive(`http://127.0.0.1:${SERVER.port}/`, init)).text());

  return ports.size;
}

afterAll(async () => {
  await SERVER.stop(true);
});

describe("what sends a live run's requests", () => {
  test.each<[string, RequestInit, number]>([
    ["reads share one connection", {}, 1],
    ["requests that change something each open their own", { method: "POST", body: "x" }, REQUESTS],
    ["removals each open their own", { method: "DELETE" }, REQUESTS],
  ])("%s", async (_what, init, expected) => {
    expect(await connections(init)).toBe(expected);
  });
});
