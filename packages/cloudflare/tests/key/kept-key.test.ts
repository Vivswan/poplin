// The kept key read from the Worker's secret, and each answer Cloudflare can give a call made with it, turned into one of four plain refusals.
// Without these a screen could offer "give poplin its key" for a busy answer, or say nothing of a key Cloudflare ended.

import { describe, expect, spyOn, test } from "bun:test";
import { BaseZones } from "cloudflare/resources/zones/zones";
import { keyed, readKeptKey } from "../../src/key/kept-key";
import { callCloudflare, type Connection } from "../../src/zone/client";
import { refusal, reply } from "../zone/support/replies";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** The right every call of this file is made under. */
const RIGHT = "Zone: Read";

/** Every way the Worker's runtime prints a line. */
const PRINTS = ["log", "info", "warn", "error", "debug"] as const;

/** What one call left behind. `left` is every text of it: its answer, and each line it printed. */
interface Outcome {
  readonly answer: unknown;
  readonly bearers: readonly (string | null)[];
  readonly left: string;
}

/** Cloudflare's failure envelope whose message repeats the key, as a careless upstream could. A busy answer names a wait of one millisecond. */
function refused(status: number, code: number): Response {
  return refusal(status, code, `no entry for ${KEY}`, { "retry-after-ms": "1" });
}

/** A success whose body fails as it is read, with an error that repeats the key. */
function cut(): Response {
  const body = new ReadableStream({ start: (controller) => controller.error(new Error(`the answer for ${KEY} was cut`)) });

  return new Response(body, { headers: { "content-type": "application/json" } });
}

/** A stand-in for `fetch` that answers every request alike, or with no answer fails it with an error that repeats the key. */
function fetchOf(respond: (() => Response) | undefined, bearers: (string | null)[] = []): NonNullable<Connection["fetch"]> {
  return async (input, init) => {
    bearers.push(new Request(input, init).headers.get("authorization"));
    if (respond === undefined) throw new Error(`the connection of ${KEY} was cut`);

    return respond();
  };
}

/** Make one call with the secret read as the kept key, and say what it answered, what Cloudflare was asked, and what it left behind. */
async function asked(respond: (() => Response) | undefined, secret: unknown = KEY): Promise<Outcome> {
  const prints = PRINTS.map((name) => spyOn(console, name).mockImplementation(() => undefined));
  const bearers: (string | null)[] = [];
  const key = readKeptKey(secret, { baseUrl: "http://localhost/client/v4", fetch: fetchOf(respond, bearers) });

  try {
    const answer = await keyed(key, RIGHT, (connection) => callCloudflare(connection, (api) => new BaseZones(api).get({ zone_id: "zone-1" })));
    const printed = prints.flatMap((print) => print.mock.calls.map((line) => Bun.inspect(line)));

    return { answer, bearers, left: [JSON.stringify(answer), Bun.inspect(answer), ...printed].join("\n") };
  } finally {
    for (const print of prints) print.mockRestore();
  }
}

describe("readKeptKey", () => {
  const none: readonly { readonly name: string; readonly raw: unknown }[] = [
    { name: "no secret", raw: undefined },
    { name: "null", raw: null },
    { name: "an empty text", raw: "" },
    { name: "spaces alone", raw: "   " },
    { name: "a text with a space in it", raw: "kept key" },
    { name: "a text that ends with a line break", raw: `${KEY}\n` },
    { name: "a text with a letter outside ASCII", raw: "kept-k\u00e9y" },
    { name: "a number", raw: 7 },
    { name: "a record that holds a text", raw: { text: KEY } },
  ];

  // Drift: a secret taken as it came would go into a request header, where a line break ends the request with an exception no screen explains.
  test.each(none)("$name is no key, and reading it throws nothing", ({ raw }) => {
    expect(readKeptKey(raw, {})).toBeUndefined();
  });
});

describe("keyed", () => {
  const rows: readonly { readonly name: string; readonly respond: (() => Response) | undefined; readonly ends: unknown; readonly asks: number }[] = [
    { name: "a value", respond: () => reply({ id: "zone-1" }), ends: { ok: true, value: { id: "zone-1" } }, asks: 1 },
    { name: "401 with code 10000, as any call with a deleted key answers", respond: () => refused(401, 10_000), ends: { ok: false, refusal: "key_refused" }, asks: 1 },
    { name: "401 with code 1000, as verifying a deleted key answers", respond: () => refused(401, 1000), ends: { ok: false, refusal: "key_refused" }, asks: 1 },
    { name: "403 with a code other than 10000", respond: () => refused(403, 9109), ends: { ok: false, refusal: "key_refused" }, asks: 1 },
    { name: "403 with code 10000", respond: () => refused(403, 10_000), ends: { ok: false, refusal: "lacks_right", right: RIGHT }, asks: 1 },
    { name: "429 every time", respond: () => refused(429, 971), ends: { ok: false, refusal: "unreachable" }, asks: 3 },
    { name: "500 every time", respond: () => refused(500, 1), ends: { ok: false, refusal: "unreachable" }, asks: 3 },
    { name: "503 every time", respond: () => refused(503, 1), ends: { ok: false, refusal: "unreachable" }, asks: 3 },
    { name: "a fetch that throws every time", respond: undefined, ends: { ok: false, refusal: "unreachable" }, asks: 3 },
    { name: "a 200 whose body is cut before its end", respond: cut, ends: { ok: false, refusal: "unreachable" }, asks: 1 },
    { name: "a refusal that says nothing of the key, here a 404", respond: () => refused(404, 7003), ends: { ok: false, refusal: "unreachable" }, asks: 1 },
  ];

  // Drift: each row is a separate promise of Cloudflare's API, and a screen offers a new key for `key_refused` alone. The key rides on every ask, and is in no text the call leaves behind, though every failure here repeats it.
  test.each(rows)("$name ends as $ends after $asks asks, and leaves the key in no answer and no printed line", async ({ respond, ends, asks }) => {
    const outcome = await asked(respond);

    expect([outcome.answer, outcome.bearers]).toEqual([ends, Array.from({ length: asks }, () => `Bearer ${KEY}`)]);
    expect(outcome.left).not.toContain(KEY);
  });

  test("with an empty secret the answer is `no_key` and Cloudflare is never asked: an install without a key must cost no request", async () => {
    const outcome = await asked(() => reply({ id: "zone-1" }), "");

    expect([outcome.answer, outcome.bearers]).toEqual([{ ok: false, refusal: "no_key" }, []]);
  });
});
