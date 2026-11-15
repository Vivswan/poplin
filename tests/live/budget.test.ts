// The meter of bucket writes and lists runs against a fake: R2 bills each past a million a month, and a request the meter said it held back and sent all the same would show on the invoice alone.

import { describe, expect, test } from "bun:test";

import { meterBucket } from "../../packages/cloudflare/scripts/live/budget";

/** The origin of the install a made-up request goes to. */
const SERVER = "https://poplin.example.com";

/** A `fetch` that answers every request and keeps what it was sent. */
function fake(): { readonly sent: string[]; readonly fetch: (input: string, init: RequestInit) => Promise<Response> } {
  const sent: string[] = [];

  return {
    sent,
    fetch: async (input, init) => {
      sent.push(`${init.method ?? "GET"} ${input.slice(SERVER.length)}`);

      return new Response("{}");
    },
  };
}

describe("the meter of bucket writes and lists", () => {
  test("a request past the ceiling is held back and never sent, every later one too, while a request that spends nothing still goes out", async () => {
    const install = fake();
    const meter = meterBucket(install.fetch, 2);
    const upload = async (): Promise<number> => (await meter.fetch(`${SERVER}/api/uploads/up1/file?path=a.txt`, { method: "PUT" })).status;

    const ended = [await upload(), await upload(), await upload(), await upload()];
    await meter.fetch(`${SERVER}/api/sites`, { method: "GET" });

    expect({ ended, spent: meter.spent(), sent: install.sent, stopped: meter.stopped() }).toEqual({
      ended: [200, 200, 403, 403],
      spent: 2,
      sent: ["PUT /api/uploads/up1/file?path=a.txt", "PUT /api/uploads/up1/file?path=a.txt", "GET /api/sites"],
      stopped: "passed its ceiling of 2 bucket writes and lists",
    });
  });
});
