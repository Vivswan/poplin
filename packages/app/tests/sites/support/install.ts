// An install the serving tests ask requests of: a real database on bun's SQLite, a store in memory that records every key it is asked for, and a login that takes a test header as its proof.
// A key is recorded once for every request the store's contract says a call costs: twice for a read of a range that selects no byte of the object.

import { signedBy } from "@poplin/core/src/actions/access/reach";
import { type Login, parseLogins } from "@poplin/core/src/auth/logins";
import type { Database, NewSite } from "@poplin/core/src/database/database";
import { openDatabase } from "@poplin/core/src/database/open";
import type { AccessLetter } from "@poplin/core/src/names/marker";
import { parsePublicName, parseSiteName } from "@poplin/core/src/names/names";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { mintSiteFolder, type Site } from "@poplin/core/src/records/site";
import { contentsOf } from "@poplin/core/src/records/version-contents";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { MemoryStore } from "@poplin/core/src/storage/memory";
import { type HeadResult, type ObjectKey, parseObjectKey, type ReadOptions, type ReadResult, resolveRange } from "@poplin/core/src/storage/storage";
import { BunSqliteDriver } from "@poplin/core/tests/database/support/bun-sqlite-driver";
import { publishedSite } from "@poplin/core/tests/database/support/database-fixtures";
import type { SiteAddresses } from "../../../src/sites/addresses";
import type { serveSite } from "../../../src/sites/serve";
import { ADDRESSES } from "./layout";

/** The moment every test request arrives at. */
export const NOW = 1_700_000_000_000;

/** The one login of a test install. */
const OWNER_EMAIL = "owner@example.com";

/** The header the test install's login reads as its proof: it vouches for the email the header holds. */
const PROOF_HEADER = "X-Test-Login";

/** What every address a layout writes starts with. */
const SCHEME = "https://";

/** The letter `letterFormOf` writes, as it stands before the marker of a hostname: taken out, the address carries no letter. */
const OPEN_LETTER = /-u(?=-[a-z]+\.example\.com$)/;

type Serving = Parameters<typeof serveSite>[1];

/** The type a file is written to the memory store with: the store refuses some of the types a test serves, which another store may still hold. */
const WRITTEN_TYPE = "application/octet-stream";

/** A file to publish: its body and the content type the store answers for it. */
type Files = Readonly<Record<string, readonly [body: string | Uint8Array, contentType: string]>>;

/** What a test site is made from; the name doubles as the public name of a public site. `by` publishes it, the owner when left out. `unlisted_files` stores the site as one made from no list of files, so nothing is known of what its version holds. */
interface Draft {
  readonly name: string;
  readonly access: "private" | "unlisted" | "public";
  readonly files: Files;
  readonly search_engines?: boolean;
  readonly embeddable?: boolean;
  readonly expires?: "never" | number;
  readonly unlisted_files?: boolean;
  readonly by?: Site["owner"];
}

/** A test install. `keys` lists every key the store was asked for, and `bodies` every stream it handed out. */
export interface Install {
  readonly database: Database;
  readonly owner: Login;
  readonly keys: string[];
  readonly bodies: ReadableStream<Uint8Array>[];
  readonly serving: Serving;
  readonly ownerProof: Readonly<Record<string, string>>;
  readonly publish: (draft: Draft) => Promise<Site>;
}

function keyOf(raw: string): ObjectKey {
  const parsed = parseObjectKey(raw);
  if (!parsed.ok) throw new Error(`the test's key was refused: ${parsed.refusal}`);

  return parsed.key;
}

function draftOf(draft: Draft, addresses: SiteAddresses): NewSite {
  const name = parseSiteName(draft.name);
  if (!name.ok) throw new Error(`the test's site name was refused: ${draft.name}`);

  const shared = { name: name.value, folder: mintSiteFolder(), title: null, search_engines: draft.search_engines ?? false, embeddable: draft.embeddable ?? true, expires: draft.expires ?? "never", bytes: 0, files: 0 };
  if (draft.access !== "public") return { ...shared, access: draft.access };

  const publicName = parsePublicName(draft.name, addresses.reservedNames);
  if (!publicName.ok) throw new Error(`the test's public name was refused: ${draft.name}`);

  return { ...shared, access: "public", public_name: publicName.value };
}

/** The hostname of a site's label address under `example.com`. */
export function labelHost(site: Site): string {
  return new URL(ADDRESSES.addressOf(siteLabel(site.name, site.id), site.access)).hostname;
}

