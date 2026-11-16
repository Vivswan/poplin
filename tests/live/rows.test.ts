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

/** A `fetch` that answers the requests about one copy with the given answers, in order. */
function copying(answers: readonly unknown[]): (input: string, init: RequestInit) => Promise<Response> {
  let at = 0;

  return async () => {
    at += 1;
    const answer = answers[at - 1];

    return typeof answer === "number" ? new Response("<p>an error page</p>", { status: answer }) : Response.json(answer);
  };
}

/** A copy of 300 files whose first request copied 112, as its answers tell it: no site yet with so many files stored, no site yet while the install copies by itself, and the site. */
const [BEGUN, GONE_ON, WATCHED, MADE] = [
  { site: null, copy: { upload: "u1", copied: 112, files: 300 } },
  { site: null, copy: { upload: "u1", copied: 224, files: 300 } },
  { site: null, copy: { upload: "u1", copied: null, files: 300 } },
  { site: { id: "s1" }, copy: { upload: "u1", copied: 300, files: 300 } },
];

describe("the meter of rows written", () => {
  // Drift: a copy the install's job runs writes its rows in steps no request shows, while every ask after it writes none. Counted as before, a run that waits long would stop at the ceiling for rows nobody wrote, and the job's own rows would go uncounted.
  test.each([
    ["a copy the requests make counts its begin, and each request that goes on with it as the one that finishes it", [BEGUN, GONE_ON, MADE], 21 + 16 + 16],
    ["a copy the install's job makes counts its begin, nothing for an ask that finds the job at it, and with the site the finish and the job's two rounds", [BEGUN, WATCHED, WATCHED, WATCHED, MADE], 21 + 16 + 2],
    ["an ask whose answer cannot be read is counted as one that finished the copy", [BEGUN, WATCHED, 502], 21 + 16],
  ])("%s", async (_what, answers, written) => {
    const meter = meterRows(copying(answers), 1000);
    await meter.fetch(`${SERVER}/api/sites/docs/duplicate`, json("POST", {}));
    for (const _ask of answers.slice(1)) await meter.fetch(`${SERVER}/api/sites/docs/duplicate`, json("POST", { upload: "u1" }));

    expect({ written: meter.written(), stopped: meter.stopped() }).toEqual({ written, stopped: undefined });
  });

  test("a request past the ceiling is held back and never sent, every later one that writes too, while one that reads still goes out", async () => {
    const install = fake();
    const meter = meterRows(install.fetch, 30);
    const publish = async (): Promise<number> => (await meter.fetch(`${SERVER}/api/uploads`, json("POST", { name: "docs", files: [] }))).status;

    const ended = [await publish(), await publish(), (await meter.fetch(`${SERVER}/api/config`, json("PATCH", {}))).status, (await meter.fetch(`${SERVER}/api/sites`, {})).status];

    expect({ ended, written: meter.written(), sent: install.sent, stopped: meter.stopped() }).toEqual({
      ended: [200, 403, 403, 200],
      written: 20,
      sent: ["POST /api/uploads", "GET /api/sites"],
      stopped: "passed its ceiling of 30 rows written to the database",
    });
  });

  test("a request that changes something on a route with no price is held back, and names why", async () => {
    const install = fake();
    const meter = meterRows(install.fetch, 100);
    const answered = await meter.fetch(`${SERVER}/api/update`, json("POST", {}));

    expect({ status: answered.status, sent: install.sent, stopped: meter.stopped() }).toEqual({ status: 403, sent: [], stopped: "sent POST to a route of the API that has no price in rows" });
  });

  // A request that goes on with a copy is counted by its answer, so it is priced at nothing before it is sent: past the ceiling it must be held back all the same.
  test("the request that takes a copy past the ceiling stops the step, and the next one that goes on with the copy is held back", async () => {
    const meter = meterRows(copying([BEGUN, GONE_ON, MADE]), 30);
    const ended = [(await meter.fetch(`${SERVER}/api/sites/docs/duplicate`, json("POST", {}))).status];
    for (let ask = 0; ask < 2; ask += 1) ended.push((await meter.fetch(`${SERVER}/api/sites/docs/duplicate`, json("POST", { upload: "u1" }))).status);

    expect({ ended, written: meter.written(), stopped: meter.stopped() }).toEqual({ ended: [200, 200, 403], written: 37, stopped: "passed its ceiling of 30 rows written to the database" });
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
