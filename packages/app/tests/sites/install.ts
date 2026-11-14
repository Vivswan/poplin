// An install the serving tests ask requests of: a real database on bun's SQLite, a store in memory that records every key it is asked for, and sessions minted by the login code.

import { importSessionKey } from "@poplin/core/src/auth/cookie";
import { type Login, parseLogins } from "@poplin/core/src/auth/logins";
import type { Database, NewSite } from "@poplin/core/src/database/database";
import { openDatabase } from "@poplin/core/src/database/open";
import { parsePublicName, parseSiteName } from "@poplin/core/src/names/names";
import { applySuffix } from "@poplin/core/src/names/suffix";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { mintSiteFolder, type Site } from "@poplin/core/src/records/site";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { MemoryStore } from "@poplin/core/src/storage/memory";
import { type ObjectKey, parseObjectKey, type ReadOptions, type ReadResult } from "@poplin/core/src/storage/storage";
import { BunSqliteDriver } from "@poplin/core/tests/bun-sqlite-driver";
import { parseDomainLayout } from "../../src/cloudflare/layout";
import { mintSessionCookie, readSession } from "../../src/login/session";
import type { serveSite } from "../../src/sites/serve";

/** The moment every test request arrives at. */
export const NOW = 1_700_000_000_000;

/** The checked layout every serving test runs under: sites are `<label>-page.example.com`. */
const ZONE = zone();

/** The one login of a test install. */
const OWNER_EMAIL = "owner@example.com";

type Serving = Parameters<typeof serveSite>[1];

/** A file to publish: its body and the content type stored with it. */
type Files = Readonly<Record<string, readonly [body: string | Uint8Array, contentType: string]>>;

/** What a test site is made from; the name doubles as the public name of a public site. */
interface Draft {
  readonly name: string;
  readonly access: "private" | "unlisted" | "public";
  readonly files: Files;
  readonly search_engines?: boolean;
  readonly embeddable?: boolean;
  readonly expires?: "never" | number;
}

/** A test install. `keys` lists every key the store was asked for, and `bodies` every stream it handed out. */
export interface Install {
  readonly database: Database;
  readonly owner: Login;
  readonly keys: string[];
  readonly bodies: ReadableStream<Uint8Array>[];
  readonly serving: Serving;
  readonly ownerCookie: string;
  readonly setCookie: string;
  readonly publish: (draft: Draft) => Promise<Site>;
}

function keyOf(raw: string): ObjectKey {
  const parsed = parseObjectKey(raw);
  if (!parsed.ok) throw new Error(`the test's key was refused: ${parsed.refusal}`);

  return parsed.key;
}

function draftOf(draft: Draft): NewSite {
  const name = parseSiteName(draft.name);
  const publicName = parsePublicName(draft.name);
  if (!name.ok || !publicName.ok) throw new Error(`the test's site name was refused: ${draft.name}`);

  const shared = { name: name.value, folder: mintSiteFolder(), title: null, search_engines: draft.search_engines ?? false, embeddable: draft.embeddable ?? true, expires: draft.expires ?? "never" };
  if (draft.access === "public") return { ...shared, access: "public", public_name: publicName.value };

  return { ...shared, access: draft.access };
}

function zone(): Serving["zone"] {
  const layout = parseDomainLayout({ domain: "example.com", adminHostname: "admin.example.com", suffix: "-page" });
  if (!layout.ok) throw new Error(`the test's layout was refused: ${layout.refusal}`);

  return layout.value;
}

/** The hostname of a site's label address under `example.com`. */
export function labelHost(site: Site): string {
  return `${applySuffix(ZONE.suffix, siteLabel(site.name, site.id))}.${ZONE.domain}`;
}

/**
 * Open a fresh install with default settings and one login.
 *
 * @returns the install; `ownerCookie` is the `Cookie` header pair of a session the login code minted, and `setCookie` the whole `Set-Cookie` value it came from
 */
export async function openInstall(): Promise<Install> {
  const opened = await openDatabase(new BunSqliteDriver(), NOW);
  if (opened.kind !== "open") throw new Error(`the test's database did not open: ${opened.kind}`);

  const logins = parseLogins([OWNER_EMAIL]);
  if (!logins.ok) throw new Error(`the test's login was refused: ${logins.refusal}`);

  const [owner] = logins.value;
  if (owner === undefined) throw new Error("the test's logins are empty");

  const { database } = opened;
  const memory = new MemoryStore();
  const keys: string[] = [];
  const bodies: ReadableStream<Uint8Array>[] = [];
  const key = await importSessionKey(new Uint8Array(32).fill(7));
  const setCookie = await mintSessionCookie({ email: owner, key, now: NOW, domain: ZONE.domain });

  const store: Serving["store"] = {
    head: (objectKey) => {
      keys.push(objectKey);

      return memory.head(objectKey);
    },
    read: async (objectKey: ObjectKey, options?: ReadOptions): Promise<ReadResult> => {
      keys.push(objectKey);
      const result = await memory.read(objectKey, options);
      if (result.kind === "found") bodies.push(result.body);

      return result;
    },
  };

  const publish = async (draft: Draft): Promise<Site> => {
    const made = await database.createSite(draftOf(draft), { by: owner, at: NOW });
    if (made.kind !== "done") throw new Error(`the test's site was refused: ${made.kind}`);

    for (const [path, [body, contentType]] of Object.entries(draft.files)) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      await memory.write(keyOf(`${made.site.folder}/v${made.site.live_version}/${path}`), bytes, { contentType });
    }

    return made.site;
  };

  const serving: Serving = {
    database,
    store,
    settings: defaultSettings({ installer: owner, hostname: ZONE.adminHostname }),
    zone: ZONE,
    readSession: (headers) => readSession(headers, { key, logins: logins.value, now: NOW }),
    now: () => NOW,
  };

  return { database, owner, keys, bodies, serving, ownerCookie: setCookie.slice(0, setCookie.indexOf(";")), setCookie, publish };
}
