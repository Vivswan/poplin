// The Worker's logs made to match the setting `provider_logs`, against the answers Cloudflare documents for a Worker's script settings.
// Without these the setting could switch logs back on that it keeps off, switch on Cloudflare's own record of each request, which holds the request's address, or write where nothing differs.

import { describe, expect, test } from "bun:test";
import { keepsLines, observabilityOf, syncLogs } from "../../../../../src/shared/install/pieces/worker-logs/worker-logs";
import { withFake } from "../../support/fake-cloudflare";
import { type Asked, refusal, reply } from "../../support/replies";

/** The Worker whose logs are read and written. */
const WORKER = { accountId: "account-a", script: "poplin" };

/** Where the Worker's script settings are. */
const PATH = "/accounts/account-a/workers/scripts/poplin/script-settings";

/** The observability a release of poplin states: every line kept, and no record of a request. */
const ON = { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: false } };

/** The same with no line kept. */
const OFF = { enabled: false, head_sampling_rate: 1, logs: { enabled: false, invocation_logs: false } };

/** Answer the script settings as Cloudflare does, with the observability the Worker has; a write is taken. */
function worker(observability: unknown): (asked: Asked) => Response | undefined {
  return (asked) => (asked.path === PATH ? reply({ logpush: false, observability }) : undefined);
}

/** Every call that was sent, each as its method and its path. */
function calls(asked: readonly Asked[]): string[] {
  return asked.map((entry) => `${entry.method} ${entry.path}`);
}

describe("observabilityOf", () => {
  // Drift: this is what every upload and every change states. One that kept `invocation_logs` as it found it would store each request's address once somebody switched it on.
  test.each([
    { name: "nothing stated, logs kept", base: undefined, kept: true, written: ON },
    { name: "nothing stated, no logs kept", base: null, kept: false, written: OFF },
    { name: "a release's own, switched off", base: ON, kept: false, written: OFF },
    {
      name: "a share and a part poplin does not name are kept",
      base: { enabled: false, head_sampling_rate: 0.5, traces: { enabled: true } },
      kept: true,
      written: { enabled: true, head_sampling_rate: 0.5, traces: { enabled: true }, logs: { enabled: true, invocation_logs: false } },
    },
    {
      name: "a record of each request somebody switched on is switched off",
      base: { enabled: true, logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1 } },
      kept: true,
      written: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: false, head_sampling_rate: 1 } },
    },
    {
      name: "logs somebody left unstored are stored where they are kept",
      base: { enabled: true, logs: { enabled: true, persist: false } },
      kept: true,
      written: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, persist: true, invocation_logs: false } },
    },
  ])("$name", ({ base, kept, written }) => {
    expect<unknown>(observabilityOf(base, kept)).toEqual(written);
  });
});

describe("keepsLines", () => {
  // Drift: a check row and an upload by a repair both read the Worker's logs by this. Read as kept where the logs are off, a repair's upload would switch them on.
  test.each([
    [ON, true],
    [{ enabled: true }, true],
    [OFF, false],
    [{ enabled: true, logs: { enabled: false } }, false],
    [{ enabled: true, logs: { enabled: true, persist: false } }, false],
    [{ enabled: false, logs: { enabled: true } }, false],
    [null, false],
    [undefined, false],
  ])("%j keeps lines: %p", (observability, keeps) => {
    expect(keepsLines(observability)).toBe(keeps);
  });
});

describe("syncLogs", () => {
  // Drift: a check must send no change, and a run none where Cloudflare already matches: each write of the settings is a call of the day's allowance.
  test.each([
    { name: "kept, as the setting asks", has: ON, kept: true, mode: "apply", report: { left: ["kept"], changed: [] }, sent: [`GET ${PATH}`] },
    { name: "kept, with a record of each request somebody switched on", has: { ...ON, logs: { enabled: true, invocation_logs: true } }, kept: true, mode: "apply", report: { left: [], changed: ["kept"] }, sent: [`GET ${PATH}`, `PATCH ${PATH}`] },
    { name: "kept, where the setting keeps none: a check", has: ON, kept: false, mode: "plan", report: { left: [], changed: ["not kept"] }, sent: [`GET ${PATH}`] },
    { name: "kept, where the setting keeps none: a run", has: ON, kept: false, mode: "apply", report: { left: [], changed: ["not kept"] }, sent: [`GET ${PATH}`, `PATCH ${PATH}`] },
    { name: "none stated, where the setting keeps none", has: null, kept: false, mode: "apply", report: { left: ["not kept"], changed: [] }, sent: [`GET ${PATH}`] },
    { name: "switched off by hand, where the setting keeps them", has: OFF, kept: true, mode: "apply", report: { left: [], changed: ["kept"] }, sent: [`GET ${PATH}`, `PATCH ${PATH}`] },
  ] as const)("$name", async ({ has, kept, mode, report, sent }) => {
    await withFake(worker(has), async (connection, asked) => {
      const synced = await syncLogs(connection, WORKER, kept, mode);

      expect([synced.ok && { left: synced.report.left, changed: synced.report.changed }, calls(asked)]).toEqual([report, [...sent]]);
      expect(asked.filter((entry) => entry.method === "PATCH").map((entry) => entry.body)).toEqual(sent.length === 2 ? [{ observability: kept ? ON : OFF }] : []);
    });
  });

  // Drift: an install's dry run reads the logs before its Worker is made. A failure there would stop every piece after it.
  test("an account with no such Worker has nothing to change, and a refusal of another kind is a failure with nothing done", async () => {
    await withFake(
      () => refusal(404, 10007, "This Worker does not exist on your account."),
      async (connection, asked) => {
        const synced = await syncLogs(connection, WORKER, true, "apply");

        expect([synced.ok && synced.report.left, calls(asked)]).toEqual([["kept"], [`GET ${PATH}`]]);
      },
    );
    await withFake(
      () => refusal(403, 10000, "Authentication error"),
      async (connection) => {
        const synced = await syncLogs(connection, WORKER, true, "apply");

        expect(synced.ok ? undefined : [synced.failure, synced.report.changedNothing]).toEqual(["refused", true]);
      },
    );
  });
});
