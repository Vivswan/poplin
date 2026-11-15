// The upgrade in place: what an install answered and served under the code that made it, and whether this code, opened over the same database and the same objects, answers and serves the same.

import type { SqlDriver } from "../../../packages/core/src/database/driver";
import { fault, field, type Machine, type Ran, runCli } from "./command";
import { attempt, differences, type Finding, found, type Shape } from "./findings";
import type { Seeded } from "./seeded-install";
import { openInstall, type Running, storeOf } from "./this-install";
import { HERE, type Tree } from "./trees";
import { listen } from "./util";
import { walk } from "./walk";

/** The reads an upgrade must leave as they were, each with the shape its answer shows. The first sites of the first one are shown too. */
const READS: readonly (readonly [shape: Shape, line: readonly string[]])[] = [
  ["database", ["list"]],
  ["database", ["list", "--trash"]],
  ["settings", ["config"]],
  ["update notice", ["whoami"]],
  ["update notice", ["update", "--check"]],
];

/** The shapes that are read through an opened database, and so not at all when this code refuses it. */
const BEHIND_THE_DATABASE: readonly Shape[] = ["settings", "storage", "update notice"];

/** The shapes that are read through the queries, and so not at all over a schema the queries were not written for. */
const BEHIND_THE_SCHEMA: readonly Shape[] = ["storage", "update notice"];

/** Every table of a database. */
const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";

/** Everything a database's schema holds, as SQLite keeps the text of it. */
const SCHEMA = "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name";

/** How many of an object key's first segments name where a site's version is kept; the rest is the file's path in its site. */
const PLACE_SEGMENTS = 2;

/** The most sites shown one by one: a listing already holds every site whole. */
const MOST_SHOWN = 2;

/** What one address of a site answered. */
interface Page {
  /** The first label of the site's hostname. */
  readonly hostLabel: string;

  /** The path asked at that hostname. */
  readonly path: string;

  /** The status of the answer. */
  readonly status: number;

  /** Its `Content-Type`. */
  readonly contentType: string | null;

  /** Its body. */
  readonly bytes: Uint8Array;
}

/** What an install held and answered under the code that made it. */
export interface Before {
  /** The answer to each read, with the shape it shows. */
  readonly reads: readonly { readonly shape: Shape; readonly ran: Ran }[];

  /** What every site served at its addresses, at every path a file is stored under. */
  readonly pages: readonly Page[];

  /** The rows of each table. */
  readonly rows: ReadonlyMap<string, number>;
}

/** The install being upgraded. */
interface Upgrading {
  /** The tree whose code made it. */
  readonly from: Tree;

  /** The install itself. */
  readonly seeded: Seeded;

  /** The machine that asks it, at the address it answers at under the code that made it. */
  readonly machine: Machine & { readonly login: { readonly server: string } };

  /** The folder of a small site to publish. */
  readonly folder: string;
}

async function ask(seeded: Seeded, address: string): Promise<Omit<Page, "hostLabel" | "path">> {
  const answered = await seeded.fetch(new Request(address));

  return { status: answered.status, contentType: answered.headers.get("Content-Type"), bytes: new Uint8Array(await answered.arrayBuffer()) };
}

/** The first label of the hostname an address stands for: its last path segment, as a tree's preview writes a site's address. */
function hostLabelOf(address: string): string {
  const segments = new URL(address).pathname.split("/").filter((part) => part !== "");

  return segments.at(-1) ?? "";
}

/** Every path a file is stored under, whatever site and version holds it, as an address writes it. */
async function storedPaths(seeded: Seeded): Promise<string[]> {
  const paths = (await seeded.objects()).map(({ key }) => key.split("/").slice(PLACE_SEGMENTS).map(encodeURIComponent).join("/"));

  return [...new Set(paths.filter((path) => path !== ""))];
}

/**
 * Ask every address of the install for its first page and for every stored path.
 *
 * @throws {Error} no stored path is served at any address: the paths are not read off the keys the way that code keeps them
 */
