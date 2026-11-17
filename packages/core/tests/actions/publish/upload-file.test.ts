import { describe, expect, spyOn, test } from "bun:test";

import { beginPublish } from "../../../src/actions/publish/begin-publish";
import { finishPublish } from "../../../src/actions/publish/finish-publish";
import type { Install } from "../../../src/actions/records";
import { uploadFile } from "../../../src/actions/publish/upload-file";
import { uploadKey } from "../../../src/actions/publish/uploads";
import type { UploadId } from "../../../src/records/upload";
import { dayOf } from "../../../src/records/views";
import { hashOf, makeWorld, OWNER, PAGE_SHA256, STRANGER, type World } from "../support/actions-fixture";

/** An upload id no upload has. */
const NO_UPLOAD = "0000000000000000";

/** Begin a publish of `count` pages of four bytes each, `index.html` first; answers the upload's id. */
async function begun(world: World, count: number): Promise<string> {
  const paths = ["index.html", ...Array.from(Array(count - 1).keys(), (index) => `pages/${index}.html`)];
  const started = await beginPublish(world.install, OWNER, { name: `site-${count}`, files: paths.map((path) => ({ path, size: 4, content_type: "text/html", sha256: PAGE_SHA256 })) });
  if (!started.ok) throw new Error(`the fixture upload was refused: ${started.code}`);

  return started.upload.id;
}

/** What the store holds at one file of an upload: its text, the hash it keeps for it, and its type, or `nothing`. */
async function heldAt(world: World, upload: string, path: string): Promise<unknown> {
  const found = await world.install.database.getUploadFile(upload as UploadId, path);
  const key = found === undefined ? undefined : uploadKey(found.upload, path);
  if (key === undefined || !key.ok) throw new Error(`the fixture upload has no key for ${path}`);

  const read = await world.install.store.read(key.key);

  return read.kind === "found" ? [await new Response(read.body).text(), read.info.sha256, read.info.contentType] : "nothing";
}

/** Put bytes at the key of one file of an upload, behind the upload's back: what a publish that was never finished, or one a restored database no longer knows, left there. */
async function leftAt(world: World, upload: string, path: string, left: { readonly text: string; readonly sha256?: string; readonly contentType?: string }): Promise<void> {
  const found = await world.install.database.getUploadFile(upload as UploadId, path);
  const key = found === undefined ? undefined : uploadKey(found.upload, path);
  if (key === undefined || !key.ok) throw new Error(`the fixture upload has no key for ${path}`);

  await world.install.store.write(key.key, new TextEncoder().encode(left.text), { contentType: left.contentType ?? "text/html", sha256: left.sha256 });
}

/** The install with a database that notes the name of every method called on it. */
function counted(install: Install): { readonly install: Install; readonly calls: string[] } {
  const calls: string[] = [];
  const database = new Proxy(install.database, {
    get(target, name): unknown {
      const member: unknown = Reflect.get(target, name, target);
      if (typeof member !== "function") return member;

      return (...given: unknown[]): unknown => {
        calls.push(String(name));

        return Reflect.apply(member, target, given);
      };
    },
  });

  return { install: { ...install, database }, calls };
}

