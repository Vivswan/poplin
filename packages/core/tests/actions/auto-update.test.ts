import { describe, expect, test } from "bun:test";

import { startDueUpdate } from "../../src/actions/auto-update";
import { type Asking, checkForUpdate } from "../../src/actions/check-update";
import type { Install } from "../../src/actions/records";
import type { Rebuilding } from "../../src/actions/start-update";
import { saveUpdateAddress } from "../../src/actions/update-address";
import { OWN_SCHEMA } from "../../src/database/open";
import type { SettingValues } from "../../src/records/settings";
import { ADMIN, DAY, makeWorld, NOW, type World } from "./support/actions-fixture";

const ADDRESS = "https://builds.example.com/hooks/3f9c2a7e5b";
const RELEASE = { version: "0.2.0", released: "2026-12-01", notes: "https://example.com/changelog/#v0-2-0", schema: OWN_SCHEMA };
const LATER = { ...RELEASE, version: "0.3.0" };
const WAIT = 3 * DAY;
const SWITCHED_ON = { auto_update: true };
const FIRST_SEEN = Math.ceil(NOW / DAY) * DAY;
const TAKEN = { version: "0.2.0", at: FIRST_SEEN + WAIT, taken: "0.2.0" };
const ENTRY = { by: "sweep@poplin.invalid", action: "update_started", detail: { from: "0.1.0", to: "0.2.0", automatic: true } };
const NOTHING = { sent: 0, auto: null, audit: [] };

/** What one scheduled run is given besides the install. */
interface Run {
  readonly rebuilding: Rebuilding;
  readonly release?: object;
  readonly version?: string;
  readonly website?: Asking;
}

/** A provider that answers every start with one status, and counts the starts. */
function provider(status = 204): Rebuilding & { readonly sent: string[] } {
  const sent: string[] = [];

  return {
    sent,
    accepts: (address) => address.hostname === "builds.example.com",
    fetch: async (address) => {
      sent.push(address);

      return new Response(null, { status });
    },
    counters: { takeMinute: async () => ({ ok: true }) },
  };
}

/** A website that names one release. */
function website(release: object): Asking {
  return { fetch: async () => Response.json(release) };
}

/** An install that learned of a release at `FIRST_SEEN`, with the address saved unless told not to. */
async function seen(settings: Partial<SettingValues>, release: object = RELEASE, address = true): Promise<World> {
  const world = await makeWorld(settings);
  world.clock.now = FIRST_SEEN;
  await checkForUpdate(world.install, website(release));
  if (address) await saveUpdateAddress(world.install, ADMIN, ADDRESS, provider().accepts);

  return world;
}

/** One scheduled run as the host makes it: the day's question, then the start that is due. */
async function run(install: Install, given: Run): Promise<void> {
  const learned = await checkForUpdate(install, given.website ?? website(given.release ?? RELEASE));
  if (learned !== undefined) await startDueUpdate(install, { ...learned, version: given.version ?? "0.1.0" }, given.rebuilding);
}

/** What a person can see afterwards: the starts sent, what the install kept of them, and the audit entries of started updates. */
async function outcome(world: World, rebuilding: { readonly sent: string[] }): Promise<unknown> {
  const audit = (await world.install.database.listAudit({ limit: 100 })).filter((entry) => entry.action === "update_started").map(({ by, action, detail }) => ({ by, action, detail }));

  return { sent: rebuilding.sent.length, auto: (await world.install.database.readUpdateCheck())?.auto, audit };
}

