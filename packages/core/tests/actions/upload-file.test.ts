import { describe, expect, spyOn, test } from "bun:test";

import { beginPublish } from "../../src/actions/begin-publish";
import { finishPublish } from "../../src/actions/finish-publish";
import type { Install } from "../../src/actions/records";
import { uploadFile } from "../../src/actions/upload-file";
import { dayOf } from "../../src/records/views";
import { makeWorld, OWNER, STRANGER, type World } from "./support/actions-fixture";

/** An upload id no upload has. */
const NO_UPLOAD = "0000000000000000";

/** Begin a publish of `count` pages of four bytes each, `index.html` first; answers the upload's id. */
async function begun(world: World, count: number): Promise<string> {
  const paths = ["index.html", ...Array.from(Array(count - 1).keys(), (index) => `pages/${index}.html`)];
  const started = await beginPublish(world.install, OWNER, { name: `site-${count}`, files: paths.map((path) => ({ path, size: 4, content_type: "text/html" })) });
  if (!started.ok) throw new Error(`the fixture upload was refused: ${started.code}`);

  return started.upload.id;
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
});
