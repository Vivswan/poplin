// The caps of the test install run against a local fake, beside the files the install keeps: a cap too tight for a reset, or samples that grew past the room the caps leave, would show on the real install alone.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { buildDemo } from "../../packages/demo/scripts/build";
import { CEILINGS } from "../../packages/cloudflare/scripts/live/budget";
import { capInstall, LIVE_CAPS } from "../../packages/cloudflare/scripts/live/caps";
import { ROW_CEILINGS } from "../../packages/cloudflare/scripts/live/rows";
import { resetInstall } from "../../packages/cloudflare/scripts/live/reset";
import type { Login } from "../../packages/core/src/auth/logins";
import { defaultSettings, sizeBytes } from "../../packages/core/src/records/settings";
import { FAKE_NOW, openSqlInstall } from "./support/sql-install";

/** The repository's sample sites. */
const SAMPLES = join(import.meta.dir, "..", "..", "demo", "samples");

/** The most the sample sites and the demo hold together, every version a reset gives them: what the test install keeps between runs. */
const STANDING = { sites: 12, files: 120, bytes: 4_000_000 };

/** The most bucket writes and lists a reset with the real demo asks for when it keeps nothing: every site removed and published anew. It is under the ceiling by the room for requests that are asked twice. */
const USUAL_RESET = 135;

/** How long a test that builds the demo may take, in milliseconds: the build holds the dashboard's client, which is built first. */
const BUILD_MS = 60_000;

/** How many versions of a site an install keeps by default: the demo's site is published anew at every reset. */
const VERSIONS_KEPT = defaultSettings({ installer: "ada@example.com" as Login }).versions_kept;

/** One site the test install keeps, as the install weighs every version of it. */
interface Kept {
  readonly name: string;
  readonly files: number;
  readonly bytes: number;
  readonly versions: readonly unknown[];
}

/** A fake install. */
type Install = Awaited<ReturnType<typeof openSqlInstall>>;

/** Reset a fake install with the demo built from the repository. */
function reset(install: Install, token: string): ReturnType<typeof resetInstall> {
  return resetInstall({
    server: install.server,
    token,
    fetch: install.fetch,
    pause: async () => undefined,
    now: () => FAKE_NOW,
    sql: async (statement) => {
      await install.sql(statement);

      return undefined;
    },
    samples: SAMPLES,
    buildDemo: async (out) => {
      await buildDemo({ out });
    },
    ceiling: CEILINGS.reset,
    rowCeiling: ROW_CEILINGS.reset,
  });
}

/** Every site an install holds, the trash included. */
async function keptBy(install: Install): Promise<readonly Kept[]> {
  const token = await install.addToken("a reader");
  const lists = ["false", "true"].map(async (trash) => {
    const answer = await install.fetch(`${install.server}/api/sites?trash=${trash}&limit=100`, { headers: { Authorization: `Bearer ${token}` } });

    return ((await answer.json()) as { sites: readonly Kept[] }).sites;
  });

  return (await Promise.all(lists)).flat();
}

describe("the caps of the test install, against a local fake", () => {
  test("an install takes the caps, and a reset with the real demo fits under them: sites, files, kept versions, bucket writes and lists; the reset after it keeps the samples and the demo, and asks the bucket for nothing", async () => {
    const install = await openSqlInstall();
    const before = await install.settings();

    const capped = await capInstall({ server: install.server, token: await install.addToken("the caps"), fetch: install.fetch });
    const after = await install.settings();
    const first = await reset(install, await install.addToken("a reset"));
    const kept = await keptBy(install);
    const second = await reset(install, await install.addToken("the reset after it"));
    const total = { sites: kept.length, files: kept.reduce((sum, site) => sum + site.files, 0), bytes: kept.reduce((sum, site) => sum + site.bytes, 0) };

    expect<unknown>({ capped, after, first: "kind" in first ? first : first.demo, second: "kind" in second ? second : second.demo }).toEqual({ capped: undefined, after: { ...before, ...LIVE_CAPS }, first: "published", second: "kept" });
    expect({ sites: total.sites <= STANDING.sites, files: total.files <= STANDING.files, bytes: total.bytes <= STANDING.bytes }).toEqual({ sites: true, files: true, bytes: true });
    expect([STANDING.sites <= LIVE_CAPS.max_sites, STANDING.files <= LIVE_CAPS.max_files_per_day, STANDING.bytes * VERSIONS_KEPT < sizeBytes(LIVE_CAPS.max_total_size)]).toEqual([true, true, true]);
    expect(kept.filter((site) => site.files > LIVE_CAPS.max_files_per_publish || (site.bytes / site.versions.length) * VERSIONS_KEPT > sizeBytes(LIVE_CAPS.max_site_size))).toEqual([]);
    // A reset that keeps nothing removes each site first: one bucket list a site more than the first reset asked for.
    expect("kind" in first ? first : first.operations + kept.length <= USUAL_RESET).toBe(true);
    expect("kind" in second ? second : { kept: second.kept.length, operations: second.operations }).toEqual({ kept: kept.length - 1, operations: 0 });
  }, BUILD_MS);
});