describe("startDueUpdate", () => {
  // Drift: this start is the one thing the install does to itself with nobody asking. Each row takes one rule away, and must end with no request sent; the first row keeps them all.
  test.each([
    { name: "every rule holds", settings: SWITCHED_ON, after: WAIT, expected: { sent: 1, auto: TAKEN, audit: [ENTRY] } },
    { name: "auto_update is off, as in a new install", settings: {}, after: WAIT, expected: NOTHING },
    { name: "update_check was switched off after the release was learned", settings: SWITCHED_ON, later: { update_check: false }, after: WAIT, expected: NOTHING },
    { name: "the website does not answer that day", settings: SWITCHED_ON, website: { fetch: async () => new Response("down", { status: 503 }) }, after: WAIT, expected: NOTHING },
    { name: "the release changes the database", settings: SWITCHED_ON, release: { ...RELEASE, schema: OWN_SCHEMA + 1 }, after: WAIT, expected: NOTHING },
    { name: "the release changes the database, a year on", settings: SWITCHED_ON, release: { ...RELEASE, schema: OWN_SCHEMA + 1 }, after: 365 * DAY, expected: NOTHING },
    { name: "one second before the wait is over", settings: SWITCHED_ON, after: WAIT - 1000, expected: NOTHING },
    { name: "the install runs the newest version", settings: SWITCHED_ON, version: "0.2.0", after: WAIT, expected: NOTHING },
    { name: "the install runs a version that is no three numbers", settings: SWITCHED_ON, version: "0.1.0-dev", after: WAIT, expected: NOTHING },
    { name: "no address is saved", settings: SWITCHED_ON, address: false, after: WAIT, expected: NOTHING },
    { name: "the provider refuses the start", settings: SWITCHED_ON, status: 500, after: WAIT, expected: { sent: 1, auto: { ...TAKEN, taken: null }, audit: [] } },
    { name: "the provider answers that it is asked too often", settings: SWITCHED_ON, status: 429, after: WAIT, expected: { sent: 1, auto: { ...TAKEN, taken: null }, audit: [] } },
  ])("$name", async ({ settings, later, release, version, website: asked, address, status, after, expected }) => {
    const world = await seen(settings, release, address);
    const rebuilding = provider(status);
    if (later !== undefined) await world.install.database.changeSettings(later, { by: ADMIN.holder, at: FIRST_SEEN });
    world.clock.now = FIRST_SEEN + after;

    await run(world.install, { rebuilding, release, version, website: asked });

    expect(await outcome(world, rebuilding)).toEqual(expected);
  });

  // Drift: the sweep runs 96 times a day and the build takes minutes. A start on every run, or on every day until the new version is up, would queue build after build of one release.
  test("a version is started once: not by the later runs of that day, and not on the days after it", async () => {
    const world = await seen(SWITCHED_ON);
    const rebuilding = provider();
    world.clock.now = FIRST_SEEN + WAIT;

    for (let quarter = 0; quarter < 96 * 3; quarter += 1) {
      await run(world.install, { rebuilding });
      world.clock.now += DAY / 96;
    }

    expect(await outcome(world, rebuilding)).toEqual({ sent: 1, auto: TAKEN, audit: [ENTRY] });
  });

  // Drift: a start the provider did not take must not end the matter, and must not be sent on every run either: once a UTC day, the pace of the question itself.
  test("a start the provider refused is tried again once on each later day, until one is taken", async () => {
    const world = await seen(SWITCHED_ON);
    const refusing = provider(503);
    world.clock.now = FIRST_SEEN + WAIT;

    for (let quarter = 0; quarter < 96 * 2; quarter += 1) {
      await run(world.install, { rebuilding: refusing });
      world.clock.now += DAY / 96;
    }

    const refused = await outcome(world, refusing);
    const taking = provider();
    await run(world.install, { rebuilding: taking });
    await run(world.install, { rebuilding: taking });

    expect([refused, await outcome(world, taking)]).toEqual([
      { sent: 2, auto: { version: "0.2.0", at: FIRST_SEEN + WAIT + DAY, taken: null }, audit: [] },
      { sent: 1, auto: { version: "0.2.0", at: FIRST_SEEN + WAIT + 2 * DAY, taken: "0.2.0" }, audit: [ENTRY] },
    ]);
  });

  // Drift: the audit entry is written after the provider took the start. A day's allowance of the database that ran out between the two once left no trace of the start, and the next day sent a second one.
  test("a start the provider took is not sent again though the write after it failed", async () => {
    const world = await seen(SWITCHED_ON);
    const rebuilding = provider();
    const database = new Proxy(world.install.database, {
      get: (inner, name) => (name === "appendAudit" ? () => Promise.reject(new Error("the database is down")) : Reflect.get(inner, name, inner).bind(inner)),
    });
    world.clock.now = FIRST_SEEN + WAIT;

    const failed = await run({ ...world.install, database }, { rebuilding }).catch((error: Error) => error.message);
    world.clock.now += DAY;
    await run(world.install, { rebuilding });

    expect([failed, await outcome(world, rebuilding)]).toEqual(["the database is down", { sent: 1, auto: TAKEN, audit: [] }]);
  });

  // Drift: a request that ends with no answer may have reached the provider. Taking it for a refusal once started the same version again the next day.
  test("a start that got no answer is not sent again by itself", async () => {
    const world = await seen(SWITCHED_ON);
    const rebuilding = provider();
    const silent: Rebuilding = {
      ...rebuilding,
      fetch: (address) => {
        rebuilding.sent.push(address);

        return Promise.reject(new Error("the connection was reset"));
      },
    };
    world.clock.now = FIRST_SEEN + WAIT;

    await run(world.install, { rebuilding: silent });
    world.clock.now += DAY;
    await run(world.install, { rebuilding });

    expect(await outcome(world, rebuilding)).toEqual({ sent: 1, auto: TAKEN, audit: [] });
  });

  // Drift: the version is kept as taken before the request. A read that failed between the two once left it taken with nothing sent, and the install never started that version.
  test("a start that failed before anything was sent is made on the next day", async () => {
    const world = await seen(SWITCHED_ON);
    const rebuilding = provider();
    const reads = { count: 0 };
    const database = new Proxy(world.install.database, {
      get: (inner, name) => {
        const member = Reflect.get(inner, name, inner).bind(inner);
        if (name !== "readUpdateAddress") return member;

        return () => {
          reads.count += 1;

          return reads.count === 2 ? Promise.reject(new Error("the database is down")) : member();
        };
      },
    });
    world.clock.now = FIRST_SEEN + WAIT;

    const failed = await run({ ...world.install, database }, { rebuilding }).catch((error: Error) => error.message);
    const between = await outcome(world, rebuilding);
    world.clock.now += DAY;
    await run(world.install, { rebuilding });

    expect([failed, between, await outcome(world, rebuilding)]).toEqual([
      "the database is down",
      { sent: 0, auto: { ...TAKEN, taken: null }, audit: [] },
      { sent: 1, auto: { ...TAKEN, at: FIRST_SEEN + WAIT + DAY }, audit: [ENTRY] },
    ]);
  });

  // Drift: the wait is for the version, not for the install. A release that comes out after one was started must wait its own three days from the day it was first seen.
  test("a later release waits from the day it was first seen, and is started though the one before it was", async () => {
    const world = await seen(SWITCHED_ON);
    const rebuilding = provider();
    const later = { rebuilding, release: LATER, version: "0.2.0" };
    world.clock.now = FIRST_SEEN + WAIT;
    await run(world.install, { rebuilding });

    world.clock.now = FIRST_SEEN + WAIT + DAY;
    await run(world.install, later);
    world.clock.now = FIRST_SEEN + 2 * WAIT + DAY - 1000;
    await run(world.install, later);
    const early = rebuilding.sent.length;
    world.clock.now = FIRST_SEEN + 2 * WAIT + DAY;
    await run(world.install, later);

    expect([early, await outcome(world, rebuilding)]).toEqual([
      1,
      { sent: 2, auto: { version: "0.3.0", at: FIRST_SEEN + 2 * WAIT + DAY, taken: "0.3.0" }, audit: [{ ...ENTRY, detail: { from: "0.2.0", to: "0.3.0", automatic: true } }, ENTRY] },
    ]);
  });

  // Drift: the website can name an older release again, when a newer one is withdrawn. A try for the newer one that failed in between once wiped that the older one had been started, and it was started a second time.
  test("a version started before is not started again after a newer one was tried and the website went back to it", async () => {
    const world = await seen(SWITCHED_ON);
    const rebuilding = provider();
    const refusing = provider(503);
    world.clock.now = FIRST_SEEN + WAIT;
    await run(world.install, { rebuilding });

    world.clock.now += DAY;
    await run(world.install, { rebuilding: refusing, release: LATER });
    world.clock.now += WAIT;
    await run(world.install, { rebuilding: refusing, release: LATER });
    world.clock.now += DAY;
    await run(world.install, { rebuilding });
    world.clock.now += WAIT;
    await run(world.install, { rebuilding });

    expect([refusing.sent.length, await outcome(world, rebuilding)]).toEqual([1, { sent: 1, auto: { version: "0.3.0", at: FIRST_SEEN + 2 * WAIT + DAY, taken: "0.2.0" }, audit: [ENTRY] }]);
  });
});