/**
 * Write a label address as a visitor may type it under any layout, without its scheme and with nothing after what names the site: a hostname, or a hostname and a first segment.
 *
 * @param typed - the id, and the name before it when one is typed; neither is checked
 */
export function typedAt(addresses: SiteAddresses, typed: { readonly id: string; readonly name?: string }, letter: AccessLetter): string {
  return addresses.letterFormOf(typed as Parameters<SiteAddresses["letterFormOf"]>[0], letter).slice(SCHEME.length);
}

/**
 * Write the public address of a name under any layout, as `typedAt` writes a label address.
 *
 * @param name - the public name as typed; it is not checked
 */
export function publicAt(addresses: SiteAddresses, name: string): string {
  const address = addresses.publicAddressOf(name as Parameters<SiteAddresses["publicAddressOf"]>[0]).slice(SCHEME.length);

  return address.endsWith("/") ? address.slice(0, -1) : address;
}

/**
 * Write the hostname of a label address as a visitor may type it.
 *
 * @param typed - the id, and the name before it when one is typed; neither is checked
 * @param letter - the letter before the marker; `undefined` writes the address with none
 */
export function typedHost(typed: { readonly id: string; readonly name?: string }, letter: AccessLetter | undefined): string {
  const host = typedAt(ADDRESSES, typed, letter ?? "u");

  return letter === undefined ? host.replace(OPEN_LETTER, "") : host;
}

/**
 * Open a fresh install with default settings and one login.
 *
 * @param addresses - the layout the sites answer under; the hostname layout when left out
 * @returns the install; `ownerProof` is the header a request of the owner carries, and a request without it is from nobody
 */
export async function openInstall(addresses: SiteAddresses = ADDRESSES): Promise<Install> {
  const opened = await openDatabase(new BunSqliteDriver(), NOW);
  if (opened.kind !== "open") throw new Error(`the test's database did not open: ${opened.kind}`);

  const users = parseLogins([OWNER_EMAIL]);
  if (!users.ok) throw new Error(`the test's login was refused: ${users.refusal}`);

  const [owner] = users.value;
  if (owner === undefined) throw new Error("the test's users are empty");

  const { database } = opened;
  const memory = new MemoryStore();
  const keys: string[] = [];
  const bodies: ReadableStream<Uint8Array>[] = [];

  const types = new Map<ObjectKey, string>();

  // An object is answered with the type its draft names, whatever the memory store was able to keep.
  const typed = <Result extends HeadResult | ReadResult>(result: Result): Result => {
    if (!("info" in result)) return result;

    return { ...result, info: { ...result.info, contentType: types.get(result.info.key) ?? result.info.contentType } };
  };

  const store: Serving["store"] = {
    head: async (objectKey) => {
      keys.push(objectKey);

      return typed(await memory.head(objectKey));
    },
    read: async (objectKey: ObjectKey, options?: ReadOptions): Promise<ReadResult> => {
      keys.push(objectKey);
      const result = typed(await memory.read(objectKey, options));
      if (result.kind === "found") bodies.push(result.body);

      if (options?.range !== undefined && "info" in result && resolveRange(options.range, result.info.size) === "unsatisfiable") keys.push(objectKey);

      return result;
    },
  };

  const publish = async (draft: Draft): Promise<Site> => {
    const contents = draft.unlisted_files === true ? undefined : contentsOf(Object.keys(draft.files));
    const made = await publishedSite(database, draftOf(draft, addresses), signedBy({ holder: draft.by ?? owner }, NOW), contents);
    if (made.kind !== "done") throw new Error(`the test's site was refused: ${made.kind}`);

    for (const [path, [body, contentType]] of Object.entries(draft.files)) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      const objectKey = keyOf(`${made.site.folder}/v${made.site.live_version}/${path}`);
      await memory.write(objectKey, bytes, { contentType: WRITTEN_TYPE });
      types.set(objectKey, contentType);
    }

    return made.site;
  };

  const serving: Serving = {
    database,
    store,
    settings: defaultSettings({ installer: owner }),
    addresses,
    identify: async (headers) => ({ ok: headers.get(PROOF_HEADER) === owner }),
    now: () => NOW,
  };

  return { database, owner, keys, bodies, serving, ownerProof: { [PROOF_HEADER]: owner }, publish };
}
