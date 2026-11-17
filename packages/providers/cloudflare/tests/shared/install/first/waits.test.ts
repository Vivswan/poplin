// The rider of an install command's connection, against the fake API: how long it waits when Cloudflare asks it to, what it says, and when it gives up.
// Without these a removal, an install, or a repair would stop at the first busy answer, wait unseen for as long as an answer names, or never end.

import { describe, expect, test } from "bun:test";
import { parseLogin } from "@poplin/core/src/auth/logins";
import type { Token } from "@poplin/core/src/install/installer";
import { BaseZones } from "cloudflare/resources/zones/zones";
import { callCloudflare } from "../../../../src/shared/install/client";
import { installer } from "../../../../src/shared/install/first/installer";
import { riderOf } from "../../../../src/shared/install/first/waits";
import { withFake } from "../support/fake-cloudflare";
import { ACCOUNT, type Account, emptyAccount, TOKEN } from "../support/fake-install";
import { worldOf } from "../support/fake-reach";
import { refusal, reply } from "../support/replies";

/** What the one call of each case comes to once Cloudflare answers it. */
const ZONE = { ok: true, value: { id: "zone-1" } };

/** The waits of a call that is asked to wait with no time named, until all of them are spent: each twice the one before, a minute at most, five minutes together. */
const DOUBLING = [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000, 57_000];

/** A busy answer, with the headers of the case. */
function busy(headers: Record<string, string>): Response {
  return refusal(429, 971, "Please wait and consider throttling your request speed", headers);
}

/** Make one call through a rider whose waits take no time, against a fake that answers the first `times` asks with `answer`. */
async function ridden(times: number, answer: () => Response): Promise<{ readonly result: unknown; readonly asks: number; readonly slept: number[]; readonly told: string[] }> {
  const slept: number[] = [];
  const told: string[] = [];
  const ride = riderOf(async (milliseconds, why) => {
    slept.push(milliseconds);
    told.push(why ?? "");
  });
  const ran = { result: undefined as unknown, asks: 0 };

  await withFake(
    (_entry, earlier) => (earlier < times ? answer() : reply({ id: "zone-1" })),
    async (connection, asked) => {
      ran.result = await callCloudflare({ ...connection, ride }, (api) => new BaseZones(api).get({ zone_id: "zone-1" }));
      ran.asks = asked.length;
    },
  );

  return { ...ran, slept, told };
}

describe("a call that is asked to wait", () => {
  // Drift: the SDK waits what an answer names twice and then gives up, unseen. A rider that waited another time than the one asked, or let the SDK try too, would ask more often than Cloudflare allows or leave a person with a line that does not move.
  test.each<[string, number, Record<string, string>, number[], number, unknown]>([
    ["waits the seconds each answer names, and is made again after each", 3, { "retry-after": "20" }, [20_000, 20_000, 20_000], 4, ZONE],
    ["waits a minute at most, however long the answer names", 2, { "retry-after": "600" }, [60_000, 60_000], 3, ZONE],
    ["waits a second at least", 1, { "retry-after": "0" }, [1000], 2, ZONE],
    ["waits one second, then twice the wait before, where the answer names no time", 3, {}, [1000, 2000, 4000], 4, ZONE],
    ["reads a time that is no count of seconds as none", 1, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, [1000], 2, ZONE],
    ["gives up once it waited five minutes, with the answer that still asked", Number.POSITIVE_INFINITY, { "retry-after": "600" }, [60_000, 60_000, 60_000, 60_000, 60_000], 6, { ok: false, failure: "rate-limited", afterMs: 600_000 }],
    ["gives up after five minutes of doubled waits too", Number.POSITIVE_INFINITY, {}, DOUBLING, 11, { ok: false, failure: "rate-limited" }],
  ])("%s", async (_what, times, headers, waits, asks, ends) => {
    const ran = await ridden(times, () => busy(headers));

    expect([ran.result, ran.asks, ran.slept]).toEqual([ends, asks, waits]);
    expect(ran.told).toEqual(waits.map((wait) => `Cloudflare asked to wait. Retrying in ${wait / 1000} s`));
  });

  // Drift: a rider that took every failure for a busy answer would wait five minutes on a token that lacks a permission, and one that took the SDK's tries of a failing Cloudflare away would stop a run at one bad gateway.
  test.each<[string, number, () => Response, number, unknown]>([
    ["a refusal is answered at once", Number.POSITIVE_INFINITY, () => refusal(403, 9109, "Unauthorized"), 1, { ok: false, failure: "refused", status: 403, errors: [{ code: 9109, message: "Unauthorized" }] }],
    ["a failure of Cloudflare's own is still tried again by the SDK", 2, () => refusal(502, 971, "Bad gateway", { "retry-after-ms": "1" }), 3, ZONE],
  ])("%s, and nothing waits", async (_what, times, answer, asks, ends) => {
    const ran = await ridden(times, answer);

    expect([ran.result, ran.asks, ran.slept]).toEqual([ends, asks, []]);
  });

  // Drift: the wait is the command's own, so that Ctrl-C ends it. A rider that caught what the wait threw, or took the next call, would go on asking after the person stopped the command.
  test("a wait the person stopped ends the call with that error, and the calls after it too: nothing more is asked", async () => {
    const stopped = new Error("the command was interrupted");
    const ran = { asks: 0, thrown: [] as unknown[] };
    const ride = riderOf(async () => {
      throw stopped;
    });

    await withFake(
      () => busy({ "retry-after": "20" }),
      async (connection, asked) => {
        for (const zone of ["zone-1", "zone-2"]) ran.thrown.push(await callCloudflare({ ...connection, ride }, (api) => new BaseZones(api).get({ zone_id: zone })).catch((error: unknown) => error));
        ran.asks = asked.length;
      },
    );

    expect([ran.thrown, ran.asks]).toEqual([[stopped, stopped], 1]);
  });
});