async function pagesOf(seeded: Seeded, addresses: readonly string[]): Promise<Page[]> {
  const paths = ["", ...(await storedPaths(seeded))];
  const asked = addresses.flatMap((address) =>
    paths.map(async (path) => ({ hostLabel: hostLabelOf(address), path: `/${path}`, ...(await ask(seeded, `${address}${path}`)) })),
  );
  const pages = await Promise.all(asked);
  const served = pages.some((page) => page.path !== "/" && page.status === 200);
  if (!served) throw new Error("no site serves a stored file at its path: the check reads a file's path off its key, and that key is of another layout");

  return pages;
}

/** Every address the sites of some reads answer at. */
function addressesOf(reads: Before["reads"]): string[] {
  const sites = reads.flatMap(({ ran }): unknown[] => {
    const listed = field(ran.answer, "sites");

    return Array.isArray(listed) ? listed : [];
  });
  const named = sites.flatMap((site) => [field(site, "url"), ...Object.values(Object(field(site, "addresses")))]);

  return [...new Set(named.filter((address) => typeof address === "string"))];
}

async function rowsOf(driver: SqlDriver): Promise<ReadonlyMap<string, number>> {
  const [tables] = await driver.batch([{ sql: TABLES, params: [] }]);
  const names = (tables?.rows ?? []).map((row) => String(row.name));
  const counted = await driver.batch(names.map((name) => ({ sql: `SELECT count(*) AS held FROM "${name}"`, params: [] })));

  return new Map(names.map((name, at) => [name, Number(counted[at]?.rows[0]?.held)]));
}

/** Ask every read with one tree's command, then show each site of `sites`; left out, the first sites the first read lists. None changes the install, so those of a kind are asked together. */
async function readAll(cli: Tree, machine: Machine, sites?: readonly string[]): Promise<Before["reads"]> {
  const reads = await Promise.all(READS.map(async ([shape, line]) => ({ shape, ran: await runCli(cli, machine, line) })));

  const listed = field(reads[0]?.ran.answer, "sites");
  const ids = sites ?? (Array.isArray(listed) ? listed.slice(0, MOST_SHOWN).map((site) => String(field(site, "id"))) : []);
  const shown = await Promise.all(ids.map(async (id) => ({ shape: "database" as const, ran: await runCli(cli, machine, ["show", id]) })));

  return [...reads, ...shown];
}

/**
 * Record what an install answers, serves, and holds, asked by the command of the code that made it.
 *
 * @throws {Error} the install did not answer its own command's reads
 */
export async function capture(upgrading: Upgrading): Promise<Before> {
  const reads = await readAll(upgrading.from, upgrading.machine);
  const failed = reads.find(({ ran }) => ran.exit !== 0);
  if (failed !== undefined) throw new Error(`${upgrading.from.name} does not answer its own \`${failed.ran.line}\`: ${failed.ran.said}`);

  const pages = await pagesOf(upgrading.seeded, addressesOf(reads));

  return { reads, pages, rows: await rowsOf(upgrading.seeded.driver) };
}

/** Whether an upgraded database is the one a new install gets: the same tables, indexes, and triggers, in the same words. */
async function schemaFaults(running: Running, fresh: Running): Promise<string[]> {
  const [[upgraded], [made]] = await Promise.all([running.driver.batch([{ sql: SCHEMA, params: [] }]), fresh.driver.batch([{ sql: SCHEMA, params: [] }])]);
  const textOf = (rows: typeof upgraded): Map<string, unknown> =>
    new Map((rows?.rows ?? []).map((row) => [`${String(row.type)} ${String(row.name)}`, row.sql]));
  const [here, there] = [textOf(upgraded), textOf(made)];
  const names = [...new Set([...here.keys(), ...there.keys()])].filter((name) => here.get(name) !== there.get(name));

  return names.map((name) => `the upgraded database's ${name} is not the one a new install gets, so no step brought it there`);
}

async function rowFaults(running: Running, before: Before): Promise<string[]> {
  const after = await rowsOf(running.driver);
  const lost = [...before.rows].filter(([table, held]) => (after.get(table) ?? 0) < held);

  return lost.map(([table, held]) => `the table ${table} held ${held} rows and holds ${after.get(table) ?? "none: it is gone"}`);
}

