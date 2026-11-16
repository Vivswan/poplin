// The removal of the files no record names runs against a local fake of the Cloudflare API over a real install: its database a real SQLite, its bucket the store the install writes to.
// A removal that took the folder of a site, of an upload on its way, or of a removed site the install still empties would show on the test install alone, as a site with no files.

import { afterEach, describe, expect, test } from "bun:test";

import { removeOrphans } from "../../packages/providers/cloudflare/scripts/live/orphans";
import { BUCKET, openRun } from "../../packages/providers/cloudflare/scripts/live/util";
import { withFake } from "../../packages/providers/cloudflare/tests/shared/install/support/fake-cloudflare";
import { type Asked, refusal, reply } from "../../packages/providers/cloudflare/tests/shared/install/support/replies";
import { parseObjectKey } from "../../packages/core/src/storage/storage";
import { liveAddresses } from "./addresses";
import { openBench } from "./bench";
import { FAKE_DOMAIN } from "./support/fake-install";
import { openSqlInstall } from "./support/sql-install";

/** The account of the fake Cloudflare, and the token a run calls it with. */
const [ACCOUNT, TOKEN] = ["0".repeat(32), "a-made-up-token"];

/** The install's zone, as a run found it. */
const ZONE = { id: "1".repeat(32), name: FAKE_DOMAIN, plan: "free", accountId: ACCOUNT } as const;

/** The id of the install's database at the fake Cloudflare. */
const DATABASE = "database-1";

/** Where the fake Cloudflare answers for the account's buckets. */
const BUCKETS = `/accounts/${ACCOUNT}/r2/buckets`;

/** Where it answers for the objects of the test install's bucket. */
const OBJECTS = `${BUCKETS}/${BUCKET}/objects`;

/** The folders no site was ever stored under, written by hand: two that no record names, one an upload on its way names, and one a removed site left to be emptied. */
const [ORPHAN, SECOND_ORPHAN, UPLOADING, LEFTOVER] = ["a".repeat(16), "b".repeat(16), "c".repeat(16), "d".repeat(16)];

/** A key that starts with no folder of a site. */
const STRAY = "notes/readme.txt";

/** The files under those folders, and that key. */
const HAND_MADE = [
  `${ORPHAN}/v1/index.html`,
  `${ORPHAN}/v2/index.html`,
  `${SECOND_ORPHAN}/v1/index.html`,
  `${SECOND_ORPHAN}/v1/site.css`,
  `${SECOND_ORPHAN}/v1/app.js`,
  `${UPLOADING}/v1/index.html`,
  `${LEFTOVER}/v1/index.html`,
  STRAY,
];

/** An upload that is on its way, and the folder of a removed site the install has not emptied yet. */
const RECORDS = [
  `INSERT INTO uploads (id, folder, number, owner, plan, manifest, bytes, files, created_at) VALUES ('upload-one', '${UPLOADING}', 1, 'ada@example.com', '{}', '{}', 1, 1, 1700000000000)`,
  `INSERT INTO leftovers (folder) VALUES ('${LEFTOVER}')`,
];

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** A fake install. */
type Install = Awaited<ReturnType<typeof openSqlInstall>>;

/** The fake account: the install, whether the account holds the test install's bucket, the price of the zone's plan, how many objects one list answers, whether the database answers, and the file whose delete fails. */
interface World {
  readonly install: Install;
  bucket: boolean;
  price: number;
  page: number;
  database: "answers" | "refuses" | "names nothing";
  failing?: string;
}

/** What one removal came to, and the lists and deletes it asked the fake for. */
interface Ran {
  readonly ended: Awaited<ReturnType<typeof removeOrphans>>;
  readonly calls: number;
}

/** Every key the bucket holds, in order. */
async function keysOf(install: Install): Promise<readonly string[]> {
  return (await install.store.list({ prefix: "" })).objects.map((object) => object.key);
}

/** One page of the bucket's objects, in the envelope of a list that goes on by a cursor: here the place of the next page's first object. */
async function listed(world: World, asked: Asked): Promise<Response> {
  const query = new URL(asked.path, "http://localhost").searchParams;
  const from = Number(query.get("cursor") ?? "0");
  const to = from + Math.min(world.page, Number(query.get("per_page")));
  const keys = await keysOf(world.install);
  const result = keys.slice(from, to).map((key) => ({ key }));

  return Response.json({ success: true, errors: [], messages: [], result, result_info: to < keys.length ? { cursor: String(to) } : {} });
}

