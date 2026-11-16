// The backup drill on an install in memory: a varied install is exported, put back into an empty one, and exported again, and the two backups are compared.
// Without it a field that an import drops, or an export that writes the same sites in another order, is found on the day a backup is needed.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { answered, ORIGIN } from "../../../../app/tests/api/support/install";
import { readZip, writeZip, type ZipEntry } from "../../../../cli/tests/backup/support/zips";
import { type Bench, cleanUp, folderOf, jsonOf, openBench, published, scratch } from "../../../../cli/tests/commands/support/harness";
import { type Compared, compareBackups, differenceLines, IGNORED } from "../../live/compare-backups";

/** The repository's root. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/** The pages that say what the compare passes over, each in the table's own words: the one a person reads before a restore, and the one of the live checks. */
const PAGES = ["docs/upkeep/back-up.md", "packages/providers/cloudflare/live/README.md"] as const;

/** The export's two forms: every kept version, and the live one alone. */
const FORMS = ["--all-versions", ""] as const;

/** How many sites the seeded install holds, the one in the trash among them. */
const SEEDED = 6;

/** How long one drill may take, in milliseconds: some forty commands run in this process, all of it work of the processor, which on a busy machine passes the five seconds a test gets. */
const DRILL_MS = 30_000;

/** A zip's entries changed into another zip's, for a control. */
type Change = (entries: readonly ZipEntry[]) => ZipEntry[];

/**
 * Fill an install with one site of every kind a backup must carry, and settings that are not the defaults.
 *
 *   notes     private, three versions with nested files, rolled back to the second
 *   showcase  unlisted, not embeddable, published as `demo` and then renamed
 *   docs      public, with a typed title, listed by search engines
 *   link      unlisted, with a new link: the id it was published under is an earlier one
 *   brief     private, runs out after seven days
 *   old       in the trash
 */
async function seeded(bench: Bench): Promise<void> {
  const folder = folderOf("notes", { "index.html": "<title>Notes</title>", "css/site.css": "body{}", LICENSE: "free to read" });
  const notes = (jsonOf(await bench.run(`${folder} --json`)).site as { label: string }).label;

  for (const title of ["Second", "Third"]) {
    writeFileSync(join(folder, "index.html"), `<title>${title}</title>`);
    writeFileSync(join(folder, `${title.toLowerCase()}.txt`), title);
    await bench.run(`${folder} --site ${notes}`);
  }

  await bench.run(`rollback ${notes}`);
  await bench.run(`set ${await published(bench, "demo", { "index.html": "<title>Demo</title>" }, "--unlisted --embeddable off")} --name showcase`);
  await published(bench, "docs", { "index.html": "<title>Docs</title>" }, '--public --title "The docs" --search-engines on');
  await bench.run(`new-link ${await published(bench, "link", { "index.html": "<title>Link</title>" }, "--unlisted")}`);
  await published(bench, "brief", { "index.html": "<title>Brief</title>" }, "--expires 7d");
  await bench.run(`delete ${await published(bench, "old", { "index.html": "<title>Old</title>" })}`);

  await bench.run("config trash_days 9");
  await bench.run("config versions_kept 5");
  await bench.run("config logins ada@example.com,grace@example.com");
}

/** Export an install into a zip in a folder of its own; answers the zip's path. */
async function exportedZip(bench: Bench, form: string): Promise<string> {
  const zip = join(scratch(), "backup.zip");
  expect((await bench.run(`export ${form} --out ${zip}`)).code).toBe(0);

  return zip;
}

/** Seed an install, export it, put the backup into an empty install with its settings and logins, and export that one. */
async function drilled(form: string): Promise<{ readonly from: Bench; readonly into: Bench; readonly first: string; readonly second: string }> {
  const from = await openBench();
  const into = await openBench();
  await seeded(from);

  const first = await exportedZip(from, form);
  const ran = await into.run(`import ${first} --settings --logins`);
  expect([ran.code, ran.err, ran.out.at(-1)]).toEqual([0, [], `${SEEDED} imported, 0 skipped, 0 failed`]);

  return { from, into, first, second: await exportedZip(into, form) };
}

