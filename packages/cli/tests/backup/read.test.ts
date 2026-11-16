import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";

import { openBackup } from "../../src/backup/read";
import { backupEntries, declare, FILES, replaceBytes, SITE, writeZip, type ZipEntry } from "./support/zips";

/** The folder of the small backup's site. */
const FOLDER = `sites/${SITE.label}`;

/** The folder of its one version's files. */
const VERSION_FILES = `${FOLDER}/versions/1/files`;

/** The start of the name of the folder a test's zip is written into. */
const SCRATCH = join(tmpdir(), "poplin-backup-");

/** How long the test of a record nested too deep may take, in milliseconds: the refusal comes only once the engine runs out of stack writing the record again, half a second alone and past the five seconds a test gets on a loaded machine. */
const DEEP_MS = 60_000;

/** Builds one zip that is no backup, at the path given. */
type Build = (path: string) => Promise<unknown> | unknown;

/** The small backup with one entry taken out, put in, or replaced. */
function entriesWith(change: (entries: ZipEntry[]) => ZipEntry[]): Build {
  return (path) => writeZip(path, change(backupEntries()));
}

function without(name: string): Build {
  return entriesWith((entries) => entries.filter(([entry]) => entry !== name));
}

/** Put entries in before the entry named. */
function before(name: string, ...added: ZipEntry[]): Build {
  return entriesWith((entries) => entries.flatMap((entry) => (entry[0] === name ? [...added, entry] : [entry])));
}

function replaced(name: string, content: unknown): Build {
  return entriesWith((entries) => entries.map((entry): ZipEntry => (entry[0] === name ? [name, JSON.stringify(content)] : entry)));
}

/** The small backup with the name of one file's entry rewritten in the zip's bytes: a name no zip writer agrees to write. */
function renamed(from: string, to: string): Build {
  return async (path) => {
    await writeZip(path, backupEntries({ files: { "index.html": "<title>x</title>", [from]: "body{}" } }));
    replaceBytes(path, `${VERSION_FILES}/${from}`, to);
  };
}

/** The small backup whose directory says something of `index.html` that its stream does not hold: another checksum, or the size every index and record agree on while the stream holds `stream`. */
function lying(field: "size" | "checksum", value: number, stream: string = FILES["index.html"]): Build {
  return async (path) => {
    await writeZip(
      path,
      backupEntries().map((entry): ZipEntry => (entry[0] === `${VERSION_FILES}/index.html` ? [entry[0], stream] : entry)),
    );
    declare(path, `${VERSION_FILES}/index.html`, field, value);
  };
}

/** What opening the zip a build makes comes to. */
async function outcome(build: Build): Promise<Awaited<ReturnType<typeof openBackup>>> {
  using folder = mkdtempDisposableSync(SCRATCH);
  const path = join(folder.path, "backup.zip");
  await build(path);

  return await openBackup(path);
}

/** The small backup whose site record has one more key, nested 50,000 arrays deep: JSON that is read and cannot be written again. */
function nested(): Build {
  const deep = `,"deep":${"[".repeat(50_000)}${"]".repeat(50_000)}}`;

  return entriesWith((entries) => entries.map((entry): ZipEntry => (entry[0] === `${FOLDER}/site.json` ? [entry[0], `${String(entry[1]).slice(0, -1)}${deep}`] : entry)));
}

/** The entries of the small backup's site, to put a second time into one zip. */
const SECOND_SITE: ZipEntry[] = backupEntries().slice(0, -1);

/** A zip of 42 bytes: a ZIP64 locator that names an offset of 2^53, one past what a file read takes, and the end record that sends a reader to it. */
const BEYOND = Buffer.concat([Buffer.from("504b0607" + "00000000" + "0000000000002000" + "01000000", "hex"), Buffer.from("504b0506" + "00000000" + "ffffffff" + "ffffffff" + "ffffffff" + "0000", "hex")]);

