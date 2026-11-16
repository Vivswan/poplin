import { describe, expect, test } from "bun:test";

import { checkForUpdate } from "../../src/actions/check-update";
import { exportSettings, exportSites } from "../../src/actions/export";
import { type Rebuilding, type SelfUpdate, startUpdate } from "../../src/actions/start-update";
import { removeUpdateAddress, saveUpdateAddress, updateAddressState } from "../../src/actions/update-address";
import { OWN_SCHEMA } from "../../src/database/open";
import { dayOf } from "../../src/records/views";
import { ADMIN, makeWorld, NOW, OWNER, type World } from "./support/actions-fixture";

const HOST = "builds.provider.example";
const ADDRESS = `https://${HOST}/hooks/3f9c2a7e5b`;
const RELEASE = { version: "0.2.0", released: "2026-12-01", notes: "https://github.com/Vivswan/poplin/releases/tag/v0.2.0", schema: OWN_SCHEMA };
const SET = { by: ADMIN.holder, action: "update_address_set", site: null, detail: {} };
const [ANSWERED, NO_ANSWER] = ["the request for a rebuild was answered", "the request for a rebuild got no answer"];

/** A provider that takes the addresses of one host, counts the starts of each minute up to the limit it is asked with, and records every request it is sent. */
function provider(answer: (address: string) => Promise<Response> = async () => Response.json({ success: true })): Rebuilding & { readonly sent: unknown[][] } {
  const sent: unknown[][] = [];
  const minutes = new Map<string, number>();

  return {
    sent,
    patienceMs: 10,
    accepts: (address) => address.hostname === HOST && address.pathname.startsWith("/hooks/") && address.search === "",
    fetch: (address, init) => {
      sent.push([address, { ...init, signal: "a signal" }]);

      return Promise.race([answer(address), new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))]);
    },
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

/** An install that has learned of a newer release, with the address saved. */
async function ready(rebuilding: Rebuilding): Promise<World> {
  const world = await makeWorld();
  await checkForUpdate(world.install, { fetch: async () => Response.json(RELEASE) });
  await saveUpdateAddress(world.install, ADMIN, ADDRESS, rebuilding.accepts);

  return world;
}

/** The audit entries without their cursor and moment, the oldest first, but for the one of the first settings. */
async function entries(world: World): Promise<unknown[]> {
  const listed = await world.install.database.listAudit({ limit: 100 });

  return listed
    .map(({ by, action, site, detail }) => ({ by, action, site, detail }))
    .reverse()
    .slice(1);
}

