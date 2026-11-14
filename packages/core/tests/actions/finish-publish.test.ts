import { describe, expect, spyOn, test } from "bun:test";

import { abandonPublish } from "../../src/actions/abandon-publish";
import { beginPublish } from "../../src/actions/begin-publish";
import { finishPublish } from "../../src/actions/finish-publish";
import { listSites } from "../../src/actions/list";
import { publishSite } from "../../src/actions/publish";
import { getSite } from "../../src/actions/show";
import { sweepExpired } from "../../src/actions/sweep";
import { uploadFile } from "../../src/actions/upload-file";
import { ADMIN, DAY, file, made, makeWorld, OWNER, STRANGER, type World } from "./support/actions-fixture";

/** The one page a fixture upload declares: four bytes. */
const PAGE = { path: "index.html", size: 4, content_type: "text/html" };

/** The ways an upload stops taking files while one of its files is still on its way in. */
const ENDINGS: Readonly<Record<"abandon" | "expire" | "sweep" | "finish", (world: World, upload: string) => Promise<void>>> = {
  abandon: async (world, upload) => {
    await abandonPublish(world.install, OWNER, upload);
  },
  expire: async (world) => {
    world.clock.now += DAY;
  },
  sweep: async (world) => {
    world.clock.now += 2 * DAY;
    await sweepExpired(world.install, ADMIN, { limit: 10, from: { uploads: true } });
  },
  finish: async (world, upload) => {
    await finishPublish(world.install, OWNER, upload);
    await ENDINGS.sweep(world, upload);
  },
};

/** Begin a publish of pages of four bytes each and send them all; answers the upload's id. */
async function staged(world: World, asked: object, paths: readonly string[] = [PAGE.path]): Promise<string> {
  const begun = await beginPublish(world.install, OWNER, { ...asked, files: paths.map((path) => ({ ...PAGE, path })) });
  if (!begun.ok) throw new Error(`the fixture upload was refused: ${begun.code}`);

  for (const path of paths) await uploadFile(world.install, OWNER, { upload: begun.upload.id, path, body: new Blob(["page"]).stream() });

  return begun.upload.id;
}

/** The version folders the store holds files under, in order. */
async function versions(world: World): Promise<string[]> {
  return (await world.keys()).map((key) => key.split("/")[1] ?? "").sort();
}