/** Remove one object of the bucket, by its key as the path of a request names it; the delete of the failing file is answered as a fault of Cloudflare's. */
async function deleted(world: World, named: string): Promise<Response> {
  if (world.failing !== undefined && named.endsWith(world.failing)) return refusal(500, 10001, "Internal error");

  const key = parseObjectKey(decodeURIComponent(named));
  if (key.ok) await world.install.store.delete(key.key);

  return reply({});
}

/** Answer as the account's API: its zone's plan, its subscriptions, its buckets, the objects of the test install's bucket, and a query of the install's database. */
async function answer(world: World, asked: Asked): Promise<Response | undefined> {
  const [path = ""] = asked.path.split("?");
  if (path === `/zones/${ZONE.id}`) return reply({ id: ZONE.id, plan: { price: world.price } });

  if (path === `/accounts/${ACCOUNT}/subscriptions`) return reply([]);

  if (path === BUCKETS) return reply({ buckets: world.bucket ? [{ name: BUCKET }] : [] });

  if (path === OBJECTS) return listed(world, asked);

  if (path.startsWith(`${OBJECTS}/`) && asked.method === "DELETE") return deleted(world, path.slice(OBJECTS.length + 1));

  if (path !== `/accounts/${ACCOUNT}/d1/database/${DATABASE}/query` || world.database === "refuses") return refusal(403, 10000, "Authentication error");

  const { sql } = asked.body as { readonly sql: string };

  return reply([{ success: true, results: world.database === "answers" ? await world.install.sql(sql) : [] }]);
}

/** Store one file of a few bytes under a key written by hand. */
async function put(install: Install, raw: string): Promise<void> {
  const key = parseObjectKey(raw);
  if (!key.ok) throw new Error(`${raw} is no key: ${key.refusal}`);

  await install.store.write(key.key, new TextEncoder().encode("a file"), { contentType: "text/plain" });
}

/** A fake account whose install holds a site, a site in the trash, an upload on its way, and a removed site's folder, with two folders no record names beside them. */
async function filled(): Promise<World> {
  const install = await openSqlInstall();
  const addresses = liveAddresses({ kind: "domain", domain: FAKE_DOMAIN });
  const token = await install.addToken("a person's own");
  const { bench, close } = openBench({ addresses, token, run: "orphans", missing: {}, fetch: install.fetch, pause: async () => undefined, now: () => 0, say: () => undefined, manyFiles: 1, largeCopy: 1 });
  OPENED.push(close);

  await bench.publish({ access: "private", text: "<p>one</p>" });
  const trashed = await bench.publish({ access: "unlisted", text: "<p>two</p>" });
  expect((await bench.cli("delete", trashed.label)).code).toBe(0);

  for (const statement of RECORDS) await install.sql(statement);

  for (const key of HAND_MADE) await put(install, key);

  return { install, bucket: true, price: 0, page: 1000, database: "answers" };
}

/** Run one removal on the fake account, for an install on the zone, or for one without a domain. */
async function remove(world: World, ceiling: number, kind: "domain" | "account address" = "domain"): Promise<Ran> {
  let ran: Ran | undefined;

  await withFake(
    (asked) => answer(world, asked),
    async (connection, asked) => {
      const run = { ...openRun({ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }), connection: { ...connection, key: TOKEN } };
      const ended = await removeOrphans(run, kind === "domain" ? ZONE : undefined, { database: DATABASE, ceiling });
      ran = { ended, calls: asked.filter((one) => one.path.startsWith(OBJECTS)).length };
    },
  );
  if (ran === undefined) throw new Error("the removal did not run");

  return ran;
}

/** The keys under the folders no record names. */
function orphaned(keys: readonly string[]): readonly string[] {
  return keys.filter((key) => key.startsWith(`${ORPHAN}/`) || key.startsWith(`${SECOND_ORPHAN}/`));
}

afterEach(() => {
  for (const close of OPENED.splice(0)) close();
});