describe("sending one file of an upload", () => {
  // Drift: a publish sends a request per file; a request that asked the database more as the upload grew would run a large publish out of the queries and the CPU one request gets.
  test("a file of an upload of 5,000 files asks the database exactly what a file of an upload of 3 asks: the file, once, before the write", async () => {
    const world = await makeWorld();
    const asked: Record<string, string[]> = {};

    for (const files of [3, 5000]) {
      const upload = await begun(world, files);
      const watched = counted(world.install);
      const sent = await uploadFile(watched.install, OWNER, { upload, path: "pages/1.html", body: new Blob(["page"]).stream() });
      asked[`${files} files`] = [...watched.calls, JSON.stringify(sent)];
    }

    const each = ["getUploadFile", '{"ok":true,"path":"pages/1.html","size":4}'];
    expect(asked).toEqual({ "3 files": each, "5000 files": each });
  });

  // Drift: a host bills every write to its store, and an upload's writes are counted once, as it begins. A file stored again each time it is sent would be a write nothing counts, as many times as a client loops.
  test("a file sent again is answered as the first time and is not written to the store again", async () => {
    const world = await makeWorld();
    const upload = await begun(world, 3);
    const writes = spyOn(world.install.store, "write");
    const send = (text: string): ReturnType<typeof uploadFile> => uploadFile(world.install, OWNER, { upload, path: "pages/1.html", body: new Blob([text]).stream() });

    const answers = [await send("page"), await send("page"), await send("other"), await send("pag")];
    const stored = { ok: true, path: "pages/1.html", size: 4 };

    expect<unknown>([answers, writes.mock.calls.length]).toEqual([[stored, stored, stored, stored], 1]);
  });

  // Drift: a host bills a write it refused as one it kept. A file sent short again and again would be a write nothing counts each time, so each is counted, and once the day has no room the upload is given up.
  test("a file whose bytes are too few is counted as a write each time it is sent, and at the day's bound its upload is given up and takes no more", async () => {
    const world = await makeWorld({ max_storage_writes_per_day: 5 });
    const upload = await begun(world, 3);
    const writes = spyOn(world.install.store, "write");
    const send = (text: string): ReturnType<typeof uploadFile> => uploadFile(world.install, OWNER, { upload, path: "pages/1.html", body: new Blob([text]).stream() });

    const answers = [await send("pag"), await send("pag"), await send("pag"), await send("page")];
    const counted = await world.install.database.readStorageWrites(dayOf(world.clock.now));

    expect(answers.map((answer) => (answer.ok ? "stored" : `${answer.code} ${answer.about}`))).toEqual([
      "size_mismatch pages/1.html",
      "size_mismatch pages/1.html",
      "allowance_spent max_storage_writes_per_day",
      "not_found upload",
    ]);
    expect([writes.mock.calls.length, counted]).toEqual([3, { writes: 6, most: 5 }]);
    expect((await world.install.database.listProblems(dayOf(world.clock.now))).map(({ kind, count }) => [kind, count])).toEqual([["writes_limit_reached", 1]]);
  });

  // Drift: every refusal is decided from the one file and the upload the lookup answers; a lookup that lost either would store bytes nobody declared, or another publisher's.
  test("a file is refused, and nothing of it stored, when its upload or its path is not there, it is another publisher's, its bytes are not as many as declared, or the upload is finished", async () => {
    const world = await makeWorld();
    const upload = await begun(world, 3);
    const live = await begun(world, 1);
    await uploadFile(world.install, OWNER, { upload: live, path: "index.html", body: new Blob(["page"]).stream() });
    await finishPublish(world.install, OWNER, live);
    const before = await world.keys();
    const send = (actor: typeof OWNER, to: string, path: string, text: string): ReturnType<typeof uploadFile> => uploadFile(world.install, actor, { upload: to, path, body: new Blob([text]).stream() });

    const refused = [
      await send(OWNER, "no id", "index.html", "page"),
      await send(OWNER, NO_UPLOAD, "index.html", "page"),
      await send(STRANGER, upload, "index.html", "page"),
      await send(OWNER, upload, "pages/2.html", "page"),
      await send(OWNER, upload, "pages/1.htm", "page"),
      await send(OWNER, upload, "pages/1.html", "pages"),
      await send(OWNER, upload, "pages/1.html", "pag"),
      await send(OWNER, live, "index.html", "page"),
    ];

    expect(refused.map((answer) => (answer.ok ? "stored" : `${answer.code} ${answer.about}`))).toEqual([
      "bad_argument upload",
      "not_found upload",
      "not_found upload",
      "not_found path",
      "not_found path",
      "size_mismatch pages/1.html",
      "size_mismatch pages/1.html",
      "upload_finished upload",
    ]);
    expect(await world.keys()).toEqual(before);
  });

  // Drift: the size was once the only proof of a file. A restored database hands a version number out again, and the folder still holds what was first sent under it: a page of the same length kept its old bytes, and the publish said it worked.
  test.each([
    ["an upload under the same version that was never finished, which declared its own hash", async (): Promise<{ text: string; sha256: string }> => ({ text: "old!", sha256: await hashOf("old!") })],
    ["a publish from before any hash was kept", async (): Promise<{ text: string }> => ({ text: "old!" })],
    ["a file of the same bytes under another type", async (): Promise<{ text: string; sha256: string; contentType: string }> => ({ text: "page", sha256: PAGE_SHA256, contentType: "text/plain" })],
  ])("a file of the declared size left at the key by %s is written over with the declared bytes and type, and the site serves those", async (_whose, left) => {
    const world = await makeWorld();
    const upload = await begun(world, 1);
    await leftAt(world, upload, "index.html", await left());
    const writes = spyOn(world.install.store, "write");
    const before = writes.mock.calls.length;

    const sent = await uploadFile(world.install, OWNER, { upload, path: "index.html", body: new Blob(["page"]).stream() });
    const finished = await finishPublish(world.install, OWNER, upload);

    expect<unknown>([sent, writes.mock.calls.length - before, finished.ok, await heldAt(world, upload, "index.html")]).toEqual([{ ok: true, path: "index.html", size: 4 }, 1, true, ["page", PAGE_SHA256, "text/html"]]);
  });

  // Drift: a file is skipped on the store's own hash of it, so only bytes that are the declared ones are ever skipped; and bytes that are not are refused by the store itself, whatever their length.
  test("bytes of the declared length and another hash are refused as a hash mismatch, counted as a write, and nothing of them is stored: what the key held stays", async () => {
    const world = await makeWorld();
    const upload = await begun(world, 3);
    const send = (path: string, text: string): ReturnType<typeof uploadFile> => uploadFile(world.install, OWNER, { upload, path, body: new Blob([text]).stream() });

    const answers = [await send("pages/0.html", "evil"), await send("pages/1.html", "page"), await send("pages/1.html", "evil"), await send("pages/1.html", "page")];
    const counted = await world.install.database.readStorageWrites(dayOf(world.clock.now));

    expect(answers.map((answer) => (answer.ok ? "stored" : `${answer.code} ${answer.about}`))).toEqual(["hash_mismatch pages/0.html", "stored", "stored", "stored"]);
    expect<unknown>([await heldAt(world, upload, "pages/0.html"), await heldAt(world, upload, "pages/1.html"), counted?.writes]).toEqual(["nothing", ["page", PAGE_SHA256, "text/html"], 4]);
    expect(await finishPublish(world.install, OWNER, upload)).toEqual({ ok: false, code: "missing_files", about: "index.html" });
  });

  // Drift: a file was skipped on the hash and the type alone. A declared size the object does not have was then answered as stored, and every finish after it said the file was missing: a publish that could never end.
  test("a file declared longer than the object that holds its hash is not skipped: the bytes sent are held to the declared size, and refused", async () => {
    const world = await makeWorld();
    const started = await beginPublish(world.install, OWNER, { name: "report", files: [{ path: "index.html", size: 5, content_type: "text/html", sha256: PAGE_SHA256 }] });
    if (!started.ok) throw new Error(`the fixture upload was refused: ${started.code}`);

    await leftAt(world, started.upload.id, "index.html", { text: "page", sha256: PAGE_SHA256 });
    const sent = await uploadFile(world.install, OWNER, { upload: started.upload.id, path: "index.html", body: new Blob(["page"]).stream() });

    expect(sent).toEqual({ ok: false, code: "size_mismatch", about: "index.html" });
  });

  // Drift: an upload recorded before files declared a hash names none, and an object stored before then holds none. Two absent hashes compared as equal, so stale bytes of any length were skipped.
  test("a file whose record names no hash is not skipped over an object that holds none: the bytes sent are stored", async () => {
    const world = await makeWorld();
    const upload = await begun(world, 1);
    await leftAt(world, upload, "index.html", { text: "old!" });
    const database = new Proxy(world.install.database, {
      get(target, name): unknown {
        if (name !== "getUploadFile") return Reflect.get(target, name, target);

        return async (...given: Parameters<typeof target.getUploadFile>): Promise<unknown> => {
          const found = await target.getUploadFile(...given);
          if (found?.file === undefined) return found;

          const { sha256: _dropped, ...file } = found.file;

          return { ...found, file };
        };
      },
    });

    const sent = await uploadFile({ ...world.install, database }, OWNER, { upload, path: "index.html", body: new Blob(["page"]).stream() });

    expect<unknown>([sent, await heldAt(world, upload, "index.html")]).toEqual([{ ok: true, path: "index.html", size: 4 }, ["page", undefined, "text/html"]]);
  });
});