describe("the address that starts a rebuild", () => {
  // Drift: this is the line between a saved value and a request to a host of somebody's choosing. Each row is an address that must be kept, or refused with nothing stored.
  test.each([
    { name: "the provider's own form", typed: ADDRESS, kept: true },
    { name: "http", typed: ADDRESS.replace("https:", "http:"), kept: false },
    { name: "another host", typed: "https://example.com/hooks/3f9c2a7e5b", kept: false },
    { name: "the host as a subdomain of another", typed: `https://${HOST}.example.com/hooks/3f9c2a7e5b`, kept: false },
    { name: "the host as the user of another", typed: `https://${HOST}@example.com/hooks/3f9c2a7e5b`, kept: false },
    { name: "a user and a password", typed: `https://user:secret@${HOST}/hooks/3f9c2a7e5b`, kept: false },
    { name: "a port", typed: `https://${HOST}:8443/hooks/3f9c2a7e5b`, kept: false },
    { name: "a fragment", typed: `${ADDRESS}#part`, kept: false },
    { name: "a path the provider does not take", typed: `https://${HOST}/account/tokens`, kept: false },
    { name: "a query the provider does not take", typed: `${ADDRESS}?next=https://example.com/`, kept: false },
    { name: "no address at all", typed: "update now", kept: false },
    { name: "an address of 3,000 characters", typed: `${ADDRESS}${"a".repeat(3000)}`, kept: false },
  ])("$name", async ({ typed, kept }) => {
    const world = await makeWorld();
    const saved = await saveUpdateAddress(world.install, ADMIN, typed, provider().accepts);

    expect({ saved, state: await updateAddressState(world.install, ADMIN), audit: await entries(world) }).toEqual(
      kept
        ? { saved: { ok: true, set: true, since: NOW }, state: { ok: true, set: true, since: NOW }, audit: [SET] }
        : { saved: { ok: false, code: "bad_argument", about: "address" }, state: { ok: true, set: false, since: null }, audit: [] },
    );
  });

  // Drift: the address is a credential. Nothing an action answers, the audit log keeps, or a backup holds may carry it.
  test("no answer, audit entry, or export holds the address", async () => {
    const rebuilding = provider();
    const world = await ready(rebuilding);
    const answers = [
      await updateAddressState(world.install, ADMIN),
      await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding),
      await exportSettings(world.install, ADMIN),
      await exportSites(world.install, ADMIN, { limit: 100, all_versions: true }),
      await removeUpdateAddress(world.install, ADMIN),
      await world.install.database.listAudit({ limit: 100 }),
    ];

    expect(JSON.stringify(answers)).not.toContain("3f9c2a7e5b");
    expect(JSON.stringify(answers)).not.toContain(HOST);
  });

  test("only an admin reads, saves, removes, or starts", async () => {
    const rebuilding = provider();
    const world = await ready(rebuilding);
    const refused = { ok: false, code: "not_allowed" };

    expect<unknown>([
      await updateAddressState(world.install, OWNER),
      await saveUpdateAddress(world.install, OWNER, ADDRESS, rebuilding.accepts),
      await removeUpdateAddress(world.install, OWNER),
      await startUpdate(world.install, OWNER, { version: "0.1.0", anyway: true }, rebuilding),
    ]).toEqual([refused, refused, refused, refused]);
    expect({ sent: rebuilding.sent, audit: await entries(world) }).toEqual({ sent: [], audit: [SET] });
  });

  test("a removal is audited once, and a second one changes nothing", async () => {
    const world = await ready(provider());
    await removeUpdateAddress(world.install, ADMIN);
    await removeUpdateAddress(world.install, ADMIN);

    expect(await entries(world)).toEqual([SET, { ...SET, action: "update_address_removed" }]);
  });
});

