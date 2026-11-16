import { describe, expect, spyOn, test } from "bun:test";

import { abandonPublish } from "../../src/actions/abandon-publish";
import { beginPublish } from "../../src/actions/begin-publish";
import { finishPublish } from "../../src/actions/finish-publish";
import { issueTickets } from "../../src/actions/issue-tickets";
import type { Install } from "../../src/actions/records";
import { uploadFile } from "../../src/actions/upload-file";
import type { Tickets } from "../../src/storage/tickets";
import { DAY, makeWorld, NOW, OWNER, PAGE_SHA256, STRANGER, type World } from "./support/actions-fixture";

/** An upload id no upload has. */
const NO_UPLOAD = "0000000000000000";

/** A stand-in for whatever hands out an install's tickets: each ticket shows the key, the size and the hash it was asked with, so a test reads what the action passed on. */
const SHOWN: Tickets = {
  async issue(upload, files) {
    return files.map(({ file, key }) => ({ path: file.path, url: `https://files.example.com/${key}`, method: "PUT" as const, headers: { "Content-Length": String(file.size), Hash: file.sha256 }, expires: upload.expires }));
  },
};

function ticketed(world: World): Install {
  return { ...world.install, tickets: SHOWN };
}

/** The paths of a publish of so many pages of four bytes, `index.html` first. */
function pathsOf(count: number): string[] {
  return ["index.html", ...Array.from(Array(count - 1).keys(), (index) => `pages/${index}.html`)];
}

async function begun(install: Install, count: number): Promise<Extract<Awaited<ReturnType<typeof beginPublish>>, { readonly ok: true }>> {
  const files = pathsOf(count).map((path) => ({ path, size: 4, content_type: "text/html", sha256: PAGE_SHA256 }));
  const started = await beginPublish(install, OWNER, { name: `site-${count}`, files });
  if (!started.ok) throw new Error(`the fixture upload was refused: ${started.code}`);

  return started;
}

describe("the tickets of an upload", () => {
  // Drift: a publisher sends each file where its ticket says. A ticket that named another file's key, another size or hash, or outlived its upload would let bytes land where the manifest never put them.
  test("an upload of 100 files begins with a ticket for every file, in the manifest's order, each for the file's own key, size and hash, and none outliving the upload", async () => {
    const world = await makeWorld();
    const started = await begun(ticketed(world), 100);
    const folder = (await world.install.database.getUploadFile(started.upload.id, ""))?.upload.folder;

    expect(started.tickets?.map((ticket) => ticket.path)).toEqual(pathsOf(100));
    expect(started.tickets?.at(-1)).toEqual({
      path: "pages/98.html",
      url: `https://files.example.com/${folder}/v1/pages/98.html`,
      method: "PUT",
      headers: { "Content-Length": "4", Hash: PAGE_SHA256 },
      expires: NOW + DAY,
    });
  });

  // Drift: tickets are asked for as the files go, a hundred a call. A call that wrote, or touched the store, or read the manifest whole would cost a long publish what the tickets save it.
  test("tickets are answered in the order asked, from one read of the database, with no write and no call to the store", async () => {
    const world = await makeWorld();
    const { upload } = await begun(ticketed(world), 5000);
    const calls: string[] = [];
    const database = new Proxy(world.install.database, {
      get(target, name): unknown {
        const member: unknown = Reflect.get(target, name, target);
        if (typeof member !== "function") return member;

        return (...given: unknown[]): unknown => {
          calls.push(String(name));

          return Reflect.apply(member, target, given);
        };
      },
    });
    const store = ["head", "read", "write", "list", "delete", "deleteMany"].map((method) => spyOn(world.install.store, method as "head"));
    const before = store.map((spy) => spy.mock.calls.length);

    const issued = await issueTickets({ ...ticketed(world), database }, OWNER, { upload: upload.id, paths: ["pages/4998.html", "index.html", "pages/7.html"] });

    expect(issued.ok ? issued.tickets.map((ticket) => [ticket.path, ticket.url.split("/v1/")[1], ticket.headers]) : issued).toEqual([
      ["pages/4998.html", "pages/4998.html", { "Content-Length": "4", Hash: PAGE_SHA256 }],
      ["index.html", "index.html", { "Content-Length": "4", Hash: PAGE_SHA256 }],
      ["pages/7.html", "pages/7.html", { "Content-Length": "4", Hash: PAGE_SHA256 }],
    ]);
    expect([calls, store.map((spy) => spy.mock.calls.length)]).toEqual([["getUploadFiles"], before]);
  });

  // Drift: a ticket is leave to write one file. One handed to another publisher, for a path nobody declared, or for an upload that is over would be leave to write what no publish holds.
  test("no ticket is handed out for an upload that is not there, another publisher's, finished, given up or run out, nor when one path of the call is not the manifest's", async () => {
    const world = await makeWorld();
    const install = ticketed(world);
    const [open, live, dropped] = [await begun(install, 3), await begun(install, 1), await begun(install, 2)];
    await uploadFile(install, OWNER, { upload: live.upload.id, path: "index.html", body: new Blob(["page"]).stream() });
    await finishPublish(install, OWNER, live.upload.id);
    await abandonPublish(install, OWNER, dropped.upload.id);
    const ask = (actor: typeof OWNER, upload: string, paths: readonly string[]): ReturnType<typeof issueTickets> => issueTickets(install, actor, { upload, paths });

    const refused = [
      await ask(OWNER, "no id", ["index.html"]),
      await ask(OWNER, NO_UPLOAD, ["index.html"]),
      await ask(STRANGER, open.upload.id, ["index.html"]),
      await ask(OWNER, open.upload.id, ["index.html", "pages/2.html"]),
      await ask(OWNER, live.upload.id, ["index.html"]),
      await ask(OWNER, dropped.upload.id, ["index.html"]),
    ];
    world.clock.now = NOW + DAY;
    refused.push(await ask(OWNER, open.upload.id, ["index.html"]));

    expect(refused.map((answer) => (answer.ok ? "tickets" : `${answer.code} ${answer.about}`))).toEqual([
      "bad_argument upload",
      "not_found upload",
      "not_found upload",
      "not_found path",
      "upload_finished upload",
      "not_found upload",
      "not_found upload",
    ]);
  });
});