describe.each([
  ["domain", "example.com"],
  ["no-domain", true],
] as const)("an install, %s", (flag, value) => {
  // Drift: an install sends most of its calls through a connection of its own making. One made without the rider would stop at the busy answer the removal rides out.
  test("goes on through a call that is asked to wait, and says each wait", async () => {
    const read = installer.read({ flags: new Map([[flag, value]]), env: {} });
    const login = parseLogin("owner@example.com");
    const account: Account = { ...emptyAccount(), bindings: [], noWorker: true };
    const world = await worldOf(account);
    const key = installer.token(TOKEN) as Token;
    if (!read.ok || !login.ok) throw new Error("the test's place or login was refused");

    const none = await installer.find(key, read.where, world.reach, "install");
    if (none.state !== "none") throw new Error(`the test's install could not start: ${none.state}`);

    Object.assign(account, { refuse: `PUT /accounts/${ACCOUNT}/workers/scripts/poplin/schedules`, refuseAs: { status: 429, code: 971 }, refuseTimes: 2, refuseAfter: 3 });
    const made = await installer.install(none, read.where, login.value, "apply", world.reach, () => undefined);

    expect([made.ok && made.ready, world.told]).toEqual([true, Array.from({ length: 2 }, () => "Cloudflare asked to wait. Retrying in 3 s")]);
  });

  // Drift: the making of a key takes any error of its call for a key that was not made, and goes on to the next. A wait stopped there would be read as a failed key, and the install would go on.
  test("stopped during the wait of a key's making ends with that error, and sends nothing after the call that was asked to wait", async () => {
    const read = installer.read({ flags: new Map([[flag, value]]), env: {} });
    const login = parseLogin("owner@example.com");
    const account: Account = { ...emptyAccount(), bindings: [], noWorker: true };
    const world = await worldOf(account);
    const interrupted = new Error("the command was interrupted");
    const reach = { ...world.reach, sleep: () => Promise.reject(interrupted) };
    if (!read.ok || !login.ok) throw new Error("the test's place or login was refused");

    const none = await installer.find(installer.token(TOKEN) as Token, read.where, reach, "install");
    if (none.state !== "none") throw new Error(`the test's install could not start: ${none.state}`);

    Object.assign(account, { refuse: `POST /accounts/${ACCOUNT}/tokens`, refuseAs: { status: 429, code: 971 } });
    const thrown = await installer.install(none, read.where, login.value, "apply", reach, () => undefined).catch((error: unknown) => error);
    const last = world.asked.at(-1);

    expect([thrown, last?.method, last?.path]).toEqual([interrupted, "POST", `/accounts/${ACCOUNT}/tokens`]);
  });
});