describe("startUpdate", () => {
  const post = [ADDRESS, { method: "POST", redirect: "manual", signal: "a signal" }];
  const started = { by: ADMIN.holder, action: "update_started", site: null, detail: { from: "0.1.0", to: "0.2.0" } };

  // Drift: the one request leaves the install for the provider. Each row is what a press of the button must come to, what was sent, what the log then says, and the problem the install notes of a start that failed, which never holds the address.
  test.each([
    { name: "a newer version is out", version: "0.1.0", answer: { ok: true, started: true, from: "0.1.0", to: "0.2.0" }, sent: [post], audit: [SET, started] },
    { name: "no newer version is known", version: "0.2.0", answer: { ok: false, code: "no_update" }, sent: [], audit: [SET] },
    {
      name: "no newer version, and a rebuild is asked for anyway",
      version: "0.2.0",
      anyway: true,
      answer: { ok: true, started: true, from: "0.2.0", to: null },
      sent: [post],
      audit: [SET, { ...started, detail: { from: "0.2.0", to: null } }],
    },
    { name: "a 200 whose body cannot be let go", version: "0.1.0", stuck: true, answer: { ok: true, started: true, from: "0.1.0", to: "0.2.0" }, sent: [post], audit: [SET, started] },
    { name: "the provider refuses", version: "0.1.0", status: 404, answer: { ok: false, code: "update_refused", about: "404" }, sent: [post], audit: [SET], noted: `${ANSWERED} 404` },
    { name: "the provider redirects, and is not followed", version: "0.1.0", status: 302, answer: { ok: false, code: "update_refused", about: "302" }, sent: [post], audit: [SET], noted: `${ANSWERED} 302` },
    { name: "the provider never answers", version: "0.1.0", silent: true, answer: { ok: false, code: "update_unreachable" }, sent: [post], audit: [SET], noted: NO_ANSWER },
    { name: "the provider cannot be reached", version: "0.1.0", down: true, answer: { ok: false, code: "update_unreachable" }, sent: [post], audit: [SET], noted: NO_ANSWER },
  ])("$name", async ({ version, anyway, status, silent, down, stuck, answer, sent, audit, noted }) => {
    const rebuilding = provider(async (address) => {
      if (silent === true) return new Promise<Response>(() => undefined);

      if (stuck === true) return new Response(new ReadableStream({ cancel: () => Promise.reject(new Error("the body is stuck")) }));

      if (down === true) throw new Error(`no route to ${address}`);

      return new Response(null, { status: status ?? 200, headers: { Location: "https://example.com/elsewhere" } });
    });
    const world = await ready(rebuilding);

    expect<unknown>({ answer: await startUpdate(world.install, ADMIN, { version, anyway }, rebuilding), sent: rebuilding.sent, audit: await entries(world) }).toEqual({ answer, sent, audit });
    expect((await world.install.database.listProblems(dayOf(NOW))).map(({ kind, count, message }) => [kind, count, message])).toEqual(noted === undefined ? [] : [["update_failed", 1, noted]]);
  });

  test("with no address saved nothing is sent", async () => {
    const rebuilding = provider();
    const world = await makeWorld();

    expect({ answer: await startUpdate(world.install, ADMIN, { version: "0.1.0", anyway: true }, rebuilding), sent: rebuilding.sent }).toEqual({
      answer: { ok: false, code: "no_update_address" },
      sent: [],
    });
  });

  // Drift: a stored value is checked again when it is used, so a row changed behind the action, or a provider whose form changed, sends nothing.
  test("a saved address the provider no longer takes is not sent to", async () => {
    const rebuilding = provider();
    const world = await ready(rebuilding);
    await world.install.database.keepUpdateAddress("https://example.com/hooks/3f9c2a7e5b", { by: ADMIN.holder, at: NOW });

    expect({ answer: await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding), sent: rebuilding.sent }).toEqual({
      answer: { ok: false, code: "no_update_address" },
      sent: [],
    });
  });

  // Drift: a double press or a script would queue builds at the provider. One start fits a minute, whoever asks and whatever came of the first.
  test.each([
    { name: "after a start", status: 200 },
    { name: "after a refusal", status: 500 },
  ])("a second press inside the minute sends nothing: $name", async ({ status }) => {
    const rebuilding = provider(async () => new Response(null, { status }));
    const world = await ready(rebuilding);
    await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding);
    world.clock.now = NOW + 30_000;
    const second = await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding);
    world.clock.now = NOW + 60_000 - (NOW % 60_000);
    const later = await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding);

    expect({ second, later: later.ok || later.code, sent: rebuilding.sent.length }).toEqual({
      second: { ok: false, code: "too_many_requests", about: "update" },
      later: status === 200 ? true : "update_refused",
      sent: 2,
    });
  });
});

/** What a host that replaces the install's own code answers, step by step: `ready` and `put` are a refusal's code and what it is about, or nothing for a step that works. */
interface Door {
  readonly version?: string;
  readonly ready?: readonly [string, string?];
  readonly put?: readonly [string, string?];
  readonly unset?: string;
}

