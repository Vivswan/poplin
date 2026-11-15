import { describe, expect, test } from "bun:test";
import { BaseZones } from "cloudflare/resources/zones/zones";
import { callCloudflare, findZones, listZones } from "../../src/zone/client";
import { withFake } from "./support/fake-cloudflare";
import { type Asked, page, refusal, reply } from "./support/replies";

const ACCOUNT = "account-a";

function zone(id: string, name: string, account: string, plan: string): unknown {
  return { id, name, account: { id: account, name: "an account" }, plan: { id: "plan-1", name: plan } };
}

function paths(asked: readonly Asked[]): string[] {
  return asked.map((entry) => `${entry.method} ${entry.path}`);
}

describe("callCloudflare", () => {
  test("the key rides on the call it was passed to, as a bearer token: a client that held or dropped it would break every setup", async () => {
    await withFake(
      () => reply({ id: "zone-1" }),
      async (connection, asked) => {
        const result = await callCloudflare({ ...connection, key: "key-of-this-call" }, (api) => new BaseZones(api).get({ zone_id: "zone-1" }));

        expect(result.ok).toBe(true);
        expect(asked.map((entry) => entry.key)).toEqual(["Bearer key-of-this-call"]);
      },
    );
  });

  test("Cloudflare's error envelope comes back as a refusal value with its status and errors, never as an exception", async () => {
    await withFake(
      () => refusal(403, 9109, "Unauthorized to access requested resource"),
      async (connection) => {
        const result = await callCloudflare(connection, (api) => new BaseZones(api).get({ zone_id: "zone-1" }));

        expect(result).toEqual({ ok: false, failure: "refused", status: 403, errors: [{ code: 9109, message: "Unauthorized to access requested resource" }] });
      },
    );
  });

  const busy: readonly { readonly name: string; readonly status: number; readonly times: number; readonly asks: number; readonly ends: unknown }[] = [
    { name: "a 429 once", status: 429, times: 1, asks: 2, ends: { ok: true, value: { id: "zone-1" } } },
    { name: "a 502 once", status: 502, times: 1, asks: 2, ends: { ok: true, value: { id: "zone-1" } } },
    { name: "a 429 twice", status: 429, times: 2, asks: 3, ends: { ok: true, value: { id: "zone-1" } } },
    { name: "a 429 every time", status: 429, times: 3, asks: 3, ends: { ok: false, failure: "rate-limited" } },
  ];

  // Drift: a repair is some thirty calls in a row and stops at the first that fails. Asked once, one busy answer ends it; asked without end, it spends the fifty requests a Worker may send.
  test.each(busy)("$name is asked $asks times in all and ends as $ends", async ({ status, times, asks, ends }) => {
    await withFake(
      (_entry, earlier) => (earlier < times ? refusal(status, 971, "Please wait and consider throttling your request speed", { "retry-after-ms": "1" }) : reply({ id: "zone-1" })),
      async (connection, asked) => {
        const result: unknown = await callCloudflare(connection, (api) => new BaseZones(api).get({ zone_id: "zone-1" }));

        expect([result, asked.length]).toEqual([ends, asks]);
      },
    );
  });

  test("an answer that never arrives is a network failure, apart from a refusal", async () => {
    let closed = { key: "test-key", baseUrl: "" };
    await withFake(
      () => undefined,
      async (connection) => {
        closed = { key: connection.key, baseUrl: connection.baseUrl ?? "" };
      },
    );

    const result = await callCloudflare(closed, (api) => new BaseZones(api).get({ zone_id: "zone-1" }));

    expect(result).toMatchObject({ ok: false, failure: "network" });
  });
});

describe("a paginated list", () => {
  test("a list longer than one page is read to its end, page after page", async () => {
    const pages: Record<string, unknown[]> = {
      "1": [zone("zone-1", "one.example.com", ACCOUNT, "free"), zone("zone-2", "two.example.com", ACCOUNT, "free")],
      "2": [zone("zone-3", "three.example.com", ACCOUNT, "free")],
    };

    await withFake(
      (asked) => {
        const number = new URL(asked.path, "http://localhost").searchParams.get("page") ?? "1";
        const result = pages[number] ?? [];

        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result,
          result_info: { page: Number(number), per_page: 2, count: result.length, total_count: 3, total_pages: 2 },
        });
      },
      async (connection, asked) => {
        const result = await callCloudflare(connection, (api) => Array.fromAsync(new BaseZones(api).list()));

        expect(result.ok && result.value.map((entry) => entry.id)).toEqual(["zone-1", "zone-2", "zone-3"]);
        expect(paths(asked)).toEqual(["GET /zones", "GET /zones?page=2", "GET /zones?page=3"]);
      },
    );
  });
});

describe("listZones", () => {
  test("only the asked account's zones come back, each with its plan: a zone of another account the key reaches must never be offered", async () => {
    const zones = [
      zone("zone-1", "example.com", ACCOUNT, "Free Website"),
      zone("zone-2", "example.org", "account-b", "Pro Website"),
      zone("zone-3", "example.net", ACCOUNT, "Business Website"),
      zone("zone-4", "example.edu", ACCOUNT, "a plan with no known limits"),
    ];

    await withFake(
      (asked) => page(asked, zones),
      async (connection, asked) => {
        expect(await listZones(connection, ACCOUNT)).toEqual({
          ok: true,
          value: [
            { id: "zone-1", name: "example.com", plan: "free", accountId: ACCOUNT },
            { id: "zone-3", name: "example.net", plan: "business", accountId: ACCOUNT },
            { id: "zone-4", name: "example.edu", plan: "free", accountId: ACCOUNT },
          ],
        });
        expect(asked[0]?.path).toBe(`/zones?account.id=${ACCOUNT}`);
      },
    );
  });
});

describe("findZones", () => {
  // Drift: an install with nothing set takes its account from this answer. Anybody may add a domain to an account of their own, where it stays pending until they prove it theirs: such a zone must never name the account.
  test("only an active zone of exactly the name comes back, with its account: a pending one, and one whose name only holds the name, do not", async () => {
    const zones = [
      { ...(zone("zone-1", "example.com", "account-b", "Free Website") as object), status: "pending" },
      { ...(zone("zone-2", "example.com", ACCOUNT, "Pro Website") as object), status: "active" },
      { ...(zone("zone-3", "shop.example.com", ACCOUNT, "Free Website") as object), status: "active" },
    ];

    await withFake(
      (asked) => page(asked, zones),
      async (connection, asked) => {
        expect(await findZones(connection, "example.com")).toEqual({ ok: true, value: [{ id: "zone-2", name: "example.com", plan: "pro", accountId: ACCOUNT }] });
        expect(asked[0]?.path).toBe("/zones?name=example.com&status=active");
      },
    );
  });
});
