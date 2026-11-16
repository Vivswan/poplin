import { describe, expect, test } from "bun:test";

import { pickRelease } from "../../src/actions/pick-release";
import { type SelfUpdate, startUpdate, type Updating } from "../../src/actions/start-update";
import { OWN_SCHEMA } from "../../src/database/open";
import { dayOf } from "../../src/records/views";
import { ADMIN, makeWorld, NOW, OWNER, type World } from "./support/actions-fixture";

/** What a host answers, step by step: `ready` and `put` are a refusal's code and what it is about, or nothing for a step that works. */
interface Door {
  readonly version?: string;
  readonly ready?: readonly [string, string?];
  readonly put?: readonly [string, string?];
  readonly unset?: string;
}

/** The audit entries without their cursor and moment, the oldest first, but for the one of the first settings. */
async function entries(world: World): Promise<unknown[]> {
  const listed = await world.install.database.listAudit({ limit: 100 });

  return listed
    .map(({ by, action, site, detail }) => ({ by, action, site, detail }))
    .reverse()
    .slice(1);
}

/** A host that takes a release by itself: it counts the starts of each minute, records what it was asked for, and what the log held at the moment the files were put in place. */
function host(world: () => World, door: Door): Updating & { readonly asked: unknown[]; readonly logged: unknown[] } {
  const asked: unknown[] = [];
  const logged: unknown[] = [];
  const minutes = new Map<string, number>();
  const refusal = ([code, about]: readonly [string, string?]): never => ({ ok: false, code, ...(about === undefined ? {} : { about }) }) as never;
  const self: SelfUpdate = {
    holdsKey: () => true,
    async ready(wanted) {
      asked.push(wanted);
      if (door.ready !== undefined) return refusal(door.ready);

      return {
        ok: true,
        version: door.version ?? "0.2.0",
        async put() {
          logged.push(...(await entries(world())));
          if (door.put !== undefined) return refusal(door.put);

          return door.unset === undefined ? { ok: true } : { ok: true, unset: door.unset };
        },
      };
    },
  };

  return {
    self,
    asked,
    logged,
    counters: {
      takeMinute: async (window, now) => {
        const minute = `${window.scope}:${window.key}:${Math.floor(now / 60_000)}`;
        const counted = minutes.get(minute) ?? 0;
        if (counted >= window.limit) return { ok: false, retryAfterSeconds: 60 };

        minutes.set(minute, counted + 1);

        return { ok: true };
      },
    },
  };
}