async function pageFaults(running: Running, before: Before): Promise<string[]> {
  const faults: string[] = [];

  for (const page of before.pages) {
    const answered = await running.served(page.hostLabel, page.path);
    const bytes = new Uint8Array(await answered.arrayBuffer());
    const same = page.status !== 200 || (answered.headers.get("Content-Type") === page.contentType && Buffer.from(bytes).equals(page.bytes));
    if (answered.status !== page.status || !same)
      faults.push(`${page.hostLabel}${page.path} answered ${page.status} with ${page.bytes.length} bytes and answers ${answered.status} with ${bytes.length}`);
  }

  return faults;
}

/** The reads again, asked by this code's command of this code's install, each beside what it answered before. */
async function readFaults(upgrading: Upgrading, before: Before, machine: Machine): Promise<Finding[]> {
  const shown = before.reads.slice(READS.length).map(({ ran }) => ran.line.split(" ").at(-1) ?? "");
  const after = await readAll(HERE, machine, shown);

  return before.reads.flatMap(({ shape, ran }, at) => {
    const now = after[at]?.ran;
    if (now === undefined) return [];

    if (now.exit !== 0) return found(shape, [fault(now) ?? `\`${now.line}\` asks for an update of the command, which is this code's own`]);

    return found(shape, differences(ran.answer, now.answer, upgrading.machine.login.server, `\`${ran.line}\``));
  });
}

/** Whether this code holds the database as it holds one it made: the same schema, no row lost, and settings it reads. */
async function databaseFaults(running: Running, before: Before, fresh: Running): Promise<Finding[]> {
  return [
    ...(await attempt("database", "comparing the schema", () => schemaFaults(running, fresh))),
    ...(await attempt("database", "counting the rows", () => rowFaults(running, before))),
    ...(await attempt("settings", "reading the stored settings", async () =>
      (await running.install.database.readSettings()) === undefined ? ["the settings row is gone"] : [],
    )),
  ];
}

/**
 * Open this code over an install another tree's code made, and compare it with what that install was.
 *
 * @param site - a site of the install to take through every site action after the upgrade
 * @param fresh - a new install of this code, whose database the upgraded one must equal in schema
 * @returns the findings of the database, the settings, the storage, and the update notice; the last three say so when the database did not open
 */
export async function upgradeInPlace(upgrading: Upgrading, before: Before, site: string | undefined, fresh: Running): Promise<Finding[]> {
  const unread = (why: string, shapes: readonly Shape[]): Finding[] => shapes.flatMap((shape) => found(shape, [`not checked: ${why}`]));
  let opened: Awaited<ReturnType<typeof openInstall>>;

  try {
    opened = await openInstall(upgrading.seeded.driver, await storeOf(await upgrading.seeded.objects()));
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);

    return [
      ...found("database", [`this code failed on the database and the objects ${upgrading.from.name} left: ${said}`]),
      ...unread("this code did not open the database", BEHIND_THE_DATABASE),
    ];
  }

  if (!opened.ok)
    return [
      ...found("database", [`this code refuses the database ${upgrading.from.name} left: ${opened.why}`]),
      ...unread("this code did not open the database", BEHIND_THE_DATABASE),
    ];

  const { running } = opened;
  const held = await databaseFaults(running, before, fresh);
  if (held.length > 0) return [...held, ...unread("this code does not hold the database as it holds one it made", BEHIND_THE_SCHEMA)];

  const listening = listen(running.api);
  const machine = { home: upgrading.machine.home, login: { server: listening.origin, token: upgrading.seeded.token } };

  try {
    return [
      ...(await readFaults(upgrading, before, machine)),
      ...(await attempt("storage", "serving the sites", () => pageFaults(running, before))),
      ...(await attempt(
        "database",
        "walking a site",
        async () => (await walk({ cli: HERE, machine, folder: upgrading.folder, both: [HERE] }, "walk", site)).faults,
      )),
    ];
  } finally {
    await listening.stop();
  }
}
