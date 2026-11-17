// What an install reaches the world through, for a test: the fake Cloudflare account in memory, and a release published from the repository's own Worker configuration.
// No port is opened.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import type { Reach } from "@poplin/core/src/install/installer";
import { releaseDigest } from "@poplin/core/src/records/release";
import { bundleManifest, MAP_FILE, MODULE_FILE } from "../../../../src/shared/release/publish/bundle-manifest";
import { bundleAsset, MANIFEST_FILE } from "../../../../src/shared/release/publish/release-source";
import { type Account, answer, answerQuery } from "./fake-install";
import { type Asked, bodyOf } from "./replies";

/** Where the SDK sends a call when it is told no other place. */
const API = "https://api.cloudflare.com/client/v4";

/** The query route of a database, which the fake answers from the install's own store where a test gave it one. */
const QUERY_ROUTE = /\/d1\/database\/[^/]+\/query$/;

/** The version of the release the project's website names. */
export const RELEASE = "0.3.0";

/** The repository's own Worker configuration, which a release's manifest is written from. */
const CONFIG: unknown = Bun.JSONC.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "..", "..", "wrangler.jsonc"), "utf8"));

/** The built module and its map, as any bytes. */
const BUILT = { [MODULE_FILE]: new TextEncoder().encode("export default {};\n"), [MAP_FILE]: new TextEncoder().encode('{"version":3,"sources":[],"mappings":""}') };

/** What a test changes of the world an install meets. */
interface Meets {
  /** Answers a request to the project's website or the release's page in place of the published release; `undefined` leaves it to the release. */
  readonly website?: (address: string) => Response | undefined;

  /** The schema the release states, on the website and in its manifest; this code's own when left out. */
  readonly schema?: number;

  /** Older versions the website names beside the release, each with the schema it states. */
  readonly older?: Readonly<Record<string, number>>;
}

/** A stand-in world: the reach to hand a run, every call it sent to Cloudflare, every other address it asked, each wait it asked for, in milliseconds, none of which takes time, and the line of each wait that had one. */
interface World {
  readonly reach: Reach;
  readonly asked: Asked[];
  readonly fetched: string[];
  readonly slept: number[];
  readonly told: string[];
}

/** The files of the release, by the last part of the address each is fetched at. */
async function published(meets: Pick<Meets, "schema" | "older">): Promise<Readonly<Record<string, string | Uint8Array<ArrayBuffer>>>> {
  const schema = meets.schema ?? OWN_SCHEMA;
  const manifest = await bundleManifest({ version: RELEASE, schema, config: CONFIG, files: BUILT });
  const older = Object.entries(meets.older ?? {}).map(([version, stated]) => [version, { bundle: "0".repeat(64), schema: stated }]);
  const pins = { ...Object.fromEntries(older), [RELEASE]: { bundle: await releaseDigest(new TextEncoder().encode(manifest)), schema } };

  return {
    "releases.json": JSON.stringify(pins),
    [bundleAsset(RELEASE, MANIFEST_FILE)]: manifest,
    [bundleAsset(RELEASE, MODULE_FILE)]: BUILT[MODULE_FILE],
    [bundleAsset(RELEASE, MAP_FILE)]: BUILT[MAP_FILE],
  };
}

/**
 * Build the world of one test around an account.
 *
 * @param account - the account at the fake API, which every call reads and changes
 * @returns the reach, and what was asked through it
 */
export async function worldOf(account: Account, meets: Meets = {}): Promise<World> {
  const files = await published(meets);
  const asked: Asked[] = [];
  const fetched: string[] = [];
  const slept: number[] = [];

  const fetch: Reach["fetch"] = async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    // The SDK asks its `fetch` once what a form is sent as.
    if (address.startsWith("data:")) return new Response("");

    if (address.startsWith(API)) {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const entry = { method: request.method, path: `${url.pathname.slice(new URL(API).pathname.length)}${url.search}`, key: request.headers.get("authorization"), body: await bodyOf(request) };
      asked.push(entry);

      return account.store !== undefined && QUERY_ROUTE.test(url.pathname) ? answerQuery(account, entry) : answer(account, entry);
    }

    fetched.push(address);
    const file = files[address.slice(address.lastIndexOf("/") + 1)];

    return meets.website?.(address) ?? (file === undefined ? new Response("no such file", { status: 404 }) : new Response(file));
  };

  const told: string[] = [];
  const sleep: Reach["sleep"] = async (milliseconds, why) => {
    slept.push(milliseconds);
    if (why !== undefined) told.push(why);
  };

  return { asked, fetched, slept, told, reach: { fetch, now: () => 0, sleep } };
}