/** A host that takes a release by itself: it records what it was asked for, and what the log held at the moment the files were put in place. */
function host(world: () => World, door: Door): Rebuilding & { readonly sent: unknown[][]; readonly asked: unknown[]; readonly logged: unknown[] } {
  const asked: unknown[] = [];
  const logged: unknown[] = [];
  const refusal = ([code, about]: readonly [string, string?]): never => ({ ok: false, code, ...(about === undefined ? {} : { about }) }) as never;
  const self: SelfUpdate = {
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

  return { ...provider(), self, asked, logged };
}

describe("startUpdate, on a host that replaces the install's own code", () => {
  const started = { by: ADMIN.holder, action: "update_started", site: null, detail: { from: "0.1.0", to: "0.2.0" } };
  const done = { ok: true, started: true, from: "0.1.0", to: "0.2.0" };
  const refused = "the update was refused:";

  // Drift: the request after the upload runs the new code, so the log entry must be there when the files are put in place, and a refusal must say why in words that hold nothing of the host's key.
  test.each<{ readonly name: string; readonly door: Door; readonly answer: unknown; readonly audit: unknown[]; readonly logged?: unknown[]; readonly noted?: string }>([
    { name: "the release is fetched, checked, and put in place", door: {}, answer: done, audit: [started], logged: [started] },
    { name: "nothing newer is out", door: { ready: ["no_update"] }, answer: { ok: false, code: "no_update" }, audit: [] },
    { name: "the host holds no key", door: { ready: ["no_key"] }, answer: { ok: false, code: "no_key" }, audit: [], noted: `${refused} no_key` },
    { name: "the host's key is refused", door: { ready: ["key_refused"] }, answer: { ok: false, code: "key_refused" }, audit: [], noted: `${refused} key_refused` },
    {
      name: "the host's key lacks the right",
      door: { ready: ["lacks_right", "Workers Scripts Write"] },
      answer: { ok: false, code: "lacks_right", about: "Workers Scripts Write" },
      audit: [],
      noted: `${refused} lacks_right, Workers Scripts Write`,
    },
    {
      name: "the fetched files are not the published ones",
      door: { ready: ["release_refused", "digest_differs"] },
      answer: { ok: false, code: "release_refused", about: "digest_differs" },
      audit: [],
      noted: `${refused} release_refused, digest_differs`,
    },
    {
      name: "the host refuses the new code",
      door: { put: ["version_refused", "code"] },
      answer: { ok: false, code: "version_refused", about: "code" },
      audit: [started],
      logged: [started],
      noted: `${refused} version_refused, code`,
    },
    {
      name: "the host does not answer the upload",
      door: { put: ["update_unreachable", "host"] },
      answer: { ok: false, code: "update_unreachable", about: "host" },
      audit: [started],
      logged: [started],
      noted: `${refused} update_unreachable, host`,
    },
    { name: "the code is in and its schedule is not", door: { unset: "schedule" }, answer: done, audit: [started], logged: [started], noted: "the update is in, and its schedule could not be set" },
  ])("$name", async ({ door, answer, audit, logged, noted }) => {
    const world = await makeWorld();
    const rebuilding = host(() => world, door);

    expect<unknown>({ answer: await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding), audit: await entries(world), logged: rebuilding.logged }).toEqual({ answer, audit, logged: logged ?? [] });
    expect({ asked: rebuilding.asked, sent: rebuilding.sent }).toEqual({ asked: [{ version: "latest", automatic: false }], sent: [] });
    expect((await world.install.database.listProblems(dayOf(NOW))).map(({ kind, count, message }) => [kind, count, message])).toEqual(noted === undefined ? [] : [["update_failed", 1, noted]]);
  });

  // Drift: the saved address is the other way to update. An install whose host takes a release by itself never sends to it, and needs none.
  test("a saved address is not sent to, and only an admin starts", async () => {
    const world = await ready(provider());
    const rebuilding = host(() => world, {});
    const answers = [await startUpdate(world.install, OWNER, { version: "0.1.0" }, rebuilding), await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding)];

    expect<unknown>({ answers, asked: rebuilding.asked.length, sent: rebuilding.sent }).toEqual({ answers: [{ ok: false, code: "not_allowed" }, done], asked: 1, sent: [] });
  });

  // Drift: two presses, or a press beside the scheduled run, would each fetch and upload the release. One start fits a minute, and the second fetches nothing.
  test("a second press inside the minute fetches nothing", async () => {
    const world = await makeWorld();
    const rebuilding = host(() => world, {});
    await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding);
    world.clock.now = NOW + 30_000;

    expect<unknown>({ second: await startUpdate(world.install, ADMIN, { version: "0.1.0" }, rebuilding), asked: rebuilding.asked.length }).toEqual({
      second: { ok: false, code: "too_many_requests", about: "update" },
      asked: 1,
    });
  });
});