describe("finishPublish", () => {
  // Drift: a client that hears nothing back sends its finish again while the first is still at work; two rows for one upload would be two sites, or one version published twice.
  test("two finishes of one upload at the same moment make one site and one version, and both answer with it", async () => {
    const world = await makeWorld();
    const created = await staged(world, { name: "report" });
    const [first, second] = await Promise.all([finishPublish(world.install, OWNER, created), finishPublish(world.install, OWNER, created)]);
    if (!first.ok || !second.ok) throw new Error("a finish was refused");

    const updated = await staged(world, { site: first.site.id, title: "Q3 sales" });
    const both = await Promise.all([finishPublish(world.install, OWNER, updated), finishPublish(world.install, ADMIN, updated)]);
    const listed = await listSites(world.install, ADMIN);

    expect([first.site.id, first.site.created, second.site.created, listed.ok && listed.sites.length]).toEqual([second.site.id, true, true, 1]);
    expect(both).toMatchObject([{ site: { live_version: 2, title: "Q3 sales", created: false } }, { site: { live_version: 2, title: "Q3 sales", created: false } }]);
    expect([await world.audit(), await versions(world)]).toEqual([["create", "details", "publish"], ["v1", "v2"]]);
  });

  // Drift: an abandon removes files and a finish makes them live; whichever loses must leave the other's outcome whole, or a live site is served with its files gone.
  test.each([
    ["the finish first", ["finish", "abandon"]],
    ["the abandon first", ["abandon", "finish"]],
  ] as const)("a finish and an abandon of one upload at the same moment, %s, end with the site live and its files there, or no site and no file", async (_order, order) => {
    const world = await makeWorld();
    const upload = await staged(world, { name: "report" }, ["index.html", "about.html"]);
    const steps = { finish: () => finishPublish(world.install, OWNER, upload), abandon: () => abandonPublish(world.install, OWNER, upload) };

    const answers = await Promise.all(order.map((step) => steps[step]()));
    const listed = await listSites(world.install, ADMIN);
    const live = listed.ok && listed.sites.length === 1;

    expect(answers.filter((answer) => answer.ok).length).toBeGreaterThanOrEqual(1);
    expect([live, (await world.keys()).length]).toEqual(live ? [true, 2] : [false, 0]);
    expect(await finishPublish(world.install, OWNER, upload)).toMatchObject(live ? { ok: true, site: { created: true } } : { ok: false, code: "not_found", about: "upload" });
  });

  // Drift: an abandon reads the upload before it marks it; a finish that lands between the two has made the files live, and removing them then would break the site it just made.
  test("an abandon that finds its upload finished in the meantime removes no file of the live site", async () => {
    const world = await makeWorld();
    const upload = await staged(world, { name: "report" }, ["index.html", "about.html"]);
    const abandon = world.install.database.abandonUpload.bind(world.install.database);
    spyOn(world.install.database, "abandonUpload").mockImplementation(async (id) => {
      await finishPublish(world.install, OWNER, upload);

      return abandon(id);
    });

    expect(await abandonPublish(world.install, OWNER, upload)).toEqual({ ok: true, left: [] });
    expect([(await world.keys()).length, await finishPublish(world.install, OWNER, upload)]).toMatchObject([2, { ok: true, site: { created: true } }]);
  });

  // Drift: a pending upload's files are in the bucket already; limits that counted live sites alone would let a token fill the bucket with uploads it never finishes.
  test("the size and the site-count limits count every pending upload, and stop counting one that is given up", async () => {
    const world = await makeWorld({ max_total_size: { count: 10, unit: "B" }, max_sites: 2 });
    const first = await staged(world, { name: "one" }, ["index.html", "about.html"]);
    const sized = await beginPublish(world.install, OWNER, { name: "two", files: [PAGE] });
    await abandonPublish(world.install, OWNER, first);
    const second = await staged(world, { name: "two" });
    const third = await staged(world, { name: "three" });
    const counted = await beginPublish(world.install, STRANGER, { name: "four", files: [{ ...PAGE, size: 1 }] });

    expect([sized, counted]).toEqual([
      { ok: false, code: "too_large", about: "max_total_size" },
      { ok: false, code: "too_many_sites", about: "max_sites" },
    ]);
    expect([(await finishPublish(world.install, OWNER, second)).ok, (await finishPublish(world.install, OWNER, third)).ok]).toEqual([true, true]);
  });

  // Drift: a pending upload keeps its manifest in the database; a token that could begin uploads without end would fill it, a megabyte a request.
  test("one holder has at most 20 uploads pending, and an upload given up or finished makes room", async () => {
    const world = await makeWorld();
    const uploads: string[] = [];
    for (let at = 0; at < 20; at += 1) uploads.push(await staged(world, { name: "report" }));

    const over = await beginPublish(world.install, OWNER, { name: "report", files: [PAGE] });
    const others = await beginPublish(world.install, STRANGER, { name: "report", files: [PAGE] });
    await abandonPublish(world.install, OWNER, uploads[0] ?? "");
    await finishPublish(world.install, OWNER, uploads[1] ?? "");

    expect([over, others.ok]).toEqual([{ ok: false, code: "too_large", about: "max_pending_uploads" }, true]);
    expect([await staged(world, { name: "report" }), await staged(world, { name: "report" })]).toHaveLength(2);
    expect(await beginPublish(world.install, OWNER, { name: "report", files: [PAGE] })).toMatchObject({ ok: false, about: "max_pending_uploads" });
  });

  // Drift: two uploads to one site are each measured against the versions that stay; measured apart, both would go live and the site would hold more than `max_site_size`.
  test("two pending uploads to one site are measured together against the site's size limit", async () => {
    const world = await makeWorld({ versions_kept: 2, max_site_size: { count: 10, unit: "B" } });
    const site = await publishSite(world.install, OWNER, { files: [file("index.html", "page")], name: "report" });
    if (!site.ok) throw new Error("the fixture site was refused");

    const sized = { ...PAGE, size: 6 };
    const first = await beginPublish(world.install, OWNER, { site: site.site.id, files: [sized] });
    const second = await beginPublish(world.install, OWNER, { site: site.site.id, files: [sized] });
    const begun = await Promise.all([beginPublish(world.install, OWNER, { name: "one", files: [sized] }), beginPublish(world.install, OWNER, { name: "two", files: [sized] })]);

    expect([first.ok, second, begun.map((answer) => answer.ok)]).toEqual([true, { ok: false, code: "too_large", about: "max_site_size" }, [true, true]]);
  });

  // Drift: a body that dribbles in for hours outlives its upload; a file stored after the record went would sit in the bucket under nothing for good, and one removed from a live version would break a site.
  test.each([
    ["was given up", "abandon", []],
    ["ran out", "expire", []],
    ["was swept unfinished", "sweep", []],
    ["was finished and then swept", "finish", ["v1"]],
  ] as const)("a file whose bytes reach the store after its upload %s is kept only as part of a live version", async (_how, how, kept) => {
    const world = await makeWorld();
    const begun = await beginPublish(world.install, OWNER, { name: "report", files: [PAGE] });
    if (!begun.ok) throw new Error("the fixture upload was refused");

    const upload = begun.upload.id;
    // The upload ends between the write of the file and the look the action takes after it: the second read of the upload.
    const read = world.install.database.getUploadFile.bind(world.install.database);
    let reads = 0;
    spyOn(world.install.database, "getUploadFile").mockImplementation(async (id, path) => {
      reads += 1;
      if (reads === 2) await ENDINGS[how](world, upload);

      return read(id, path);
    });
    const late = await uploadFile(world.install, OWNER, { upload, path: PAGE.path, body: new Blob(["page"]).stream() });

    expect([late.ok, await versions(world)]).toEqual([kept.length > 0, [...kept]]);
  });

  // Drift: a site that stops keeping many versions at once leaves more prefixes than one removal walks; a removal that started over each time would never reach the last of them.
  test("the files of more dropped versions than one removal walks all go, over as many finishes as it takes", async () => {
    const world = await makeWorld({ versions_kept: 13 });
    const site = await made(world, OWNER, "report");
    for (let version = 2; version <= 12; version += 1) await publishSite(world.install, OWNER, { files: [file("index.html", "page")], site });
    await world.install.database.changeSettings({ versions_kept: 1 }, { by: ADMIN.holder, at: world.clock.now });
    const upload = await staged(world, { site });

    const first = await finishPublish(world.install, OWNER, upload);
    const second = await finishPublish(world.install, OWNER, upload);

    expect([first.ok && first.left.length, second.ok && second.left, await versions(world)]).toEqual([2, [], ["v13"]]);
  });

  // Drift: the files of dropped versions are removed after the row is written; a crash or a failing store there must leave a record that a later finish, or the sweep, works off.
  test("a finish that could not remove the dropped versions' files names them, and asking again removes them", async () => {
    const world = await makeWorld({ versions_kept: 3 });
    const site = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { files: [file("index.html", "two")], site });
    await publishSite(world.install, OWNER, { files: [file("index.html", "three")], site });
    await world.install.database.changeSettings({ versions_kept: 1 }, { by: ADMIN.holder, at: world.clock.now });
    const upload = await staged(world, { site });
    world.faults.failRemoval = true;

    const first = await finishPublish(world.install, OWNER, upload);
    const during = await versions(world);
    world.faults.failRemoval = false;
    const second = await finishPublish(world.install, OWNER, upload);

    expect(first).toMatchObject({ ok: true, site: { live_version: 4, versions: [{ number: 4 }] }, left: [expect.stringMatching(/\/v1\/$/), expect.stringMatching(/\/v2\/$/), expect.stringMatching(/\/v3\/$/)] });
    expect([during, second.ok && second.left, await versions(world)]).toEqual([["v1", "v1", "v2", "v3", "v4"], [], ["v4"]]);
    expect(await getSite(world.install, OWNER, site)).toMatchObject({ site: { live_version: 4 } });
  });

  // Drift: an upload is its owner's until it is live; a publisher that could send a file into another's upload, or finish it, would publish under another's name.
  test("another publisher finds no upload to send a file to, to finish, or to abandon, and an admin finds it", async () => {
    const world = await makeWorld();
    const upload = await staged(world, { name: "report" });
    const answers = [
      await uploadFile(world.install, STRANGER, { upload, path: "index.html", body: new Blob(["evil"]).stream() }),
      await finishPublish(world.install, STRANGER, upload),
      await abandonPublish(world.install, STRANGER, upload),
    ];

    expect(answers).toEqual(Array.from({ length: 3 }, () => ({ ok: false, code: "not_found", about: "upload" })) as never);
    expect(await new Response((await world.install.store.read((await world.keys())[0] as never) as { body: ReadableStream }).body).text()).toBe("page");
    expect(await finishPublish(world.install, ADMIN, upload)).toMatchObject({ ok: true, site: { versions: [{ published_by: OWNER.holder }] } });
    expect([(await listSites(world.install, OWNER)).ok && (await listSites(world.install, OWNER)), await world.audit()]).toMatchObject([{ sites: [{ name: "report" }] }, ["create"]]);
  });
});
