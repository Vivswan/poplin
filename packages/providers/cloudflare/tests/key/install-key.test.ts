// The kept key as the dashboard sees it, against the answers Cloudflare documents for a token that verifies itself.
// Without these a key Cloudflare ended could still read as working, and the object the dashboard holds could give the key away.

import { describe, expect, test } from "bun:test";
import type { DomainReading } from "@poplin/app/src/console/domain/records";
import { createInstallKey } from "../../src/key/install-key";
import { readKeptKey } from "../../src/key/kept-key";
import { withFake } from "../zone/support/fake-cloudflare";
import { refusal, reply } from "../zone/support/replies";

/** The account the key is owned by. */
const ACCOUNT = "account-a";

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** What stands in for the way to a new key: it answers the token it was handed, so a test sees the install's key pass it on and nothing else. */
const GIVE = async (authorisation: string): Promise<DomainReading> => ({ ok: true, rows: [{ object: "Key", state: "created", detail: authorisation, part: "rest" }], steps: [] });

/** The one call `verify` makes. */
const VERIFY = { method: "GET", path: `/accounts/${ACCOUNT}/tokens/verify`, key: `Bearer ${KEY}`, body: undefined };

describe("createInstallKey", () => {
  const rows: readonly { readonly name: string; readonly respond: () => Response; readonly ends: unknown }[] = [
    {
      name: "an active key that names when it began",
      respond: () => reply({ id: "token-1", status: "active", not_before: "2026-11-01T00:00:00Z" }),
      ends: { ok: true, value: { since: Date.UTC(2026, 10, 1), id: "token-1" } },
    },
    { name: "an active key that names no such time", respond: () => reply({ id: "token-1", status: "active" }), ends: { ok: true, value: { since: null, id: "token-1" } } },
    { name: "a disabled key", respond: () => reply({ id: "token-1", status: "disabled" }), ends: { ok: false, refusal: "key_refused" } },
    { name: "an expired key", respond: () => reply({ id: "token-1", status: "expired", expires_on: "2026-11-02T00:00:00Z" }), ends: { ok: false, refusal: "key_refused" } },
    { name: "a deleted key, which answers 401 with code 1000", respond: () => refusal(401, 1000, `Invalid API Token ${KEY}`), ends: { ok: false, refusal: "key_refused" } },
    { name: "a 403 with code 10000: verifying asks no right, so none is named", respond: () => refusal(403, 10_000, "Authentication error"), ends: { ok: false, refusal: "key_refused" } },
    { name: "a failure of Cloudflare's own", respond: () => refusal(503, 1, "Service unavailable", { "retry-after-ms": "1" }), ends: { ok: false, refusal: "unreachable" } },
  ];

  // Drift: the path and the statuses are Cloudflare's API for a token an account owns. The key is in no text of the object or of its answer.
  test.each(rows)("$name verifies as $ends, asked at the account's own verify path with the key", async ({ respond, ends }) => {
    await withFake(respond, async (connection, asked) => {
      const key = createInstallKey(readKeptKey(KEY, { baseUrl: connection.baseUrl }), ACCOUNT, GIVE);
      const answer = await key.verify();

      const outcome: readonly unknown[] = [key.has(), answer, new Set(asked.map((entry) => JSON.stringify(entry)))];

      expect(outcome).toEqual([true, ends, new Set([JSON.stringify(VERIFY)])]);
      expect([JSON.stringify([key, answer]), Bun.inspect(key), Bun.inspect(answer)].join("\n")).not.toContain(KEY);
    });
  });

  test("an install with no key says so and asks Cloudflare nothing", async () => {
    await withFake(
      () => reply({ id: "token-1", status: "active" }),
      async (connection, asked) => {
        const key = createInstallKey(readKeptKey(undefined, { baseUrl: connection.baseUrl }), ACCOUNT, GIVE);

        expect([key.has(), await key.verify(), asked]).toEqual([false, { ok: false, refusal: "no_key" }, []]);
        expect(await key.give("a-pasted-token")).toMatchObject({ rows: [{ detail: "a-pasted-token" }] });
      },
    );
  });
});
