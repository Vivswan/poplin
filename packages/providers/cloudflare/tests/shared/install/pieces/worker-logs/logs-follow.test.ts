// The setting of the logs carried to Cloudflare with the kept key, against the answers Cloudflare documents for a Worker's script settings.
// Without these a changed setting could read as carried when Cloudflare refused it, cost a scheduled run more calls than it counts, or give the key away in an answer.

import { describe, expect, test } from "bun:test";
import { readKeptKey } from "../../../../../src/shared/install/key/kept-key";
import { createLogsFollow, LOGS_PUSH_CALLS } from "../../../../../src/shared/install/pieces/worker-logs/logs-follow";
import { withFake } from "../../support/fake-cloudflare";
import { type Asked, refusal, reply } from "../../support/replies";

/** The install's own Worker. */
const WORKER = { accountId: "account-a", script: "poplin" };

/** A key in the form the reader takes, and nothing like one Cloudflare makes. */
const KEY = "kept-key-of-the-test";

/** Where the Worker's script settings are. */
const PATH = "/accounts/account-a/workers/scripts/poplin/script-settings";

/** A Worker whose logs are kept, as Cloudflare answers its script settings; a write is taken, and no read shows it. */
const KEPT = (asked: Asked): Response | undefined => (asked.path === PATH ? reply({ observability: { enabled: true, logs: { enabled: true, invocation_logs: false } } }) : undefined);

describe("createLogsFollow", () => {
  // Drift: the sweep counts a writing of the logs by this pin. A push that sent more would run a scheduled invocation past its allowance.
  test("a setting that keeps no logs is written in the pinned calls, each sent with the key, and on the run that begins a day one Cloudflare already holds sends a read alone", async () => {
    await withFake(KEPT, async (connection, asked) => {
      const follow = createLogsFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), WORKER, "where it differs");

      expect([follow.holdsKey(), await follow.push(false), asked.map((entry) => `${entry.method} ${entry.path} ${entry.key}`)]).toEqual([true, { ok: true }, [`GET ${PATH} Bearer ${KEY}`, `PATCH ${PATH} Bearer ${KEY}`]]);
      expect(asked).toHaveLength(LOGS_PUSH_CALLS);
      expect([await follow.push(true), asked.length]).toEqual([{ ok: true }, LOGS_PUSH_CALLS + 1]);
    });
  });

  // Drift: Cloudflare's reads of a Worker's settings trail its writes. A push that left out the write for a read that matches would lose a setting put back just after it was switched over, and Cloudflare would keep the other state.
  test("a setting put back just after it was switched over is written again, where the read still answers the logs as they were before the first write", async () => {
    await withFake(KEPT, async (connection, asked) => {
      const follow = createLogsFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), WORKER, "every time");
      const pushed = [await follow.push(false), await follow.push(true)];
      const written = asked.filter((entry) => entry.method === "PATCH").map((entry) => entry.body);

      expect<unknown>([pushed, written, asked.length]).toEqual([
        [{ ok: true }, { ok: true }],
        [{ observability: { enabled: false, head_sampling_rate: 1, logs: { enabled: false, invocation_logs: false } } }, { observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: false } } }],
        2 * LOGS_PUSH_CALLS,
      ]);
    });
  });

  // Drift: a refusal read as carried would leave logs kept that the setting says are not. No answer may repeat the key, which a careless upstream does.
  test.each([
    { name: "a key Cloudflare refuses", answer: () => refusal(401, 10000, `Invalid token ${KEY}`), refusal: "key_refused" },
    { name: "a key without the right", answer: () => refusal(403, 10000, `Authentication error ${KEY}`), refusal: "lacks_right" },
    { name: "a failure of Cloudflare's own", answer: () => refusal(503, 1, `Service unavailable ${KEY}`, { "retry-after-ms": "1" }), refusal: "unreachable" },
  ])("$name is the refusal $refusal, with no word of the key", async ({ answer, refusal: why }) => {
    await withFake(answer, async (connection) => {
      const pushed = await createLogsFollow(readKeptKey(KEY, { baseUrl: connection.baseUrl }), WORKER, "every time").push(false);

      expect([pushed, JSON.stringify(pushed).includes(KEY)]).toEqual([{ ok: false, refusal: why }, false]);
    });
  });
});