/** Write a copy of a zip with its entries changed. */
async function rewritten(zip: string, change: Change): Promise<string> {
  return writeZip(join(scratch(), "changed.zip"), change(await readZip(zip)));
}

/** A change that lays keys over the JSON of every entry a pattern names. */
function withKeys(name: RegExp, keys: Readonly<Record<string, unknown>>): Change {
  return (entries) => entries.map(([entry, content]) => (name.test(entry) ? [entry, JSON.stringify({ ...JSON.parse(content.toString()), ...keys })] : [entry, content]));
}

/** The differences with every site's id written as `<id>` and every hash as `<hash>`: both are made anew in every run. */
function lines(compared: Compared): string[] {
  return differenceLines(compared).map((line) => line.replaceAll(/--[0-9a-z]{12}\b/g, "--<id>").replaceAll(/sha256 [0-9a-f]{64}/g, "sha256 <hash>"));
}

afterEach(cleanUp);

describe("the backup drill", () => {
  test.each(FORMS)("an install put back from its backup exports the same backup again, with `%s`: without this a restore is trusted on no evidence", async (form) => {
    const { first, second } = await drilled(form);

    const compared = await compareBackups(first, second);

    expect(differenceLines(compared)).toEqual([]);
    expect({ same: compared.same, sites: compared.sites, files: compared.files }).toEqual({ same: true, sites: SEEDED, files: form === "" ? 9 : 17 });
  }, DRILL_MS);

  test("the seeded install holds every kind of site the drill names: without this a seed that lost a kind would leave the drill green on less", async () => {
    const { first } = await drilled("--all-versions");
    const entries = await readZip(first);
    const records = entries.filter(([name]) => name.endsWith("/site.json")).map(([, content]) => JSON.parse(content.toString()));
    const settings = JSON.parse((entries.find(([name]) => name === "settings.json")?.[1] ?? "{}").toString());

    expect(records.map((site) => [site.name, site.access, site.state, site.live_version, site.versions.length, site.expires === "never"]).sort()).toEqual([
      ["brief", "private", "live", 1, 1, false],
      ["docs", "public", "live", 1, 1, true],
      ["link", "unlisted", "live", 1, 1, true],
      ["notes", "private", "live", 2, 3, true],
      ["old", "private", "trash", 1, 1, true],
      ["showcase", "unlisted", "live", 1, 1, true],
    ]);
    expect([settings.trash_days, settings.versions_kept, settings.logins]).toEqual(["9", "5", "ada@example.com,grace@example.com"]);
  }, DRILL_MS);

  // Each control changes one thing the compare must not pass over; a compare that could not fail would make the drill above prove nothing.
  test.each<[string, Change, readonly string[]]>([
    [
      "one byte of one file",
      (entries) => entries.map(([name, content]): ZipEntry => (name.endsWith("/versions/3/files/LICENSE") ? [name, "free to reap"] : [name, content])),
      ["sites/notes--<id>/versions/3/files/LICENSE: 12 bytes, sha256 <hash> -> 12 bytes, sha256 <hash>"],
    ],
    ["one setting", withKeys(/^settings\.json$/, { trash_days: "8" }), ['settings.json: trash_days: "9" -> "8"']],
    ["one field of one site", withKeys(/showcase--\w+\/site\.json$/, { embeddable: true }), ["sites/showcase--<id>/site.json: embeddable: false -> true"]],
    [
      "who made it, which is not the moment it was made",
      withKeys(/^manifest\.json$/, { made_by: "another tool" }),
      [expect.stringMatching(/^manifest\.json: made_by: "poplin [^"]+" -> "another tool"$/) as unknown as string],
    ],
    [
      "the order of two sites",
      (entries) => [...entries.filter(([name]) => !name.startsWith("sites/docs--")), ...entries.filter(([name]) => name.startsWith("sites/docs--"))],
      [expect.stringMatching(/^the order of the entries, at place \d+: \S+ -> \S+$/) as unknown as string],
    ],
  ])("a second backup that differs in %s is reported with its place and both values: without this the compare could pass anything", async (_what, change, reported) => {
    const { first, second } = await drilled("--all-versions");

    const compared = await compareBackups(first, await rewritten(second, change));

    expect([compared.same, lines(compared)]).toEqual([false, [...reported]]);
  }, DRILL_MS);

  test("a site that is gone from the restored install is reported entry by entry, and so are the counts: without this a restore could lose a site unseen", async () => {
    const { into, first } = await drilled("");
    const docs = (jsonOf(await into.run("show docs --json")).site as { id: string }).id;
    expect((await into.install.routes.sites[":site"].$delete({ param: { site: docs }, query: { forever: "true" } })).status).toBe(200);

    const compared = await compareBackups(first, await exportedZip(into, ""));

    expect([compared.same, lines(compared)]).toEqual([
      false,
      [
        "sites/docs--<id>/site.json: held -> absent",
        "sites/docs--<id>/versions/1/files/index.html: held -> absent",
        "sites/docs--<id>/versions/1/files.json: held -> absent",
        "manifest.json: sites: 6 -> 5",
        "manifest.json: files: 9 -> 8",
        "manifest.json: bytes: 140 -> 121",
      ],
    ]);
  }, DRILL_MS);

  test("a setting changed on the restored install is reported: without this a restore could bring back other settings unseen", async () => {
    const { into, first } = await drilled("");
    await into.run("config trash_days 3");

    expect(lines(await compareBackups(first, await exportedZip(into, "")))).toEqual(['settings.json: trash_days: "9" -> "3"']);
  }, DRILL_MS);

  test("the moment a backup was made is passed over, and nothing else is: without this the table of what is passed over could grow unseen", async () => {
    const { first, second } = await drilled("");

    const compared = await compareBackups(first, await rewritten(second, withKeys(/^manifest\.json$/, { made_at: 1 })));

    expect([compared.same, compared.ignored]).toEqual([true, ["manifest.json: made_at"]]);
  }, DRILL_MS);

  test("a restore brings back no version the backup left out, no token, and no line of the activity log: without this the page's table of what stays behind is a guess", async () => {
    const { from, into } = await drilled("");

    const compared = await compareBackups(await exportedZip(from, "--all-versions"), await exportedZip(into, "--all-versions"));
    const places = [...new Set(lines(compared).map((line) => line.replace(/^(sites\/[^/]+\/(?:site\.json: versions|versions\/\d+)|manifest\.json: \w+).*$/, "$1")))];
    const refused = await into.run("list --json", { env: { POPLIN_SERVER: ORIGIN, POPLIN_TOKEN: from.install.tokens.admin } });
    const logged = (await answered(into.install.routes.audit.$get({ query: { limit: "100" } }))).body.entries as { action: string }[];

    expect(places).toEqual(["sites/notes--<id>/versions/1", "sites/notes--<id>/versions/3", "sites/notes--<id>/site.json: versions", "manifest.json: files", "manifest.json: bytes"]);
    expect([refused.code, (jsonOf(refused).error as { code: string }).code]).toEqual([1, "not_logged_in"]);
    expect([...new Set(logged.map((entry) => entry.action))].sort()).toEqual(["imported", "settings_changed", "settings_set", "token_added"]);
  }, DRILL_MS);

  test("each page names every value the compare passes over: without this a page and the drill part ways", () => {
    const unnamed = PAGES.flatMap((page) => IGNORED.filter(({ why }) => !readFileSync(join(ROOT, page), "utf8").includes(why)).map(({ field }) => `${page}: ${field}`));

    expect(unnamed).toEqual([]);
  });
});
