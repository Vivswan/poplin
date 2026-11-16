// The instance's start on the simulated bindings, with the Worker's secret set.
// Without these the kept key could be read and never reach the instance, or reach a page, an export, or a log line.

import { reset } from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { type Outside, startInstance } from "../../src/worker/start";
import { emptyAccount, KEY_VALUE_START, TOKEN } from "../zone/support/fake-install";
import type { Asked } from "../zone/support/replies";
import { EXAMPLE_ACCOUNT } from "./support/example-bindings";
import { ADMIN, accessHeaders, ask, BINDINGS, cloudflareOf, instance, send, tokenOf, type World, world } from "./support/install";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** The bindings of an install that holds the key. */
const KEYED = { ...BINDINGS, KEPT_KEY: KEY };

/** Every way the Worker's runtime prints a line. */
const PRINTS = ["log", "info", "warn", "error", "debug"] as const;

/** What the dashboard reads, by its path. */
const READS = ["/", "/data/frame", "/data/sites", "/data/activity", "/data/activity/download", "/data/usage", "/data/tokens", "/data/people", "/data/settings", "/data/domain", "/data/no-such-data"];

/** What the API hands out whole, by its path. */
const EXPORTS = ["/api/export/settings", "/api/export/sites", "/api/sites"];

let w: World;

/** A response whole: its status, every header, and its body. */
async function textOf(response: Response): Promise<string> {
  return `${response.status}\n${JSON.stringify([...response.headers])}\n${await response.text()}`;
}

