import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BackupWriter, createBackup } from "../../src/backup/write";
import { readZip } from "./support/zips";

/** The scratch folders the tests made. */
const SCRATCH: string[] = [];

function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), "poplin-backup-"));
  SCRATCH.push(folder);

  return folder;
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new Blob(chunks).stream();
}

/** A stream that gives one chunk and then breaks off, as a download does when the connection drops. */
function breaking(): ReadableStream<Uint8Array> {
  let sent = false;

  return new ReadableStream({
    pull: (controller) => {
      if (sent) return controller.error(new Error("the connection dropped"));

      sent = true;
      controller.enqueue(new TextEncoder().encode("half"));
    },
  });
}

async function begun(target: string, overwrite = false): Promise<BackupWriter> {
  const created = await createBackup(target, overwrite);
  if (!created.ok) throw new Error(created.reason);

  return created.writer;
}

/** What a writer that goes wrong throws at one of its steps. */
async function thrownBy(step: () => Promise<unknown>): Promise<string> {
  return step().then(
    () => "nothing was thrown",
    (error: unknown) => String(error),
  );
}

afterEach(() => {
  for (const folder of SCRATCH.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("createBackup", () => {
  test("the entries are written in the order added, and the target is there only once the zip is finished: without this a reader could open half a backup", async () => {
    const folder = scratch();
    const target = join(folder, "backup.zip");
    const writer = await begun(target);

    writer.addJson("first.json", { a: 1 });
    await writer.addFile("files/page.html", streamOf("<title>", "x</title>"), 16);
    await writer.addFile("files/empty", streamOf(), 0);
    const during = readdirSync(folder);
    const size = await writer.finish();

    expect([during.length, during[0]]).toEqual([1, expect.stringMatching(/^backup\.zip\.[0-9a-f]{8}\.part$/)]);
    expect([readdirSync(folder), size]).toEqual([["backup.zip"], readFileSync(target).length]);
    expect((await readZip(target)).map(([name, content]) => [name, content.toString()])).toEqual([
      ["first.json", '{\n  "a": 1\n}'],
      ["files/page.html", "<title>x</title>"],
      ["files/empty", ""],
    ]);
  });

  test("a target that is there, were it a link that leads nowhere, is refused before a file is made, and with `overwrite` it keeps its old bytes until the new zip is whole: without this a failed export would cost the last good backup", async () => {
    const folder = scratch();
    const target = join(folder, "backup.zip");
    writeFileSync(target, "the last good backup");

    symlinkSync(join(folder, "nowhere.zip"), join(folder, "link.zip"));

    const refused = await createBackup(target, false);
    const linked = await createBackup(join(folder, "link.zip"), false);
    const nowhere = await createBackup(join(folder, "absent", "backup.zip"), false);
    const failing = await begun(target, true);
    await failing.addFile("a", streamOf("a"), 1);
    await failing.abandon();
    const kept = [readdirSync(folder).sort(), readFileSync(target, "utf8")];
    rmSync(join(folder, "link.zip"));
    const writer = await begun(target, true);
    writer.addJson("a.json", 1);
    await writer.finish();

    expect([refused, linked, nowhere]).toEqual([{ ok: false, reason: "exists" }, { ok: false, reason: "exists" }, { ok: false, reason: "unwritable", why: expect.stringContaining("ENOENT") }]);
    expect(kept).toEqual([["backup.zip", "link.zip"], "the last good backup"]);
    expect((await readZip(target)).map(([name]) => name)).toEqual(["a.json"]);
  });

  test.each<[string, (writer: BackupWriter) => Promise<unknown>, RegExp]>([
    ["a stream that breaks off", (writer) => writer.addFile("a", breaking(), 8), /the connection dropped/],
    ["a stream shorter than its size", async (writer) => [await writer.addFile("a", streamOf("abc"), 8), await writer.finish()], /unexpected number of bytes/],
    ["a stream longer than its size", async (writer) => [await writer.addFile("a", streamOf("abcdefghij"), 8), await writer.finish()], /unexpected number of bytes/],
    ["a file that appears at the target meanwhile", async (writer) => [writeFileSync(join(SCRATCH.at(-1) ?? "", "backup.zip"), "theirs"), await writer.finish()], /a file appeared at/],
  ])("%s throws, and giving the backup up leaves no file of its own: without this a broken export would stand as a backup", async (_what, step, thrown) => {
    const folder = scratch();
    const writer = await begun(join(folder, "backup.zip"));
    writer.addJson("first.json", {});

    const error = await thrownBy(() => step(writer));
    await writer.abandon();
    await writer.abandon();

    expect(error).toMatch(thrown);
    expect(readdirSync(folder).filter((name) => name !== "backup.zip" || readFileSync(join(folder, name), "utf8") !== "theirs")).toEqual([]);
  });
});