/** Every zip that is no backup: what is wrong with it, what builds it, and the reason it is refused with. */
const REFUSED: readonly (readonly [what: string, build: Build, reason: RegExp])[] = [
  ["bytes that are no zip", (path) => writeFileSync(path, "PK hello"), /^it is not a zip that can be read: /],
  // Drift: a folder was refused in the system's words, "EISDIR: illegal operation on a directory, read".
  ["a folder", (path) => mkdirSync(path), /^".*" is a folder; a backup is the zip poplin export writes$/],
  ["a zip that is cut off", async (path) => writeFileSync(path, (await Bun.file(await writeZip(`${path}.whole`, backupEntries())).bytes()).slice(0, 200)), /^it is not a zip that can be read: /],
  ["no manifest at the end", without("manifest.json"), /^it does not end in a manifest\.json/],
  ["an entry after the manifest", entriesWith((entries) => [...entries, [`${VERSION_FILES}/late.txt`, "late"]]), /^an entry follows its manifest\.json/],
  ["two manifests", entriesWith((entries) => [...entries, ...entries.slice(-1)]), /^an entry follows its manifest\.json/],
  ["a format this poplin does not read", (path) => writeZip(path, backupEntries({ manifest: { format: 2 } })), /^it is of format 2/],
  ["a manifest that is no JSON", entriesWith((entries) => [...entries.slice(0, -1), ["manifest.json", "{"]]), /^"manifest\.json" is not JSON that can be read/],
  ["settings the manifest does not announce", before(`${FOLDER}/site.json`, ["settings.json", "{}"]), /disagree on whether it holds the settings/],
  ["settings that are announced and absent", (path) => writeZip(path, backupEntries({ manifest: { settings: true } })), /disagree on whether it holds the settings/],
  ["settings that are not the first entry", before("manifest.json", ["settings.json", "{}"]), /^its settings\.json is not the first entry/],
  ["an entry of no backup", before("manifest.json", ["notes.txt", "hello"]), /^"notes\.txt" is no entry of a backup/],
  ["an entry beside a version's files", before("manifest.json", [`${FOLDER}/versions/1/notes.txt`, "hello"]), /is no entry of a backup/],
  ["a name that climbs out of its site", renamed("aa/x.css", `${VERSION_FILES}/../x.css`), /^it is not a zip that can be read: invalid relative path/],
  ["a name that climbs out of the zip", renamed("aa/x.css", "../../../../../../../../../../../../../tmp/x.css".padEnd(`${VERSION_FILES}/aa/x.css`.length, "s")), /^it is not a zip that can be read: invalid relative path/],
  ["an absolute name", renamed("aa/x.css", `/${VERSION_FILES.slice(1)}/aa/x.css`), /^it is not a zip that can be read: absolute path/],
  ["a name with a backslash", renamed("aa/x.css", `${VERSION_FILES}/aa\\x.css`), /^it is not a zip that can be read: invalid characters in fileName/],
  ["a path with a dot segment", renamed("a/x.css", `${VERSION_FILES}/./x.css`), /has a path no site can hold/],
  ["a path with an empty segment", renamed("a/x.css", `${VERSION_FILES}//ax.css`), /has a path no site can hold/],
  ["a file that is there twice", before(`${VERSION_FILES}/css/site.css`, [`${VERSION_FILES}/index.html`, FILES["index.html"]]), /is there twice/],
  ["a file its index does not list", before(`${FOLDER}/versions/1/files.json`, [`${VERSION_FILES}/extra.txt`, "extra"]), /does not list every file of its version/],
  ["an index that lists a file that is not there", without(`${VERSION_FILES}/css/site.css`), /lists "css\/site\.css", which the version does not hold at that size/],
  ["an index that lists a file at another size", replaced(`${FOLDER}/versions/1/files.json`, [{ path: "index.html", size: 27, content_type: "text/html" }]), /lists "index\.html", which the version does not hold at that size/],
  ["a record that counts other files", (path) => writeZip(path, backupEntries({ record: { versions: [{ number: 1, files: 2, bytes: 33 }] } })), /^version 1 of "notes--k3f9x2ab71qz" does not hold the files its record counts/],
  ["a version the record names and the zip lacks", (path) => writeZip(path, backupEntries({ record: { versions: [{ number: 1, files: 2, bytes: 32 }, { number: 2, files: 0, bytes: 0 }] } })), /is there without every version its record names/],
  ["a version the record does not name", (path) => writeZip(path, backupEntries({ record: { live_version: 2, versions: [{ number: 2, files: 2, bytes: 32 }] } })), /is out of place: the versions of a site come in its record's order/],
  ["a record that does not keep its live version", (path) => writeZip(path, backupEntries({ record: { live_version: 2 } })), /names a version twice, or does not keep its live version/],
  ["a record in the folder of another site", (path) => writeZip(path, backupEntries({ record: { id: "zzzzzzzzzzzz" } })), /does not sit in the folder of its site's label/],
  ["a site that is there twice", before("manifest.json", ...SECOND_SITE), /^the site "notes--k3f9x2ab71qz" is there twice/],
  ["a file with no site before it", without(`${FOLDER}/site.json`), /is out of place: a site's entries follow its site\.json/],
  ["a manifest that counts other bytes", (path) => writeZip(path, backupEntries({ manifest: { bytes: 31 } })), /^its manifest counts other sites, files, or bytes/],
  ["a manifest that counts a site that is not there", (path) => writeZip(path, backupEntries({ manifest: { sites: 2 } })), /^its manifest counts other sites, files, or bytes/],
  ["a place beyond what a file can hold", (path) => writeFileSync(path, BEYOND), /^it is not a zip that can be read: /],
  ["a file whose stream is longer than its entry says", lying("size", 26, "a".repeat(50_000)), /^it is not a zip that can be read: too many bytes in the stream/],
  ["a file whose stream is shorter than its entry says", lying("size", 26, "a"), /^it is not a zip that can be read: not enough bytes in the stream/],
  ["a file whose bytes are not the ones written", lying("checksum", 7), /is damaged: its bytes are not the ones it was written with/],
];

describe("openBackup", () => {
  test("a backup that passes every check is read a site at a time, with its settings, and each file opens from its first byte as often as asked: without this the checks would pass a zip the import cannot read", async () => {
    using folder = mkdtempDisposableSync(SCRATCH);
    const path = await writeZip(join(folder.path, "backup.zip"), backupEntries({ settings: { trash_days: "9" } }));

    const opened = await openBackup(path);
    if (!opened.ok) throw new Error(opened.reason);

    const sites = await Array.fromAsync(opened.backup.sites());
    const [first] = sites[0]?.versions[0]?.files ?? [];
    if (first === undefined) throw new Error("the backup's site holds no file");

    const read = [await text(await first.open()), await text(await first.open())];
    await opened.backup.close();

    expect([opened.backup.manifest.sites, opened.backup.settings]).toEqual([1, { trash_days: "9" }]);
    expect(sites).toMatchObject([{ label: SITE.label, record: { id: SITE.id, live_version: 1 }, files: 2, bytes: 32, versions: [{ number: 1, files: [{ path: "index.html", size: 26, contentType: "text/plain" }, { path: "css/site.css", size: 6 }] }] }]);
    expect(read).toEqual([FILES["index.html"], FILES["index.html"]]);
  });

  test.each(REFUSED)("%s is refused with its reason: without this check a zip could name a path outside its site, hide a longer stream, or leave a site half described", async (_what, build, reason) => {
    expect(await outcome(build)).toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });

  // Drift: a record that is read and cannot be written again passes every check, and the import fails on it only once it is sent to the install.
  test(
    "a record nested too deep to send is refused with its reason",
    async () => {
      expect(await outcome(nested())).toEqual({ ok: false, reason: expect.stringMatching(/is not JSON that can be read and written again/) });
    },
    DEEP_MS,
  );
});
