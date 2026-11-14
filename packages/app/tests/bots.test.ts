import { describe, expect, test } from "bun:test";
import { planZoneBots, syncZoneBots } from "../src/cloudflare/bots";
import type { ZonePlan } from "../src/cloudflare/client";
import { reply, withFake } from "./fake-cloudflare";

const COVERS_OTHERS = "the AI bot block covers the whole zone, and this zone has hostnames of its own";
const SWITCHED_OFF = "the zone-wide bot switches are set to off";
const AI_BLOCK = { ai_bots_protection: "block" };
const AI_BLOCK_AND_FIGHT = { ai_bots_protection: "block", fight_mode: true };
const UNSET = { ai_bots_protection: "disabled", fight_mode: false, enable_js: false };

describe("planZoneBots", () => {
  const cases: readonly {
    readonly zoneBots: "auto" | "on" | "off";
    readonly plan: ZonePlan;
    readonly sharesZone: boolean;
    readonly step: object;
  }[] = [
    { zoneBots: "auto", plan: "free", sharesZone: false, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK } },
    { zoneBots: "auto", plan: "free", sharesZone: true, step: { kind: "skip", subject: "zone bot switches", reason: COVERS_OTHERS } },
    { zoneBots: "auto", plan: "pro", sharesZone: false, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK } },
    { zoneBots: "auto", plan: "pro", sharesZone: true, step: { kind: "skip", subject: "zone bot switches", reason: COVERS_OTHERS } },
    { zoneBots: "on", plan: "free", sharesZone: false, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK_AND_FIGHT } },
    { zoneBots: "on", plan: "free", sharesZone: true, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK_AND_FIGHT } },
    { zoneBots: "on", plan: "pro", sharesZone: true, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK } },
    { zoneBots: "off", plan: "free", sharesZone: false, step: { kind: "skip", subject: "zone bot switches", reason: SWITCHED_OFF } },
    { zoneBots: "off", plan: "free", sharesZone: true, step: { kind: "skip", subject: "zone bot switches", reason: SWITCHED_OFF } },
  ];

  test.each(cases)(
    "$zoneBots on $plan, zone shared $sharesZone: a switch that covers the whole zone is flipped on a zone with hostnames of its own only by `on`, and Bot Fight Mode only by `on` on the Free plan",
    ({ step, ...desired }) => {
      expect<unknown>(planZoneBots(desired, UNSET)).toEqual([step]);
    },
  );

  const settled: readonly { readonly name: string; readonly zoneBots: "auto" | "on"; readonly current: object; readonly step: object }[] = [
    {
      name: "the AI bot block already on",
      zoneBots: "auto",
      current: { ...UNSET, ai_bots_protection: "block" },
      step: { kind: "leave", subject: "zone bot switches" },
    },
    {
      name: "both switches already on",
      zoneBots: "on",
      current: { ai_bots_protection: "block", fight_mode: true },
      step: { kind: "leave", subject: "zone bot switches" },
    },
    {
      name: "Bot Fight Mode on by the owner's hand while poplin wants the AI bot block alone",
      zoneBots: "auto",
      current: { ai_bots_protection: "block", fight_mode: true },
      step: { kind: "leave", subject: "zone bot switches" },
    },
    {
      name: "one of the two switches still off",
      zoneBots: "on",
      current: { ai_bots_protection: "block", fight_mode: false },
      step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK_AND_FIGHT },
    },
  ];

  test.each(settled)("$name: a second run sends nothing, and poplin never switches off what it finds on", ({ zoneBots, current, step }) => {
    expect<unknown>(planZoneBots({ zoneBots, plan: "free", sharesZone: false }, current)).toEqual([step]);
  });
});

describe("syncZoneBots", () => {
  test("two runs on a zone with no hostnames of its own: the first sends the AI bot block alone, the second reads and sends nothing", async () => {
    let switches: object = UNSET;

    await withFake(
      (asked) => {
        if (asked.method === "PUT") switches = { ...switches, ...(asked.body as object) };

        return reply(switches);
      },
      async (connection, asked) => {
        const desired = { zoneBots: "auto", plan: "free", sharesZone: false } as const;
        const first = await syncZoneBots(connection, "zone-1", desired);
        const second = await syncZoneBots(connection, "zone-1", desired);

        expect(first).toMatchObject({ ok: true, report: { changed: ["zone bot switches"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["zone bot switches"], changedNothing: true } });
        expect(asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
          "GET /zones/zone-1/bot_management",
          "PUT /zones/zone-1/bot_management",
          "GET /zones/zone-1/bot_management",
        ]);
        expect(asked[1]?.body).toEqual(AI_BLOCK);
      },
    );
  });

  const untouched: readonly { readonly zoneBots: "auto" | "off"; readonly reason: string }[] = [
    { zoneBots: "auto", reason: COVERS_OTHERS },
    { zoneBots: "off", reason: SWITCHED_OFF },
  ];

  test.each(untouched)(
    "$zoneBots on a zone with hostnames of its own: no request is sent at all, so a key without the bot permission still works, and the report says why",
    async ({ zoneBots, reason }) => {
      await withFake(
        () => reply(UNSET),
        async (connection, asked) => {
          expect(await syncZoneBots(connection, "zone-1", { zoneBots, plan: "free", sharesZone: true })).toMatchObject({
            ok: true,
            report: { skipped: [{ subject: "zone bot switches", reason }], changedNothing: true },
          });
          expect(asked).toHaveLength(0);
        },
      );
    },
  );

  test("a key that may not read the switches: the run fails with Cloudflare's refusal and nothing is sent after it", async () => {
    await withFake(
      () => undefined,
      async (connection, asked) => {
        expect(await syncZoneBots(connection, "zone-1", { zoneBots: "on", plan: "free", sharesZone: true })).toMatchObject({
          ok: false,
          failure: "refused",
          report: { changedNothing: true },
        });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
