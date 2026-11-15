// The caps of the test install run against a local fake, beside the files the install keeps: a cap too tight for a reset, or samples that grew past the room the caps leave, would show on the real install alone.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFiles } from "../../packages/cli/src/files/read";
import { buildDemo } from "../../packages/demo/scripts/build";
import { CEILINGS } from "../../packages/cloudflare/scripts/live/budget";
import { capInstall, LIVE_CAPS } from "../../packages/cloudflare/scripts/live/caps";
import { resetInstall } from "../../packages/cloudflare/scripts/live/reset";
import type { Login } from "../../packages/core/src/auth/logins";
import { defaultSettings, sizeBytes } from "../../packages/core/src/records/settings";
import { openSqlInstall } from "./support/sql-install";

/** The repository's sample sites. */
const SAMPLES = join(import.meta.dir, "..", "..", "demo", "samples");

/** The most the samples and the demo hold together, one version of each: what the test install keeps between runs. */
const STANDING = { files: 40, bytes: 3_000_000 };

/** How many versions of a site an install keeps by default: the demo's site is published anew at every reset. */
const VERSIONS_KEPT = defaultSettings({ installer: "ada@example.com" as Login, hostname: "poplin.example.com" }).versions_kept;

/** One site the test install keeps, as its files weigh. */
interface Kept {
  readonly name: string;
  readonly files: number;
  readonly bytes: number;
}

/** What a publish of one folder would upload, as the CLI lists it. */
async function publishOf(name: string, folder: string): Promise<Kept> {
  const listed = await readFiles(folder);
  if (!listed.ok) throw new Error(`the folder of ${name} is nothing a publish takes`);

  return { name, files: listed.count, bytes: listed.bytes };
}

describe("the caps of the test install, against a local fake", () => {
  test("the samples and the demo, built from the repository, fit the room the caps count on, each site with every version it keeps", async () => {
    using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-live-caps-"));
    await buildDemo({ out: join(scratch.path, "demo") });
    const samples = readdirSync(SAMPLES, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const kept = [...(await Promise.all(samples.map((entry) => publishOf(entry.name, join(SAMPLES, entry.name))))), await publishOf("demo", join(scratch.path, "demo"))];
    const total = { files: kept.reduce((sum, site) => sum + site.files, 0), bytes: kept.reduce((sum, site) => sum + site.bytes, 0) };

    expect({ files: total.files <= STANDING.files, bytes: total.bytes <= STANDING.bytes }).toEqual({ files: true, bytes: true });
    expect(kept.filter((site) => site.files > LIVE_CAPS.max_files_per_publish || site.bytes * VERSIONS_KEPT > sizeBytes(LIVE_CAPS.max_site_size))).toEqual([]);
    expect(total.bytes * VERSIONS_KEPT).toBeLessThan(sizeBytes(LIVE_CAPS.max_total_size));
  });

  test("an install takes the caps and keeps every other setting, and a reset with the real demo still fits under them", async () => {
    const install = await openSqlInstall();
    const before = await install.settings();

    const capped = await capInstall({ server: install.server, token: await install.addToken("the caps"), fetch: install.fetch });
    const after = await install.settings();

    const ended = await resetInstall({
      server: install.server,
      token: await install.addToken("a reset"),
      fetch: install.fetch,
      pause: async () => undefined,
      sql: async (statement) => {
        await install.sql(statement);

        return undefined;
      },
      samples: SAMPLES,
      buildDemo: async (out) => {
        await buildDemo({ out });
      },
      ceiling: CEILINGS.reset,
    });

    expect<unknown>({ capped, after, ended: "kind" in ended ? ended : ended.demo }).toEqual({ capped: undefined, after: { ...before, ...LIVE_CAPS }, ended: "published" });
  });
});
