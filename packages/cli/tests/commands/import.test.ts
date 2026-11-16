import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type ApiInstall, answered, bytes } from "../../../app/tests/api/support/install";
import { backupEntries, readZip, writeZip, type ZipEntry } from "../backup/support/zips";
import { type Bench, cleanUp, folderOf, jsonOf, openBench, published, scratch } from "./support/harness";

/** A site as an install stores it, as far as these tests read it. */
interface Stored {
  readonly id: string;
  readonly name: string;
  readonly versions: readonly { readonly number: number }[];
}

/** One line of an import's `--json` answer. */
interface Line {
  readonly label: string;
  readonly result: string;
  readonly code?: string;
  readonly live_only?: boolean;
}

/** A JSON answer in the install's place. */
function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Publish a site through the API, with the content types the test names: what no file extension gives. */
async function publishedTyped(install: ApiInstall, name: string, files: readonly (readonly [path: string, text: string, type: string])[]): Promise<void> {
  const declared = files.map(([path, text, type]) => ({ path, size: text.length, content_type: type, sha256: createHash("sha256").update(text).digest("base64") }));
  const begun = await answered(install.routes.uploads.$post({ json: { name, files: declared } }));
  const upload = (begun.body.upload as { id: string }).id;
  for (const [path, text] of files) await install.routes.uploads[":upload"].file.$put({ param: { upload }, query: { path } }, bytes(text));

  expect((await install.routes.uploads[":upload"].finish.$post({ param: { upload } })).status).toBe(200);
}

/**
 * Fill an install with one site of every kind: private with two versions, unlisted, public, in the trash, and one whose files have types no extension gives.
 *
 * @returns the labels of the private and of the public site
 */
async function filled(bench: Bench): Promise<{ readonly notes: string; readonly docs: string }> {
  const folder = folderOf("notes", { "index.html": "<title>Notes</title>", "css/site.css": "body{}", LICENSE: "free to read" });
  const notes = (jsonOf(await bench.run(`${folder} --json`)).site as { label: string }).label;
  writeFileSync(join(folder, "index.html"), "<title>Second</title>");
  await bench.run(`${folder} --site ${notes}`);

  await published(bench, "demo", { "index.html": "<title>Demo</title>" }, "--unlisted --embeddable off");
  const docs = await published(bench, "docs", { "index.html": "<title>Docs</title>" }, '--public --title "The docs" --search-engines on');
  await bench.run(`delete ${await published(bench, "old", { "index.html": "<title>Old</title>" })}`);
  await publishedTyped(bench.install, "typed", [
    ["index.html", "<title>Typed</title>", "text/html"],
    ["feed", "<rss/>", "application/rss+xml; charset=utf-8"],
  ]);

  return { notes, docs };
}

/** Everything an install holds that a backup carries: every site as it is stored, and every file of every kept version with its content type and its text. */
async function held(install: ApiInstall): Promise<{ readonly sites: readonly Stored[]; readonly files: Readonly<Record<string, readonly [type: string | null, text: string]>> }> {
  const sites = (await answered(install.routes.export.sites.$get({ query: { all_versions: "true" } }))).body.sites as Stored[];
  const files: Record<string, readonly [string | null, string]> = {};

  for (const site of sites) {
    for (const { number: version } of site.versions) {
      const one = { param: { site: site.id }, query: { version: String(version) } };
      const listed = (await answered(install.routes.export.sites[":site"].files.$get(one))).body.files as { path: string }[];

      for (const { path } of listed) {
        const response = await install.routes.export.sites[":site"].file.$get({ param: one.param, query: { ...one.query, path } });
        files[`${site.name}/v${version}/${path}`] = [decodeURIComponent(response.headers.get("Poplin-Content-Type") ?? ""), await response.text()];
      }
    }
  }

  return { sites, files };
}