describe("the removal of the files no record names, against a local fake account", () => {
  test("the two folders no record names go; the files of a site, of a site in the trash, of an upload on its way, of a removed site's folder, and a key under no folder stay; a second run removes nothing", async () => {
    const world = await filled();
    const before = await keysOf(world.install);
    const sites = await world.install.sql("SELECT folder, trashed FROM sites ORDER BY trashed");
    const first = await remove(world, 300);
    const after = await keysOf(world.install);
    const second = await remove(world, 300);

    expect(sites.map((site) => [site.trashed, before.some((key) => key.startsWith(`${String(site.folder)}/`))])).toEqual([[0, true], [1, true]]);
    expect({ first, kept: after, second, held: await keysOf(world.install) }).toEqual({
      first: { ended: { folders: 2, objects: 5, left: { folders: 0, objects: 0 }, calls: 6 }, calls: 6 },
      kept: before.filter((key) => !orphaned([key]).includes(key)),
      second: { ended: { folders: 0, objects: 0, left: { folders: 0, objects: 0 }, calls: 1 }, calls: 1 },
      held: after,
    });
  });

  test("a run stops at its ceiling of lists and deletes with a folder half emptied and says what is left, and the next run goes on from there", async () => {
    const world = await filled();
    world.page = 4;
    const lists = Math.ceil((await keysOf(world.install)).length / world.page);
    const first = await remove(world, lists + 3);
    const left = orphaned(await keysOf(world.install));
    const second = await remove(world, 300);

    expect({ first, left, second: second.ended, held: orphaned(await keysOf(world.install)) }).toEqual({
      first: { ended: { folders: 1, objects: 3, left: { folders: 1, objects: 2 }, calls: lists + 3 }, calls: lists + 3 },
      left: [`${SECOND_ORPHAN}/v1/index.html`, `${SECOND_ORPHAN}/v1/site.css`],
      second: { folders: 1, objects: 2, left: { folders: 0, objects: 0 }, calls: Math.ceil((HAND_MADE.length - 3 + 2) / world.page) + 2 },
      held: [],
    });
  });

  test("on the account of an install without a domain no zone's plan is read, and the folders no record names go the same", async () => {
    const world = Object.assign(await filled(), { price: 20 });
    const { ended } = await remove(world, 300, "account address");

    expect({ ended, held: orphaned(await keysOf(world.install)) }).toEqual({ ended: { folders: 2, objects: 5, left: { folders: 0, objects: 0 }, calls: 6 }, held: [] });
  });

  test("a delete Cloudflare fails is sent once, ends the removal, and leaves the tally of what went before it", async () => {
    const world = Object.assign(await filled(), { failing: "site.css" });
    const { ended, calls } = await remove(world, 300);

    expect({ ended, calls, held: orphaned(await keysOf(world.install)) }).toEqual({
      ended: { folders: 1, objects: 4, left: { folders: 1, objects: 1 }, calls: 6, stopped: { kind: "failed", what: "Cloudflare refused with status 500 and codes 10001" } },
      calls: 6,
      held: [`${SECOND_ORPHAN}/v1/site.css`],
    });
  });

  test.each([
    ["a listing of the bucket that does not end inside the ceiling", (world: World) => Object.assign(world, { page: 1 }), 3, { kind: "failed", what: "the listing of the bucket did not end within the ceiling of 3 lists and deletes" }, 3],
    ["an account without the test install's bucket", (world: World) => Object.assign(world, { bucket: false }), 300, { kind: "failed", what: "the account holds no bucket of the test install, so nothing in it is removed" }, 0],
    ["a zone on a plan with a price", (world: World) => Object.assign(world, { price: 20 }), 300, { kind: "failed", what: "the zone's plan has a price, so it is not the Free plan" }, 0],
    ["a database that names no folder", (world: World) => Object.assign(world, { database: "names nothing" }), 300, { kind: "failed", what: "the database names no folder, so no file is removed" }, 1],
    ["a database the token may not read", (world: World) => Object.assign(world, { database: "refuses" }), 300, { kind: "skipped", needs: "the token permission D1: Edit" }, 1],
  ] as const)("%s removes no file", async (_what, change, ceiling, stop, calls) => {
    const world = change(await filled());
    const before = await keysOf(world.install);

    expect({ ...(await remove(world, ceiling)), held: await keysOf(world.install) }).toEqual({ ended: stop, calls, held: before });
  });
});