describe("startUpdate", () => {
  const started = { by: ADMIN.holder, action: "update_started", site: null, detail: { from: "0.1.0", to: "0.2.0" } };
  const done = { ok: true, started: true, from: "0.1.0", to: "0.2.0" };

  // Drift: the request after the upload runs the new code, so the log entry must be there when the files are put in place. A refusal is noted under its code and what it is about: the Problems list picks its sentence by those two.
  test.each<{ readonly name: string; readonly door: Door; readonly answer: unknown; readonly audit: unknown[]; readonly logged?: unknown[]; readonly noted?: readonly [string | null, string | null] }>([
    { name: "the release is fetched, checked, and put in place", door: {}, answer: done, audit: [started], logged: [started] },
    { name: "nothing newer is out", door: { ready: ["no_update"] }, answer: { ok: false, code: "no_update" }, audit: [] },
    { name: "the host's key is refused", door: { ready: ["key_refused"] }, answer: { ok: false, code: "key_refused" }, audit: [], noted: ["key_refused", null] },
    {
      name: "the host's key lacks the right",
      door: { ready: ["lacks_right", "Workers Scripts Write"] },
      answer: { ok: false, code: "lacks_right", about: "Workers Scripts Write" },
      audit: [],
      noted: ["lacks_right", "Workers Scripts Write"],
    },
    {
      name: "the fetched files are not the published ones",
      door: { ready: ["release_refused", "digest_differs"] },
      answer: { ok: false, code: "release_refused", about: "digest_differs" },
      audit: [],
      noted: ["release_refused", "digest_differs"],
    },
    {
      name: "the host refuses the new code",
      door: { put: ["version_refused", "code"] },
      answer: { ok: false, code: "version_refused", about: "code" },
      audit: [started],
      logged: [started],
      noted: ["version_refused", "code"],
    },
    {
      name: "the host refuses the new code with a status alone",
      door: { put: ["version_refused", "400"] },
      answer: { ok: false, code: "version_refused", about: "400" },
      audit: [started],
      logged: [started],
      noted: ["version_refused", "status 400"],
    },
    {
      name: "the host does not answer the upload",
      door: { put: ["update_unreachable", "host"] },
      answer: { ok: false, code: "update_unreachable", about: "host" },
      audit: [started],
      logged: [started],
      noted: ["update_unreachable", "host"],
    },
    { name: "the code is in and its schedule is not", door: { unset: "schedule" }, answer: done, audit: [started], logged: [started], noted: [null, "the update is in, and its schedule could not be set"] },
  ])("$name", async ({ door, answer, audit, logged, noted }) => {
    const world = await makeWorld();
    const updating = host(() => world, door);

    expect<unknown>({ answer: await startUpdate(world.install, ADMIN, { version: "0.1.0" }, updating), audit: await entries(world), logged: updating.logged }).toEqual({ answer, audit, logged: logged ?? [] });
    expect(updating.asked).toEqual([{ version: "latest", automatic: false }]);
    expect((await world.install.database.listProblems(dayOf(NOW))).map(({ kind, count, name, message }) => [kind, count, name, message])).toEqual(noted === undefined ? [] : [["update_failed", 1, ...noted]]);
  });

  test("only an admin starts, and anyone else has the host asked for nothing", async () => {
    const world = await makeWorld();
    const updating = host(() => world, {});
    const answers = [await startUpdate(world.install, OWNER, { version: "0.1.0" }, updating), await startUpdate(world.install, ADMIN, { version: "0.1.0" }, updating)];

    expect<unknown>({ answers, asked: updating.asked.length }).toEqual({ answers: [{ ok: false, code: "not_allowed" }, done], asked: 1 });
  });

  // Drift: two presses, or a press beside the scheduled run, would each fetch and upload the release. One start fits a minute, whatever came of the first, and the second fetches nothing.
  test.each([
    { name: "after an update that went in", door: {}, later: true },
    { name: "after a refusal", door: { ready: ["release_refused", "unreachable"] } as const, later: "release_refused" },
  ])("a second press inside the minute fetches nothing: $name", async ({ door, later }) => {
    const world = await makeWorld();
    const updating = host(() => world, door);
    await startUpdate(world.install, ADMIN, { version: "0.1.0" }, updating);
    world.clock.now = NOW + 30_000;
    const second = await startUpdate(world.install, ADMIN, { version: "0.1.0" }, updating);
    world.clock.now = NOW + 60_000 - (NOW % 60_000);
    const third = await startUpdate(world.install, ADMIN, { version: "0.1.0" }, updating);

    expect<unknown>({ second, third: third.ok || third.code, asked: updating.asked.length }).toEqual({ second: { ok: false, code: "too_many_requests", about: "update" }, third: later, asked: 2 });
  });

  // Drift: a start that names a lower version is a going back, and only the version before the last update is one. Any older release taken by name brings back a fault that was mended since, and stays.
  test.each([
    { name: "the version before is taken", to: "0.2.0", answer: { ok: true, started: true, from: "0.3.0", to: "0.2.0" } },
    { name: "an older one is refused, and nothing is noted", to: "0.1.0", answer: { ok: false, code: "no_update" } },
    { name: "a newer one is taken", to: "0.4.0", answer: { ok: true, started: true, from: "0.3.0", to: "0.4.0" } },
  ])("an install at 0.3.0 that came from 0.2.0 is asked for $to: $name", async ({ to, answer }) => {
    const world = await makeWorld();
    const pin = { bundle: "a".repeat(64), schema: OWN_SCHEMA };
    const self: SelfUpdate = {
      holdsKey: () => true,
      last: { from: "0.2.0", to: "0.3.0", schema: OWN_SCHEMA, at: NOW },
      async ready(wanted) {
        const picked = pickRelease({ "0.1.0": pin, "0.2.0": pin, "0.4.0": pin }, wanted, "0.3.0");

        return picked.ok ? { ok: true, version: picked.version, put: async () => ({ ok: true }) } : { ok: false, code: "no_update" };
      },
    };

    expect<unknown>(await startUpdate(world.install, ADMIN, { version: "0.3.0", to }, { ...host(() => world, {}), self })).toEqual(answer);
    expect(await world.install.database.listProblems(dayOf(NOW))).toEqual([]);
  });
});