/** Export an install into a zip in a folder of its own; answers the zip's path. */
async function exportedZip(bench: Bench, flags = "--all-versions"): Promise<string> {
  const zip = join(scratch(), "backup.zip");
  expect((await bench.run(`export ${flags} --out ${zip}`)).code).toBe(0);

  return zip;
}

/** Write a copy of a zip with one entry's JSON changed. */
async function withEntry(zip: string, name: RegExp, change: (value: Record<string, unknown>) => unknown): Promise<string> {
  const entries = (await readZip(zip)).map(([entry, content]): ZipEntry => (name.test(entry) ? [entry, JSON.stringify(change(JSON.parse(content.toString())))] : [entry, content]));

  return writeZip(join(scratch(), "changed.zip"), entries);
}

function linesOf(ran: Record<string, unknown>): Record<string, string | undefined> {
  return Object.fromEntries((ran.sites as Line[]).map((site) => [site.label.split("--")[0], site.code ?? site.result]));
}

afterEach(cleanUp);

describe("import", () => {
  test("an install exported with every version comes back in a fresh install the same, field by field and byte by byte: without this a backup is a file nobody has ever restored", async () => {
    const from = await openBench();
    const into = await openBench();
    await filled(from);

    const zip = await exportedZip(from);
    const ran = await into.run(`import ${zip}`);

    expect([ran.code, ran.err, ran.out.at(-1)]).toEqual([0, [], "5 imported, 0 skipped, 0 failed"]);
    expect(ran.out.filter((line) => line.startsWith("imported")).map((line) => line.split("  ").slice(2).join(", ")).sort()).toEqual([
      "1 version, 1 file, 18 B",
      "1 version, 1 file, 19 B",
      "1 version, 1 file, 19 B",
      "1 version, 2 files, 26 B",
      "2 versions, 6 files, 77 B",
    ]);
    expect(await held(into.install)).toEqual(await held(from.install));
    expect(Object.values((await held(into.install)).files).map(([type]) => type)).toContain("application/rss+xml; charset=utf-8");
  });

  test("a backup holds the layout's entries and nothing else, and no token of the install: without this a zip handed to someone hands them the install", async () => {
    const bench = await openBench();
    const { notes } = await filled(bench);
    await bench.install.database.ensureVisitorKey(new Uint8Array(32).fill(7), 0);

    const entries = await readZip(await exportedZip(bench));
    const names = entries.map(([name]) => name);
    const text = entries.map(([name, content]) => `${name}\n${content.toString("latin1")}`).join("\n");

    expect(Object.values(bench.install.tokens).filter((token) => text.includes(token) || text.includes(token.split("_")[2] ?? token))).toEqual([]);
    expect([names[0], names.at(-1)]).toEqual(["settings.json", "manifest.json"]);
    expect(names.filter((name) => name.startsWith(`sites/${notes}/`))).toEqual([
      `sites/${notes}/site.json`,
      `sites/${notes}/versions/1/files/LICENSE`,
      `sites/${notes}/versions/1/files/css/site.css`,
      `sites/${notes}/versions/1/files/index.html`,
      `sites/${notes}/versions/1/files.json`,
      `sites/${notes}/versions/2/files/LICENSE`,
      `sites/${notes}/versions/2/files/css/site.css`,
      `sites/${notes}/versions/2/files/index.html`,
      `sites/${notes}/versions/2/files.json`,
    ]);
    expect(names.filter((name) => !/^(settings\.json|manifest\.json|sites\/[a-z0-9-]+\/(site\.json|versions\/\d+\/(files\.json|files\/.+)))$/.test(name))).toEqual([]);
  });

  test("a run started again passes over the sites the install has by now as `skipped`, and exits 0: without this a broken-off import could not be finished by running it again", async () => {
    const from = await openBench();
    const into = await openBench();
    await filled(from);
    const zip = await exportedZip(from);

    // Every file after the first finished site meets a dead connection.
    into.hook = (request) => (request.method === "PUT" && into.sent.some((sent) => sent.endsWith("/finish")) ? Promise.reject(new Error("reset")) : undefined);
    const broken = jsonOf(await into.run(`import ${zip} --json`));
    into.hook = undefined;
    const made = (await answered(into.install.routes.export.sites.$get())).body.sites;
    const again = await into.run(`import ${zip} --json`);

    expect([broken.imported, broken.failed, broken.stopped, (broken.sites as Line[]).at(-1)?.code]).toEqual([1, 1, true, "unreachable"]);
    expect(made).toHaveLength(1);
    expect([again.code, jsonOf(again).imported, jsonOf(again).skipped, jsonOf(again).failed]).toEqual([0, 4, 1, 0]);
    expect((jsonOf(again).sites as Line[]).filter((site) => site.result === "skipped").map((site) => site.code)).toEqual(["id_taken"]);
    expect(await held(into.install)).toEqual(await held(from.install));
  });

  // Drift: every site of a backup meets a spent database the same way; a run that went on would ask once per site for nothing, and a line without the hour would not say when to run it again.
  test("an import that meets a database spent for the day stops at the first site, and its line says when the allowance is back", async () => {
    const from = await openBench();
    const into = await openBench();
    await filled(from);
    const zip = await exportedZip(from);
    into.hook = (request) => (request.method === "POST" && request.url.endsWith("/api/import/sites") ? answer(503, { error: { code: "allowance_spent", message: "no", about: "writing" } }) : undefined);

    const said = jsonOf(await into.run(`import ${zip} --json`));

    expect([said.imported, said.failed, said.stopped, into.sent.filter((line) => line === "POST /api/import/sites").length]).toEqual([0, 1, true, 1]);
    expect(said.sites).toMatchObject([{ code: "allowance_spent", message: "a day's allowance of the install is used up until 00:00 UTC (writing)" }]);
  });

  // A start answered 429 began nothing, so the start made again makes each site once.
  // Drift: 429 is a refusal every other site would meet too, so a start that was not waited out would stop a whole restore at its first site on a zone that counts requests.
  test("an import whose first site is begun into a 429 rests, begins it again, and imports every site once", async () => {
    const from = await openBench();
    const into = await openBench();
    await filled(from);
    const zip = await exportedZip(from);
    const refusals = [answer(429, { error: { code: "too_many_requests", message: "no" } })];
    into.hook = (request) => (request.method === "POST" && request.url.endsWith("/api/import/sites") ? refusals.shift() : undefined);

    const ran = await into.run(`import ${zip} --json`);
    const said = jsonOf(ran);
    const names = async (bench: Bench): Promise<string[]> => ((await answered(bench.install.routes.export.sites.$get())).body.sites as { name: string }[]).map((site) => site.name).sort();
    const backed = await names(from);

    expect([said.failed, said.stopped, ran.waits, said.imported, await names(into)]).toEqual([0, false, [2000], backed.length, backed]);
    expect(into.sent.filter((line) => line === "POST /api/import/sites").length).toBe(backed.length + 1);
  });

  // Drift: a refusal stops the run only when every other site would meet it too; the install's own 429 is a refusal, and a run that went on after Ctrl-C would import the rest of a backup the person had stopped.
  test("an import the person stops during a rest stops the run, and no later site is tried", async () => {
    const from = await openBench();
    const into = await openBench();
    await filled(from);
    const zip = await exportedZip(from);
    into.hook = (request) => (request.method === "PUT" ? answer(429, { error: { code: "too_many_requests", message: "no" } }) : undefined);
    into.paused = async () => "interrupted";

    const stopped = await into.run(`import ${zip} --json`);
    const said = jsonOf(stopped);

    expect([said.imported, said.failed, said.stopped, stopped.waits, into.sent.filter((line) => line === "POST /api/import/sites").length]).toEqual([0, 1, true, [2000], 1]);
    expect((await answered(into.install.routes.export.sites.$get())).body.sites).toEqual([]);
  });

  // Drift: four files are on their way at once; a file the install refused during the rest would be the failure told, a refusal of one site alone, and the run would go on after Ctrl-C.
  test("a stop during a rest stops the run though another file of the site was refused meanwhile", async () => {
    const from = await openBench();
    const into = await openBench();
    await published(from, "alpha", { "index.html": "<title>Alpha</title>", "a.css": "a{}" });
    await published(from, "beta", { "index.html": "<title>Beta</title>", "b.css": "b{}" });
    const zip = await exportedZip(from);
    let puts = 0;

    into.hook = (request) => {
      if (request.method !== "PUT") return undefined;

      puts += 1;
      if (puts === 1) return answer(429, { error: { code: "too_many_requests", message: "no" } });

      return puts === 2 ? answer(400, { error: { code: "size_mismatch", message: "no", about: "index.html" } }) : undefined;
    };
    // The stop comes only once the other file has been refused.
    into.paused = () => new Promise((resolve) => setTimeout(() => resolve("interrupted"), 20));

    const said = jsonOf(await into.run(`import ${zip} --json`));

    expect([said.imported, said.stopped, (said.sites as Line[]).map((site) => site.code), into.sent.filter((line) => line === "POST /api/import/sites").length]).toEqual([0, true, ["stopped"], 1]);
  });

  // Drift: a stop was heard during a rest alone; at any other moment the process ended at once, and the site's upload held its place under the limits for a day.
  test("an import the person stops while a site's files are on their way gives that site's upload up, and no later site is tried", async () => {
    const from = await openBench();
    const into = await openBench();
    await published(from, "alpha", { "index.html": "<title>Alpha</title>", "a.css": "a{}" });
    await published(from, "beta", { "index.html": "<title>Beta</title>", "b.css": "b{}" });
    const zip = await exportedZip(from);
    into.hook = (request) => {
      if (request.method !== "PUT") return undefined;

      setTimeout(into.stop, 5);

      return new Promise<Response>(() => undefined);
    };

    const stopped = await into.run(`import ${zip} --json`);
    const said = jsonOf(stopped);
    const sent = (start: string): number => into.sent.filter((line) => line.startsWith(start)).length;

    expect([stopped.code, said.stopped, said.sites]).toMatchObject([1, true, [{ code: "stopped", message: "the command was stopped; the upload was given up and the site was not made" }]]);
    expect([sent("POST /api/import/sites"), sent("PUT"), sent("DELETE /api/uploads/")]).toEqual([1, 2, 1]);
    expect((await answered(into.install.routes.export.sites.$get())).body.sites).toEqual([]);
  });

  test("a site the install refuses is reported with the install's code and the next is tried, and any failure exits 1: without this one taken name would stop a restore", async () => {
    const from = await openBench();
    const { docs } = await filled(from);
    const zip = await exportedZip(from);
    const taken = await openBench();
    await published(taken, "other", { "index.html": "<title>Other</title>" }, "--public --name docs");
    const full = await openBench();
    await full.run("config max_sites 2");
    const malformed = await withEntry(zip, new RegExp(`^sites/${docs}/site\\.json$`), (site) => ({ ...site, embeddable: "sometimes" }));
    const older = await openBench();
    older.hook = (request) => (new URL(request.url).pathname === "/api/import/sites" ? answer(409, { error: { code: "backup_too_new", message: "newer", about: "format" } }) : undefined);

    const runs = {
      name_taken: await taken.run(`import ${zip} --json`),
      too_many_sites: await full.run(`import ${zip} --json`),
      bad_argument: await (await openBench()).run(`import ${malformed} --json`),
      backup_too_new: await older.run(`import ${zip} --json`),
    };

    expect(Object.fromEntries(Object.entries(runs).map(([code, ran]) => [code, ran.code]))).toEqual({ name_taken: 1, too_many_sites: 1, bad_argument: 1, backup_too_new: 1 });
    expect(linesOf(jsonOf(runs.name_taken))).toEqual({ demo: "imported", docs: "name_taken", notes: "imported", old: "imported", typed: "imported" });
    expect(linesOf(jsonOf(runs.bad_argument)).docs).toBe("bad_argument");
    expect(Object.values(linesOf(jsonOf(runs.too_many_sites))).sort()).toEqual(["imported", "imported", "too_many_sites", "too_many_sites", "too_many_sites"]);
    expect(Object.values(linesOf(jsonOf(runs.backup_too_new)))).toEqual(Array(5).fill("backup_too_new"));
  });

  // Drift: an install never reads a site's pages. A backup of an install under a domain, put into one without, would make sites whose "/css/site.css" opens the host's root, and no line would say so.
  test("an install without a domain refuses a site whose live pages link from the root as a publish there is refused, sends nothing of it, and imports the next; an install with a domain takes both", async () => {
    const from = await openBench();
    const rooted = folderOf("rooted", { "index.html": '<link href="/css/site.css">', "css/site.css": "body{}" });
    const mended = (jsonOf(await from.run(`${rooted} --json`)).site as { label: string }).label;
    await published(from, "linked", { "index.html": '<a href="/about.html">about</a>', "about.html": "<title>About</title>" });
    writeFileSync(join(rooted, "index.html"), '<link href="css/site.css">');
    await from.run(`${rooted} --site ${mended}`);
    const zip = await exportedZip(from);
    const under = await openBench({ kind: "path", sites_host: "sites.example.net", private_host: "private.example.net" });
    const beside = await openBench();

    const refused = await under.run(`import ${zip} --json`);
    const taken = await beside.run(`import ${zip} --json`);
    const failed = (jsonOf(refused).sites as (Line & { readonly message?: string })[]).find((site) => site.result === "failed");

    expect([refused.code, linesOf(jsonOf(refused)), taken.code, linesOf(jsonOf(taken))]).toEqual([1, { linked: "root_links", rooted: "imported" }, 0, { linked: "imported", rooted: "imported" }]);
    expect(failed?.message).toBe('this install has no domain, so a link that starts with "/" would not open (/about.html in index.html)');
    expect([under.sent.filter((line) => line === "GET /api/whoami").length, under.sent.filter((line) => line.startsWith("POST /api/import/sites")).length]).toEqual([1, 1]);
    expect((await held(under.install)).sites.map((site) => site.name)).toEqual(["rooted"]);
  });

  test("a site too large with every version is imported with its live version alone, and one too large even so fails: without this a full history would keep a site from coming back at all", async () => {
    const from = await openBench();
    const { notes } = await filled(from);
    const zip = await exportedZip(from);
    const into = await openBench();
    await into.run("config max_site_size 45B");

    const human = await into.run(`import ${zip} --site ${notes}`);
    const stored = (await answered(into.install.routes.export.sites[":site"].$get({ param: { site: notes }, query: { all_versions: "true" } }))).body.site as Stored;
    const tight = await openBench();
    await tight.run("config max_site_size 10B");
    const failed = jsonOf(await tight.run(`import ${zip} --site ${notes} --json`));

    expect(human).toMatchObject({ code: 0, out: [`imported  ${notes}  live version only  3 files  39 B`, "1 imported, 0 skipped, 0 failed"] });
    expect(stored.versions.map((version) => version.number)).toEqual([2]);
    expect([failed.failed, (failed.sites as Line[])[0]?.code, (await answered(tight.install.routes.sites.$get())).body.sites]).toEqual([1, "too_large", []]);
  });

  test("--dry-run checks the zip and lists its sites without a login or a request, and --site picks one by label, id, or public name: without this the flags are read and dropped", async () => {
    const from = await openBench();
    const { notes, docs } = await filled(from);
    const into = await openBench();

    const wide = await published(from, "wide", { "index.html": "<title>Wide</title>" }, "--public --name abcdefghijkl");
    const zip = await exportedZip(from);
    const dry = await into.run(`import ${zip} --dry-run --settings`, { env: {} });
    const byWideName = jsonOf(await into.run(`import ${zip} --dry-run --site abcdefghijkl --json`, { env: {} }));
    const one = jsonOf(await into.run(`import ${zip} --dry-run --site docs --json`, { env: {} }));
    const byId = jsonOf(await into.run(`import ${zip} --site ${notes.split("--")[1]} --json`));
    const absent = await into.run(`import ${zip} --site zzzzzzzzzzzz`);

    expect([dry.code, dry.out.length, dry.out[0], dry.out.at(-1)]).toEqual([0, 8, "would restore the settings, but for the logins", "the backup passed every check; nothing was sent: --dry-run calls no install"]);
    expect([one, byWideName].map((ran) => (ran.sites as Line[]).map((site) => site.label))).toEqual([[docs], [wide]]);
    expect([byId.imported, (byId.sites as Line[])[0]?.label]).toEqual([1, notes]);
    expect([absent.code, absent.err[0]]).toEqual([1, "the backup holds no such site: zzzzzzzzzzzz"]);
    expect(into.sent.filter((sent) => !sent.includes("/uploads/"))).toEqual(["GET /api/whoami", "POST /api/import/sites"]);
  });

  test("the settings come back only with --settings and the logins only with --logins, and a one-site backup has none to give: without this an import could lock the admin of the new install out", async () => {
    const from = await openBench();
    const label = await published(from, "notes", { "index.html": "<title>Notes</title>" });
    await from.run("config trash_days 9");
    await from.run("config logins ada@example.com,grace@example.com");
    const zip = await exportedZip(from);
    const one = await exportedZip(from, label);
    const into = await openBench();
    const settings = async (): Promise<unknown[]> => {
      const { values } = jsonOf(await into.run("config --json")) as { values: { trash_days: number; logins: unknown } };

      return [values.trash_days, values.logins];
    };

    const [before] = [await settings(), await into.run(`import ${zip}`)];
    const bare = await settings();
    const restored = await into.run(`import ${zip} --settings`);
    const kept = await settings();
    await into.run(`import ${zip} --settings --logins`);
    const refused = await into.run(`import ${one} --settings`);

    expect([bare, kept[0], kept[1]]).toEqual([before, 9, before[1]]);
    expect([(await settings())[1], restored.out[0]]).toEqual([["ada@example.com", "grace@example.com"], "restored the settings, but for the logins"]);
    expect([refused.code, refused.err[0]]).toEqual([1, "the backup holds no settings: it is the backup of one site"]);
  });

  test("a zip that fails a check is refused before any request, whatever else in it is right: without this a half-read backup could leave a half-restored install", async () => {
    const bench = await openBench();
    const folder = scratch();
    const zips = [
      await writeZip(join(folder, "format.zip"), backupEntries({ manifest: { format: 2 } })),
      await writeZip(join(folder, "stray.zip"), [["notes.txt", "hello"], ...backupEntries()]),
      await writeZip(join(folder, "count.zip"), backupEntries({ manifest: { files: 3 } })),
      join(folder, "no\\such.zip"),
    ];

    const runs = [];
    for (const zip of zips) runs.push(await bench.run(`import ${zip}`));

    expect(runs.map((ran) => [ran.code, ran.out, ran.err[1]])).toEqual(Array(4).fill([1, [], "nothing was sent to the install"]));
    expect(runs.map((ran) => ran.err[0])).toEqual([
      "the file is not a backup: it is of format 2, which a newer poplin made; this one reads up to format 1",
      'the file is not a backup: "notes.txt" is no entry of a backup',
      "the file is not a backup: its manifest counts other sites, files, or bytes than it holds",
      `the file is not a backup: "${zips[3]}" cannot be opened`,
    ]);
    expect([bench.sent, readdirSync(dirname(zips[0] ?? "")).length]).toEqual([[], 3]);
  });
});
