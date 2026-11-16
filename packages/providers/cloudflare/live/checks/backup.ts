// The backup drill on a deployed install: a few sites of the check's own are exported, removed for good, put back from their backups, and exported again, and each pair of backups is compared.
//
//   3 sites, 5 versions, 5 files     publish x5, rollback, rename
//   export x3 -> remove x3 for good -> import x3 -> export x3 -> compare x3 -> one visit -> remove x3 for good
//
// The sites of the install that are not the check's own are never read or changed: each export and each import names one of its sites.

import { expect } from "bun:test";

import { type Compared, compareBackups, differenceLines, IGNORED } from "../compare-backups";
import type { Bench, Check, LiveSite } from "../records";
import { failureOf, siteOf } from "../util";

/** What one drill asks of the install when no request is sent again: every request it sends, and how many of them make the install write to its bucket or list it. */
export const DRILL_COST = { requests: 72, bucket: 34 } as const;

/** Make the drill's sites: a private one with three versions that serves its second, an unlisted one under a new name, and a public one. */
async function makeSites(bench: Bench, made: LiveSite[]): Promise<void> {
  const kept = await bench.publish({ access: "private", text: "<p>drill, version one</p>" });
  made.push(kept);
  for (const text of ["<p>drill, version two</p>", "<p>drill, version three</p>"]) siteOf(await bench.cli("publish", bench.folder(text), "--site", kept.id));
  siteOf(await bench.cli("rollback", kept.id));

  const shared = await bench.publish({ access: "unlisted", text: "<p>drill, unlisted</p>" });
  made.push(shared);
  siteOf(await bench.cli("set", shared.id, "--name", `${shared.name}-renamed`));

  made.push(await bench.publish({ access: "public", text: "<p>drill, public</p>" }));
}

/** Export each site with every version it keeps, into a zip of its own; answers the zips in the sites' order. */
async function exportEach(bench: Bench, sites: readonly LiveSite[], round: string): Promise<string[]> {
  const zips: string[] = [];

  for (const site of sites) {
    const zip = bench.scratchFile(`drill-${round}-${site.id}.zip`);
    expect((await bench.cli("export", site.id, "--all-versions", "--out", zip)).code).toBe(0);
    zips.push(zip);
  }

  return zips;
}

/** Remove a site for good, with every file of it. */
async function removeForGood(bench: Bench, site: LiveSite): Promise<void> {
  expect((await bench.mcp("delete_site", { site: site.id, no_trash: true })).left).toEqual([]);
}

/** Remove every site the drill made; answers how many removals failed. After a failed drill a site may be gone already, and its removal then fails too. */
async function cleanUp(bench: Bench, made: readonly LiveSite[]): Promise<number> {
  let failed = 0;

  for (const site of made) {
    await removeForGood(bench, site).catch(() => {
      failed += 1;
    });
  }

  return failed;
}

/** What comparing each site's backup with the one exported after its restore came to. It throws at the first step that goes wrong. */
async function restoreAndCompare(bench: Bench, made: readonly LiveSite[]): Promise<Compared[]> {
  const first = await exportEach(bench, made, "first");

  for (const site of made) await removeForGood(bench, site);
  for (const site of made) expect((await bench.cli("show", site.id)).code).not.toBe(0);

  for (const zip of first) {
    // The counts, and of each site that failed its problem's code and the last status: the answer's other keys hold the zip's path and the site's label, which a failure would print.
    const ran = await bench.cli("import", zip);
    const { imported, skipped, failed, sites } = ran.value;
    const met = (Array.isArray(sites) ? sites : []).filter((site) => site?.result === "failed").map((site) => failureOf(site, ran.refused));
    expect({ imported, skipped, failed, met }).toEqual({ imported: 1, skipped: 0, failed: 0, met: [] });
  }

  const second = await exportEach(bench, made, "second");

  const compared: Compared[] = [];
  for (const [at, zip] of first.entries()) compared.push(await compareBackups(zip, second[at] ?? ""));
  expect(compared.flatMap(differenceLines)).toEqual([]);

  // The backups agree on what the install stores; one visit shows that the files they name are served again.
  const opened = await bench.visit(made[1]?.url ?? "");
  expect([opened.status, await opened.text()]).toEqual([200, "<p>drill, unlisted</p>"]);

  return compared;
}

/** What a drill that passed met: how much the backups hold together, and what the compare passed over. It holds no name and no address. */
function evidence(compared: readonly Compared[]): string {
  const sum = (count: "sites" | "files" | "bytes"): number => compared.reduce((total, one) => total + one[count], 0);
  const ignored = IGNORED.map(({ entry, field }) => `${field} of ${entry}`).join(", ");

  return `${sum("sites")} sites, ${sum("files")} files, ${sum("bytes")} bytes put back and exported the same; passed over ${ignored}`;
}

/** The one check of the drill. */
export const BACKUP_CHECKS: readonly Check[] = [
  {
    id: "backup-drill",
    name: "sites put back from their backups export the same backups again",
    needs: ["token"],
    run: async (bench) => {
      const started = bench.now();
      const made: LiveSite[] = [];
      let compared: Compared[];

      try {
        await makeSites(bench, made);
        compared = await restoreAndCompare(bench, made);
      } catch (error) {
        await cleanUp(bench, made);

        throw error;
      }

      // A drill that passed left every site it made on the install, so a removal that fails here leaves one behind.
      const kept = await cleanUp(bench, made);
      if (kept > 0) throw new Error(`the drill could not remove ${kept} of its ${made.length} sites`);

      bench.say(`backup-drill: ${evidence(compared)}; ${bench.now() - started} ms`);
    },
  },
];
