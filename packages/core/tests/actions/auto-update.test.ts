import { describe, expect, test } from "bun:test";

import { startDueUpdate } from "../../src/actions/auto-update";
import { type Asking, checkForUpdate } from "../../src/actions/check-update";
import { signedBy } from "../../src/actions/reach";
import type { Install } from "../../src/actions/records";
import type { SelfUpdate, Updating } from "../../src/actions/start-update";
import { OWN_SCHEMA } from "../../src/database/open";
import type { SettingValues } from "../../src/records/settings";
import { ADMIN, DAY, makeWorld, NOW, type World } from "./support/actions-fixture";

const RELEASE = { version: "0.2.0", released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.2.0", schema: OWN_SCHEMA };
const LATER = { ...RELEASE, version: "0.3.0" };
const WAIT = 3 * DAY;
const SWITCHED_ON = { auto_update: true };
const FIRST_SEEN = Math.ceil(NOW / DAY) * DAY;
const TAKEN = { version: "0.2.0", at: FIRST_SEEN + WAIT, taken: "0.2.0" };
const UNTAKEN = { ...TAKEN, taken: null };
const ENTRY = { by: "sweep@poplin.invalid", action: "update_started", detail: { from: "0.1.0", to: "0.2.0", automatic: true } };
const NOTHING = { sent: 0, auto: null, audit: [] };

/** What one scheduled run is given besides the install. */
interface Run {
  readonly updating: Updating;
  readonly release?: object;
  readonly version?: string;
  readonly website?: Asking;
}

/** How a host's door behaves: `ready` and `put` are a refusal's code, or nothing for a step that works; `silent` is an upload that ends with no answer at all. */
interface Door {
  readonly ready?: string;
  readonly put?: string;
  readonly silent?: true;
}

/** A host that takes a release by itself. It counts what it was asked for and what it put in place. */
function host(door: Door = {}): Updating & { readonly sent: string[]; readonly asked: unknown[] } {
  const asked: unknown[] = [];
  const sent: string[] = [];
  const self: SelfUpdate = {
    holdsKey: () => true,
    async ready(wanted) {
      asked.push(wanted);
      if (door.ready !== undefined) return { ok: false, code: door.ready } as never;

      return {
        ok: true,
        version: wanted.version,
        async put() {
          sent.push(wanted.version);
          if (door.silent === true) throw new Error("the connection was reset");

          return door.put === undefined ? { ok: true } : ({ ok: false, code: door.put } as never);
        },
      };
    },
  };

  return { self, sent, asked, counters: { takeMinute: async () => ({ ok: true }) } };
}

/** A website that names one release. */
function website(release: object): Asking {
  return { fetch: async () => Response.json(release) };
}

/** An install that learned of a release at `FIRST_SEEN`. */
async function seen(settings: Partial<SettingValues>, release: object = RELEASE): Promise<World> {
  const world = await makeWorld(settings);
  world.clock.now = FIRST_SEEN;
  await checkForUpdate(world.install, website(release));

  return world;
}

/** One scheduled run as the host makes it: the day's question, then the start that is due. */
async function run(install: Install, given: Run): Promise<void> {
  const learned = await checkForUpdate(install, given.website ?? website(given.release ?? RELEASE));
  if (learned !== undefined) await startDueUpdate(install, { ...learned, version: given.version ?? "0.1.0" }, given.updating);
}

/** What a person can see afterwards: the releases put in place, what the install kept of its tries, and the audit entries of started updates. */
async function outcome(world: World, updating: { readonly sent: string[] }): Promise<unknown> {
  const audit = (await world.install.database.listAudit({ limit: 100 })).filter((entry) => entry.action === "update_started").map(({ by, action, detail }) => ({ by, action, detail }));

  return { sent: updating.sent.length, auto: (await world.install.database.readUpdateCheck())?.auto, audit };
}

describe("startDueUpdate", () => {
  // Drift: this start is the one thing the install does to itself with nobody asking. Each row takes one rule away, and must end with the host asked for nothing; the first row keeps them all.
  test.each([
    { name: "every rule holds", settings: SWITCHED_ON, after: WAIT, expected: { sent: 1, auto: TAKEN, audit: [ENTRY] }, asked: 1 },
    { name: "auto_update is off, as in a new install", settings: {}, after: WAIT },
    { name: "both were switched off after the release was learned", settings: SWITCHED_ON, later: { update_check: false, auto_update: false }, after: WAIT },
    { name: "the website does not answer that day", settings: SWITCHED_ON, website: { fetch: async () => new Response("down", { status: 503 }) }, after: WAIT },
    { name: "the release changes the database", settings: SWITCHED_ON, release: { ...RELEASE, schema: OWN_SCHEMA + 1 }, after: WAIT },
    { name: "the release changes the database, a year on", settings: SWITCHED_ON, release: { ...RELEASE, schema: OWN_SCHEMA + 1 }, after: 365 * DAY },
    { name: "one second before the wait is over", settings: SWITCHED_ON, after: WAIT - 1000 },
    { name: "the install runs the newest version", settings: SWITCHED_ON, version: "0.2.0", after: WAIT },
    { name: "the install runs a version that is no three numbers", settings: SWITCHED_ON, version: "0.1.0-dev", after: WAIT },
  ])("$name", async ({ settings, later, release, version, website: asking, after, expected, asked }) => {
    const world = await seen(settings, release);
    const updating = host();
    if (later !== undefined) await world.install.database.changeSettings(later, signedBy(ADMIN, FIRST_SEEN));
    world.clock.now = FIRST_SEEN + after;

    await run(world.install, { updating, release, version, website: asking });

    expect([await outcome(world, updating), updating.asked.length]).toEqual([expected ?? NOTHING, asked ?? 0]);
  });

  // Drift: with no build between a release and the running code, this is the whole of what the install does to itself. Each row is what one day's run leaves behind: whether files were put in place, and whether the version counts as taken.
  test.each([
    { name: "the release could not be fetched or checked: nothing was sent, so the next day tries again", door: { ready: "release_refused" }, expected: { sent: 0, auto: UNTAKEN, audit: [] } },
    { name: "the host did not answer before any file was put in place: the next day tries again", door: { ready: "update_unreachable" }, expected: { sent: 0, auto: UNTAKEN, audit: [] } },
    { name: "the key lacks the right: the next day tries again", door: { ready: "lacks_right" }, expected: { sent: 0, auto: UNTAKEN, audit: [] } },
    { name: "the host refused the new code: the next day tries again", door: { put: "version_refused" }, expected: { sent: 1, auto: UNTAKEN, audit: [ENTRY] } },
    { name: "the host did not answer the upload, which may be in: not tried again", door: { put: "update_unreachable" }, expected: { sent: 1, auto: TAKEN, audit: [ENTRY] } },
  ])("$name", async ({ door, expected }) => {
    const world = await seen(SWITCHED_ON);
    const updating = host(door);
    world.clock.now = FIRST_SEEN + WAIT;

    await run(world.install, { updating });

    expect([await outcome(world, updating), updating.asked]).toEqual([expected, [{ version: "0.2.0", automatic: true }]]);
  });

  // Drift: the sweep runs 96 times a day. A start on every run, or on every day after, would fetch and upload one release again and again.
  test("a version is started once: not by the later runs of that day, and not on the days after it", async () => {
    const world = await seen(SWITCHED_ON);
    const updating = host();
    world.clock.now = FIRST_SEEN + WAIT;

    for (let quarter = 0; quarter < 96 * 3; quarter += 1) {
      await run(world.install, { updating });
      world.clock.now += DAY / 96;
    }

    expect([await outcome(world, updating), updating.asked.length]).toEqual([{ sent: 1, auto: TAKEN, audit: [ENTRY] }, 1]);
  });

  // Drift: a release that could not be taken must not end the matter, and must not be fetched on every run either: once a UTC day, the pace of the question itself.
  test("a release that was refused is tried again once on each later day, until one is taken", async () => {
    const world = await seen(SWITCHED_ON);
    const refusing = host({ ready: "release_refused" });
    world.clock.now = FIRST_SEEN + WAIT;

    for (let quarter = 0; quarter < 96 * 2; quarter += 1) {
      await run(world.install, { updating: refusing });
      world.clock.now += DAY / 96;
    }

    const refused = [await outcome(world, refusing), refusing.asked.length];
    const taking = host();
    await run(world.install, { updating: taking });
    await run(world.install, { updating: taking });

    expect([refused, await outcome(world, taking)]).toEqual([
      [{ sent: 0, auto: { version: "0.2.0", at: FIRST_SEEN + WAIT + DAY, taken: null }, audit: [] }, 2],
      { sent: 1, auto: { version: "0.2.0", at: FIRST_SEEN + WAIT + 2 * DAY, taken: "0.2.0" }, audit: [ENTRY] },
    ]);
  });

  // Drift: an upload that ends with no answer may be in. Taking it for a refusal once started the same version again the next day.
  test("an upload that got no answer is not sent again by itself", async () => {
    const world = await seen(SWITCHED_ON);
    const silent = host({ silent: true });
    const updating = host();
    world.clock.now = FIRST_SEEN + WAIT;

    const failed = await run(world.install, { updating: silent }).catch((error: Error) => error.message);
    world.clock.now += DAY;
    await run(world.install, { updating });

    expect([failed, silent.sent.length, await outcome(world, updating)]).toEqual(["the connection was reset", 1, { sent: 0, auto: TAKEN, audit: [ENTRY] }]);
  });

  // Drift: the version is kept as taken before the files are handed over. A write that failed between the two once left it taken with nothing sent, and the install never started that version.
  test("a start that failed before anything was sent is made on the next day", async () => {
    const world = await seen(SWITCHED_ON);
    const updating = host();
    const database = new Proxy(world.install.database, {
      get: (inner, name) => (name === "appendAudit" ? () => Promise.reject(new Error("the database is down")) : Reflect.get(inner, name, inner).bind(inner)),
    });
    world.clock.now = FIRST_SEEN + WAIT;

    const failed = await run({ ...world.install, database }, { updating }).catch((error: Error) => error.message);
    const between = await outcome(world, updating);
    world.clock.now += DAY;
    await run(world.install, { updating });

    expect([failed, between, await outcome(world, updating)]).toEqual([
      "the database is down",
      { sent: 0, auto: UNTAKEN, audit: [] },
      { sent: 1, auto: { ...TAKEN, at: FIRST_SEEN + WAIT + DAY }, audit: [ENTRY] },
    ]);
  });

  // Drift: the wait is for the version, not for the install. A release that comes out after one was started must wait its own three days from the day it was first seen.
  test("a later release waits from the day it was first seen, and is started though the one before it was", async () => {
    const world = await seen(SWITCHED_ON);
    const updating = host();
    const later = { updating, release: LATER, version: "0.2.0" };
    world.clock.now = FIRST_SEEN + WAIT;
    await run(world.install, { updating });

    world.clock.now = FIRST_SEEN + WAIT + DAY;
    await run(world.install, later);
    world.clock.now = FIRST_SEEN + 2 * WAIT + DAY - 1000;
    await run(world.install, later);
    const early = updating.sent.length;
    world.clock.now = FIRST_SEEN + 2 * WAIT + DAY;
    await run(world.install, later);

    expect([early, await outcome(world, updating)]).toEqual([
      1,
      { sent: 2, auto: { version: "0.3.0", at: FIRST_SEEN + 2 * WAIT + DAY, taken: "0.3.0" }, audit: [{ ...ENTRY, detail: { from: "0.2.0", to: "0.3.0", automatic: true } }, ENTRY] },
    ]);
  });

  // Drift: the website can name an older release again, when a newer one is withdrawn. A try for the newer one that failed in between once wiped that the older one had been started, and it was started a second time.
  test("a version started before is not started again after a newer one was tried and the website went back to it", async () => {
    const world = await seen(SWITCHED_ON);
    const updating = host();
    const refusing = host({ ready: "release_refused" });
    world.clock.now = FIRST_SEEN + WAIT;
    await run(world.install, { updating });

    world.clock.now += DAY;
    await run(world.install, { updating: refusing, release: LATER });
    world.clock.now += WAIT;
    await run(world.install, { updating: refusing, release: LATER });
    world.clock.now += DAY;
    await run(world.install, { updating });
    world.clock.now += WAIT;
    await run(world.install, { updating });

    expect([refusing.asked.length, await outcome(world, updating)]).toEqual([1, { sent: 1, auto: { version: "0.3.0", at: FIRST_SEEN + 2 * WAIT + DAY, taken: "0.2.0" }, audit: [ENTRY] }]);
  });
});
