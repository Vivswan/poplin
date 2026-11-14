import { describe, expect, test } from "bun:test";
import { BaseZones } from "cloudflare/resources/zones/zones";
import { callCloudflare, listZones, verifyKey } from "../../src/zone/client";
import { withFake } from "./support/fake-cloudflare";
import { type Asked, page, refusal, reply } from "./support/replies";

const ACCOUNT = "account-a";
const ACCOUNT_VERIFY = `/accounts/${ACCOUNT}/tokens/verify`;
const USER_VERIFY = "/user/tokens/verify";
const ACCESS_PROBE = `/accounts/${ACCOUNT}/access/apps?per_page=1`;

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

  const limited: readonly { readonly name: string; readonly headers: Record<string, string>; readonly retryAfterSeconds: number | undefined }[] = [
    { name: "a hint in seconds", headers: { "retry-after": "7" }, retryAfterSeconds: 7 },
    { name: "no hint", headers: {}, retryAfterSeconds: undefined },
    { name: "a hint that is a date", headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, retryAfterSeconds: undefined },
  ];

  test.each(limited)(
    "a 429 with $name is its own outcome and is asked once: a hidden retry would spend the Worker's subrequests",
    async ({ headers, retryAfterSeconds }) => {
      await withFake(
        () => refusal(429, 971, "Please wait and consider throttling your request speed", headers),
        async (connection, asked) => {
          const result = await callCloudflare(connection, (api) => new BaseZones(api).get({ zone_id: "zone-1" }));

          expect(result).toEqual({ ok: false, failure: "rate-limited", retryAfterSeconds });
          expect(asked).toHaveLength(1);
        },
      );
    },
  );

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
            { id: "zone-1", name: "example.com", plan: "free" },
            { id: "zone-3", name: "example.net", plan: "business" },
            { id: "zone-4", name: "example.edu", plan: "free" },
          ],
        });
        expect(asked[0]?.path).toBe(`/zones?account.id=${ACCOUNT}`);
      },
    );
  });
});

describe("verifyKey", () => {
  const active = reply({ id: "token-1", status: "active" });
  const cases: readonly {
    readonly name: string;
    readonly replies: Record<string, () => Response>;
    readonly expected: unknown;
    readonly asked: readonly string[];
  }[] = [
    {
      name: "a key the account owns, active, with Access",
      replies: { [ACCOUNT_VERIFY]: () => active.clone(), [ACCESS_PROBE]: () => reply([]) },
      expected: { ok: true },
      asked: [ACCOUNT_VERIFY, ACCESS_PROBE],
    },
    {
      name: "a key a person owns, active, with Access",
      replies: { [ACCOUNT_VERIFY]: () => refusal(401, 1000, "Invalid API Token"), [USER_VERIFY]: () => active.clone(), [ACCESS_PROBE]: () => reply([]) },
      expected: { ok: true },
      asked: [ACCOUNT_VERIFY, USER_VERIFY, ACCESS_PROBE],
    },
    {
      name: "an active key of another account",
      replies: {
        [ACCOUNT_VERIFY]: () => refusal(401, 1000, "Invalid API Token"),
        [USER_VERIFY]: () => active.clone(),
        [ACCESS_PROBE]: () => refusal(403, 10000, "Authentication error"),
      },
      expected: { ok: false, failure: "no-account-access" },
      asked: [ACCOUNT_VERIFY, USER_VERIFY, ACCESS_PROBE],
    },
    {
      name: "a disabled key",
      replies: { [ACCOUNT_VERIFY]: () => refusal(401, 1000, "Invalid API Token"), [USER_VERIFY]: () => reply({ id: "token-1", status: "disabled" }) },
      expected: { ok: false, failure: "inactive-key" },
      asked: [ACCOUNT_VERIFY, USER_VERIFY],
    },
    {
      name: "text that is no key",
      replies: { [ACCOUNT_VERIFY]: () => refusal(401, 1000, "Invalid API Token"), [USER_VERIFY]: () => refusal(401, 1000, "Invalid API Token") },
      expected: { ok: false, failure: "refused", status: 401, errors: [{ code: 1000, message: "Invalid API Token" }] },
      asked: [ACCOUNT_VERIFY, USER_VERIFY],
    },
  ];

  test.each(cases)("$name: setup must refuse every key that cannot act on the Worker's own account", async ({ replies, expected, asked: expectedAsked }) => {
    await withFake(
      (asked) => replies[asked.path]?.(),
      async (connection, asked) => {
        expect<unknown>(await verifyKey(connection, ACCOUNT)).toEqual(expected);
        expect(asked.map((entry) => entry.path)).toEqual([...expectedAsked]);
      },
    );
  });
});