/** One value of a printed line as the log shows it: an error with its message and its stack, which its JSON leaves out. */
function printedOf(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack}`;

  return typeof value === "string" ? value : JSON.stringify(value);
}

/** What the instance is given, with a Cloudflare that answers every call as an active key and repeats what it was asked. */
function outsideOf(from: World, asked: string[]): Outside {
  return {
    now: () => from.clock.now,
    fetch: from.certs.fetch,
    cloudflare: async (input, init) => {
      const request = new Request(input, init);
      asked.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get("authorization")}`);

      return Response.json({ success: true, errors: [], messages: [], result: { id: "token-1", status: "active" } });
    },
    latest: { fetch: async () => new Response("Not found\n", { status: 404 }) },
  };
}

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("the kept key of an instance", () => {
  const secrets: readonly { readonly name: string; readonly secret: unknown; readonly has: boolean; readonly asked: readonly string[] }[] = [
    { name: "a secret that is a key", secret: KEY, has: true, asked: [`GET /client/v4/accounts/${EXAMPLE_ACCOUNT}/tokens/verify Bearer ${KEY}`] },
    { name: "no secret", secret: undefined, has: false, asked: [] },
    { name: "a secret with a space in it", secret: "kept key", has: false, asked: [] },
  ];

  // Drift: the secret is read in one place and used in another. A name that differs between them reads as an install with no key, with no error anywhere.
  test.each(secrets)("$name: the instance starts, and its key verifies under the Worker's own account or asks nothing", async ({ secret, has, asked }) => {
    const calls: string[] = [];
    const started = await startInstance({ ...BINDINGS, KEPT_KEY: secret }, outsideOf(w, calls), async () => "a visitor");
    if (!started.ok) throw new Error(`the instance did not start: ${started.failure.kind}`);

    const verified = await started.instance.key.verify();

    expect([started.instance.key.has(), verified.ok, calls]).toEqual([has, has, asked]);
  });

  // Drift: the way to a new key is wired at the start, beside the plug. One built over another account, Worker, or fetch would make a key for an install that is not this one.
  test("an instance with no key is given one with a pasted token: the key is made in the Worker's own account, written onto this Worker as its secret, and no word of the answer or the log holds it", async () => {
    const prints = PRINTS.map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const account = emptyAccount();
    const asked: Asked[] = [];
    const started = await startInstance(BINDINGS, { ...outsideOf(w, []), cloudflare: cloudflareOf(account, asked) }, async () => "a visitor");
    if (!started.ok) throw new Error(`the instance did not start: ${started.failure.kind}`);

    const given = await started.instance.key.give(TOKEN);
    const printed = prints.flatMap((print) => print.mock.calls.map((line) => line.map(printedOf).join(" ")));

    for (const print of prints) print.mockRestore();

    expect(given).toEqual({ ok: true, rows: [{ object: "Key", state: "created", detail: "poplin kept key", part: "rest" }], steps: [] });
    expect([account.tokens.map((token) => token.name), account.bindings.filter((binding) => binding.type === "secret_text")]).toEqual([["poplin kept key"], [{ name: "KEPT_KEY", type: "secret_text" }]]);
    expect(asked.filter((entry) => entry.method !== "GET").map((entry) => `${entry.method} ${entry.path}`)).toEqual([`POST /accounts/${EXAMPLE_ACCOUNT}/tokens`, `PATCH /accounts/${EXAMPLE_ACCOUNT}/workers/scripts/poplin/settings`]);
    expect([JSON.stringify(given), ...printed].filter((text) => text.includes(KEY_VALUE_START))).toEqual([]);
  });

  // Drift: nothing answers the key today, and every new page, export, and log line is a new way out for it.
  test("nothing the Worker answers or prints holds the key: the dashboard's page and data, the API's exports, a refused start, and the log", async () => {
    const prints = PRINTS.map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const worker = instance(w);
    const token = await tokenOf(w, "admin");
    // The instance is made on its first request, so every request here carries the secret.
    const session = await accessHeaders(w);
    const bearer = { Authorization: `Bearer ${token}` };
    const answers: Response[] = [];

    for (const path of READS) answers.push(await ask(worker, `${ADMIN}${path}`, { headers: session }, KEYED));

    answers.push(await ask(worker, `${ADMIN}/`, {}, KEYED));
    for (const path of EXPORTS) answers.push(await ask(worker, `${ADMIN}${path}`, { headers: bearer }, KEYED));

    answers.push(await send(worker, `${ADMIN}/data/settings/sign-everyone-out`, {}, session, KEYED));
    answers.push(await ask(instance(w), `${ADMIN}/`, {}, { ...KEYED, ZONE: 7 }));

    const texts = await Promise.all(answers.map(textOf));
    const printed = prints.flatMap((print) => print.mock.calls.map((line) => line.map(printedOf).join(" ")));

    for (const print of prints) print.mockRestore();

    expect(answers.map((answer) => answer.status).filter((status) => status === 200).length).toBeGreaterThan(READS.length / 2);
    expect([...texts, ...printed].filter((text) => text.includes(KEY))).toEqual([]);
  });
});

describe("a schema step that fails at the start", () => {
  // Drift: the database's own error can repeat a stored value, and an unlisted site's id is its link. A line that printed the step's message would put it in the log.
  test("the instance does not start, and the log names the step and the kind of the failure, never the database's words", async () => {
    await reset();
    const stored = "kqzmxpwtlrvn";
    // A step is a batch of several statements; a batch of one is a read of where the schema stands, which goes on answering.
    const failing = new Proxy(BINDINGS.DB, {
      get(target, name) {
        const value: unknown = Reflect.get(target, name);
        if (typeof value !== "function") return value;

        if (name !== "batch") return value.bind(target);

        return async (statements: D1PreparedStatement[]) => (statements.length > 1 ? Promise.reject(new RangeError(`UNIQUE constraint failed: site ${stored}`)) : target.batch(statements));
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const started = await startInstance({ ...BINDINGS, DB: failing }, outsideOf(w, []), async () => "a visitor");
    const printed = error.mock.calls.map((line) => line.map(printedOf).join(" "));
    error.mockRestore();

    expect(started).toEqual({ ok: false, failure: { kind: "failed" } });
    expect(printed.map((line) => line.split("\n")[0])).toEqual(["Error: poplin: step 1 of the database's schema failed and nothing of it was kept (RangeError)"]);
    expect(printed.filter((line) => line.includes(stored) || line.includes("UNIQUE"))).toEqual([]);
  });
});
