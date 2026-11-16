// A whole install for the action tests: the database on bun's SQLite, the in-memory store with faults a test can switch on, a clock, and three actors.

import { spyOn } from "bun:test";

import type { Login } from "../../../src/auth/logins";
import type { Actor } from "../../../src/auth/scopes";
import type { TokenId } from "../../../src/auth/tokens";
import { publishSite } from "../../../src/actions/publish";
import type { Install } from "../../../src/actions/records";
import { openDatabase } from "../../../src/database/open";
import { defaultSettings, type SettingValues } from "../../../src/records/settings";
import { MemoryStore } from "../../../src/storage/memory";
import { sha256Of } from "../../../src/storage/storage";
import { BunSqliteDriver } from "../../database/support/bun-sqlite-driver";

/** The moment a world's clock starts at. */
export const NOW = 1_700_000_000_000;

/** A day, in milliseconds. */
export const DAY = 86_400_000;

/** An admin, by the email of a login. */
export const ADMIN: Actor = { scope: "admin", holder: "ada@example.com" as Login };

/** The publisher most cases act as, by the id of its token. */
export const OWNER: Actor = { scope: "publisher", holder: "00000000000000aa" as TokenId };

/** Another publisher, who made nothing the first one did. */
export const STRANGER: Actor = { scope: "publisher", holder: "00000000000000bb" as TokenId };

/** The SHA-256 of the four bytes `page` in base64, as `openssl dgst -sha256 -binary | base64` gives it: the hash a fixture file that holds them declares. */
export const PAGE_SHA256 = "NmAxWprz3yVdjxmrB35Hl4IrQUiKDioEvGr3EhPCMnQ=";

/** What a test can break in the store. */
interface Faults {
  /** The write, counted from 1 over the store's life, that throws; none when absent. */
  failWrite?: number;

  /** Whether every removal throws, so no file can be removed. A listing still answers: finishing a publish reads one. */
  failRemoval?: boolean;
}

/** One install, with what a test reads back from it. */
export interface World {
  readonly install: Install;
  readonly faults: Faults;
  readonly clock: { now: number };
  readonly keys: () => Promise<string[]>;
  readonly audit: () => Promise<unknown[]>;
}

/** The SHA-256 a file that holds `text` declares. */
export function hashOf(text: string): Promise<string> {
  return sha256Of(new TextEncoder().encode(text));
}

/** One file of a publish. `declared` is the size it claims when that is not its real length. */
export function file(path: string, text: string, declared?: number): { path: string; size: number; contentType: string; open(): ReadableStream<Uint8Array> } {
  const bytes = new TextEncoder().encode(text);

  return { path, size: declared ?? bytes.length, contentType: "text/html", open: () => new Blob([bytes]).stream() };
}

/** A site's files: an `index.html` holding `text`, and a stylesheet in a folder. */
export function pages(text: string): ReturnType<typeof file>[] {
  return [file("index.html", text), file("css/site.css", "body{}")];
}

/** Make the store fail as `faults` says. Answers the store's own `list`. */
function breakStore(store: MemoryStore, faults: Faults): MemoryStore["list"] {
  const write = store.write.bind(store);
  const list = store.list.bind(store);
  let writes = 0;

  spyOn(store, "write").mockImplementation((...parameters) => {
    writes += 1;
    if (writes === faults.failWrite) return Promise.reject(new Error("the store is down"));

    return write(...parameters);
  });
  const deleteMany = store.deleteMany.bind(store);
  spyOn(store, "deleteMany").mockImplementation((keys) => {
    if (faults.failRemoval === true) return Promise.reject(new Error("the store is down"));

    return deleteMany(keys);
  });

  return list;
}

/** A fresh install with the default settings, `overrides` laid over them. */
export async function makeWorld(overrides: Partial<SettingValues> = {}): Promise<World> {
  const driver = new BunSqliteDriver();
  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the fixture database did not open: ${opened.kind}`);

  const settings = { ...defaultSettings({ installer: "ada@example.com" as Login }), ...overrides };
  await opened.database.initSettings(settings, { by: ADMIN.holder, at: NOW });

  const store = new MemoryStore();
  const faults: Faults = {};
  const list = breakStore(store, faults);
  const clock = { now: NOW };

  return {
    install: {
      database: opened.database,
      store,
      now: () => clock.now,
      addressOf: (label, access) => `https://${label}-${access === "private" ? "p" : "u"}-poplin.example.com`,
      publicAddressOf: (name) => `https://${name}-page.example.com`,
      reservedNames: new Set(["docs-p"]),
    },
    faults,
    clock,
    keys: async () => (await list({ prefix: "" })).objects.map((object) => object.key),
    // The first entry is the settings of the new install.
    audit: async () => (await driver.batch([{ sql: "SELECT action FROM audit WHERE seq > 1 ORDER BY seq", params: [] }]))[0]?.rows.map((row) => row.action) ?? [],
  };
}

/** Publish a new site and answer its id; the test fails here when the publish is refused. */
export async function made(world: World, actor: Actor, name: string, settings: object = {}): Promise<string> {
  const published = await publishSite(world.install, actor, { files: pages(`${name} v1`), name, ...settings });
  if (!published.ok) throw new Error(`the fixture site was refused: ${published.code}`);

  return published.site.id;
}
