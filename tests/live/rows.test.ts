// The meter of rows written runs against a fake: the provider's free plan takes 100,000 rows a day and then refuses every write, and a request the meter said it held back and sent all the same would show as a day of red runs alone.

import { describe, expect, test } from "bun:test";

import { meterRows } from "../../packages/cloudflare/scripts/live/rows";

/** The origin of the install a made-up request goes to. */
const SERVER = "https://poplin.example.com";

/** A site's own address on the made-up install. */
const SITE = "https://docs-u-poplin.example.com/";

/** A request that carries JSON. */
function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

/** A `fetch` that answers every request and keeps what it was sent. */
function fake(): { readonly sent: string[]; readonly fetch: (input: string, init: RequestInit) => Promise<Response> } {
  const sent: string[] = [];

  return {
    sent,
    fetch: async (input, init) => {
      sent.push(`${init.method ?? "GET"} ${new URL(input).pathname}`);

      return new Response("{}");
    },
  };
}

describe("the meter of rows written", () => {
  test("a request past the ceiling is held back and never sent, every later one that writes too, while one that reads still goes out", async () => {
    const install = fake();
    const meter = meterRows(install.fetch, 30);
    const publish = async (): Promise<number> => (await meter.fetch(`${SERVER}/api/uploads`, json("POST", { name: "docs", files: [] }))).status;

    const ended = [await publish(), await publish(), (await meter.fetch(`${SERVER}/api/config`, json("PATCH", {}))).status, (await meter.fetch(`${SERVER}/api/sites`, {})).status];

    expect({ ended, written: meter.written(), sent: install.sent, stopped: meter.stopped() }).toEqual({
      ended: [200, 403, 403, 200],
      written: 25,
      sent: ["POST /api/uploads", "GET /api/sites"],
      stopped: "passed its ceiling of 30 rows written to the database",
    });
  });

  test("a request that changes something on a route with no price is held back, and names why", async () => {
    const install = fake();
    const meter = meterRows(install.fetch, 100);
    const answered = await meter.fetch(`${SERVER}/api/sites/docs/duplicate`, json("POST", {}));

    expect({ status: answered.status, sent: install.sent, stopped: meter.stopped() }).toEqual({ status: 403, sent: [], stopped: "sent POST to a route of the API that has no price in rows" });
  });

  // A visit's rows are known by its answer alone, so it is sent before it is counted: visits that passed the ceiling unseen would leave a run green past it.
  test("the visit that takes the count past the ceiling stops the step, and the visit and the request that writes after it are held back, while a listing still goes out", async () => {
    const install = fake();
    const meter = meterRows(install.fetch, 3);
    const visits = [(await meter.fetch(SITE, {})).status, (await meter.fetch(SITE, {})).status, (await meter.fetch(SITE, {})).status];
    const change = await meter.fetch(`${SERVER}/api/config`, json("PATCH", {}));
    const listing = await meter.fetch(`${SERVER}/api/sites`, {});

    expect({ visits, change: change.status, listing: listing.status, written: meter.written(), stopped: meter.stopped() }).toEqual({
      visits: [200, 200, 403],
      change: 403,
      listing: 200,
      written: 4,
      stopped: "passed its ceiling of 3 rows written to the database",
    });
  });
});
