import { describe, expect, test } from "bun:test";
import { planZoneBots, syncZoneBots } from "../../../src/zone/bots/bots";
import type { ZonePlan } from "../../../src/zone/client";
import { withFake } from "../support/fake-cloudflare";
import { reply } from "../support/replies";

const COVERS_OTHERS = "the AI bot block covers the whole zone, and this zone has hostnames of its own";
const SWITCHED_OFF = "the zone-wide bot switches are set to off";
const AI_BLOCK = { ai_bots_protection: "block" };
const AI_BLOCK_AND_FIGHT = { ai_bots_protection: "block", fight_mode: true };
const UNSET = { ai_bots_protection: "disabled", fight_mode: false, enable_js: false };

describe("planZoneBots", () => {
  const cases: readonly {
    readonly blockBots: "auto" | "on" | "off";
    readonly plan: ZonePlan;
    readonly sharesZone: boolean;
    readonly step: object;
  }[] = [
    { blockBots: "auto", plan: "free", sharesZone: false, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK } },
    { blockBots: "auto", plan: "free", sharesZone: true, step: { kind: "skip", subject: "zone bot switches", reason: COVERS_OTHERS } },
    { blockBots: "auto", plan: "pro", sharesZone: false, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK } },
    { blockBots: "auto", plan: "pro", sharesZone: true, step: { kind: "skip", subject: "zone bot switches", reason: COVERS_OTHERS } },
    { blockBots: "on", plan: "free", sharesZone: false, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK_AND_FIGHT } },
    { blockBots: "on", plan: "free", sharesZone: true, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK_AND_FIGHT } },
    { blockBots: "on", plan: "pro", sharesZone: true, step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK } },
    { blockBots: "off", plan: "free", sharesZone: false, step: { kind: "skip", subject: "zone bot switches", reason: SWITCHED_OFF } },
    { blockBots: "off", plan: "free", sharesZone: true, step: { kind: "skip", subject: "zone bot switches", reason: SWITCHED_OFF } },
  ];

  test.each(cases)(
    "$blockBots on $plan, zone shared $sharesZone: a switch that covers the whole zone is flipped on a zone with hostnames of its own only by `on`, and Bot Fight Mode only by `on` on the Free plan",
    ({ step, ...desired }) => {
      expect<unknown>(planZoneBots(desired, UNSET)).toEqual([step]);
    },
  );

  const settled: readonly { readonly name: string; readonly blockBots: "auto" | "on"; readonly current: object; readonly step: object }[] = [
    {
      name: "the AI bot block already on",
      blockBots: "auto",
      current: { ...UNSET, ai_bots_protection: "block" },
      step: { kind: "leave", subject: "zone bot switches" },
    },
    {
      name: "both switches already on",
      blockBots: "on",
      current: { ai_bots_protection: "block", fight_mode: true },
      step: { kind: "leave", subject: "zone bot switches" },
    },
    {
      name: "Bot Fight Mode on by the owner's hand while poplin wants the AI bot block alone",
      blockBots: "auto",
      current: { ai_bots_protection: "block", fight_mode: true },
      step: { kind: "leave", subject: "zone bot switches" },
    },
    {
      name: "one of the two switches still off",
      blockBots: "on",
      current: { ai_bots_protection: "block", fight_mode: false },
      step: { kind: "change", subject: "zone bot switches", switches: AI_BLOCK_AND_FIGHT },
    },
  ];

  test.each(settled)("$name: a second run sends nothing, and poplin never switches off what it finds on", ({ blockBots, current, step }) => {
    expect<unknown>(planZoneBots({ blockBots, plan: "free", sharesZone: false }, current)).toEqual([step]);
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
        const desired = { blockBots: "auto", plan: "free", sharesZone: false } as const;
        const first = await syncZoneBots(connection, "zone-1", desired, "apply");
        const second = await syncZoneBots(connection, "zone-1", desired, "apply");

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

  const untouched: readonly { readonly blockBots: "auto" | "off"; readonly reason: string }[] = [
    { blockBots: "auto", reason: COVERS_OTHERS },
    { blockBots: "off", reason: SWITCHED_OFF },
  ];

  test.each(untouched)(
    "$blockBots on a zone with hostnames of its own: no request is sent at all, so a key without the bot permission still works, and the report says why",
    async ({ blockBots, reason }) => {
      await withFake(
        () => reply(UNSET),
        async (connection, asked) => {
          expect(await syncZoneBots(connection, "zone-1", { blockBots, plan: "free", sharesZone: true }, "apply")).toMatchObject({
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
        expect(await syncZoneBots(connection, "zone-1", { blockBots: "on", plan: "free", sharesZone: true }, "apply")).toMatchObject({
          ok: false,
          failure: "refused",
          report: { changedNothing: true },
        });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });
});
