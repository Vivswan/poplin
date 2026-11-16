import { describe, expect, spyOn, test } from "bun:test";

import { abandonPublish } from "../../src/actions/abandon-publish";
import { beginPublish } from "../../src/actions/begin-publish";
import { duplicateSite } from "../../src/actions/duplicate";
import { finishPublish } from "../../src/actions/finish-publish";
import { listSites } from "../../src/actions/list";
import { publishSite } from "../../src/actions/publish";
import { getSite } from "../../src/actions/show";
import { sweepExpired } from "../../src/actions/sweep";
import { uploadFile } from "../../src/actions/upload-file";
import { dayOf } from "../../src/records/views";
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

  // Drift: every stored file is a bucket operation the host bills past a monthly amount, and an upload's whole list of files is read as it begins. Unbounded, a loop of publishes runs up a bill and one large publish may not start at all.
  test("one publish declares at most max_files_per_publish files, and the uploads begun in one UTC day at most max_files_per_day together, a copy's among them", async () => {
    const world = await makeWorld({ max_files_per_publish: 3, max_files_per_day: 5 });
    const pages = (paths: readonly string[]): object[] => paths.map((path) => ({ ...PAGE, path }));
    const large = await beginPublish(world.install, OWNER, { name: "large", files: pages(["index.html", "a.html", "b.html", "c.html"]) });
    const report = await finishPublish(world.install, OWNER, await staged(world, { name: "report" }, ["index.html", "about.html"]));
    if (!report.ok) throw new Error(`the fixture publish was refused: ${report.code}`);

    const copied = await duplicateSite(world.install, OWNER, { site: report.site.id }, 1);
    const over = await beginPublish(world.install, OWNER, { name: "two", files: pages(["index.html", "about.html"]) });
    const early = await world.install.database.listProblems(dayOf(world.clock.now));
    const last = await beginPublish(world.install, OWNER, { name: "two", files: [PAGE] });
    const copy = await duplicateSite(world.install, OWNER, { site: report.site.id }, 1);
    world.clock.now += DAY;
    const tomorrow = await beginPublish(world.install, OWNER, { name: "three", files: pages(["index.html", "about.html"]) });

    expect([large, over, copy]).toEqual([
      { ok: false, code: "too_large", about: "max_files_per_publish" },
      { ok: false, code: "too_large", about: "max_files_per_day" },
      { ok: false, code: "too_large", about: "max_files_per_day" },
    ]);
    expect([copied.ok, last.ok, tomorrow.ok]).toEqual([true, true, true]);
    // An upload too large for the one file the day had left is no problem of the install: a smaller one still fit. The limit is noted once, by the first upload refused when no file was left.
    expect(early).toEqual([]);
    expect((await world.install.database.listProblems(dayOf(world.clock.now - DAY))).map(({ day, kind, count }) => [day, kind, count])).toEqual([[dayOf(world.clock.now - DAY), "files_limit_reached", 1]]);
  });

  // Drift: a host bills every write to its store past a month's free amount. A file counted when it is sent would cost the database a row a file; one never counted, or a copy counted once, would let a day pass the bound.
  test("the day's writes to the store count every declared file as its upload begins, a copy's files twice, and an upload that does not fit is refused until the next UTC day", async () => {
    const world = await makeWorld({ max_storage_writes_per_day: 9 });
    const pages = (count: number): object[] => Array.from({ length: count }, (_page, at) => ({ ...PAGE, path: at === 0 ? "index.html" : `page-${at}.html` }));
    const day = dayOf(world.clock.now);
    const report = await finishPublish(world.install, OWNER, await staged(world, { name: "report" }, ["index.html", "about.html"]));
    if (!report.ok) throw new Error(`the fixture publish was refused: ${report.code}`);

    const copied = await duplicateSite(world.install, OWNER, { site: report.site.id }, 1);
    const four = await beginPublish(world.install, OWNER, { name: "four", files: pages(4) });
    const copy = await duplicateSite(world.install, OWNER, { site: report.site.id }, 1);
    const early = await world.install.database.listProblems(day);
    const three = await beginPublish(world.install, OWNER, { name: "three", files: pages(3) });
    const one = await beginPublish(world.install, OWNER, { name: "one", files: pages(1) });
    const counted = await world.install.database.readStorageWrites(day);
    world.clock.now += DAY;
    const tomorrow = await beginPublish(world.install, OWNER, { name: "four", files: pages(4) });

    const spent = { ok: false, code: "allowance_spent", about: "max_storage_writes_per_day" };
    expect<unknown>([copied.ok, four, copy, three.ok, one, tomorrow.ok]).toEqual([true, spent, spent, true, spent, true]);
    expect(counted).toEqual({ writes: 9, most: 9 });
    // The two refused while three writes were left noted nothing: the limit is noted by the one refused when none was left.
    expect(early).toEqual([]);
    expect((await world.install.database.listProblems(day)).map(({ day: noted, kind, count }) => [noted, kind, count])).toEqual([[day, "writes_limit_reached", 1]]);
  });

  // Drift: serving reads the store for a `404.html`, and for a file without an extension, only when the live version's record says it holds one. A record made from another list than the files published would hide a file or cost every miss a read.
  test("a version is recorded with what its own files say it holds: a new site's, the next version's, and the first one's again after a rollback", async () => {
    const world = await makeWorld();
    const first = await publishSite(world.install, OWNER, { name: "report", files: [file("index.html", "home"), file("404.html", "lost"), file("LICENSE", "terms"), file("docs/README", "read")] });
    if (!first.ok) throw new Error(`the fixture publish was refused: ${first.code}`);

    const holds = async (): Promise<unknown> => (await world.install.database.findServed({ id: first.site.id }, world.clock.now))?.contents;
    const contents = [await holds()];
    await publishSite(world.install, OWNER, { site: first.site.id, files: [file("index.html", "home again")] });
    contents.push(await holds());
    await world.install.database.setLiveVersion(first.site.id, 1, { by: ADMIN.holder, at: world.clock.now });
    contents.push(await holds());

    const held = { missing_page: true, bare_files: "\nLICENSE\ndocs/README\n" };
    expect(contents).toEqual([held, { missing_page: false, bare_files: "" }, held]);
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
    { how: "was given up", ending: "abandon", lands: "after the ending", stored: true, kept: ["v1"], left: [] },
    { how: "ran out", ending: "expire", lands: "before the ending", stored: false, kept: [], left: [] },
    { how: "was swept unfinished", ending: "sweep", lands: "before the ending", stored: false, kept: [], left: [] },
    { how: "was finished and then swept", ending: "finish", lands: "before the ending", stored: true, kept: ["v1"], left: ["v1"] },
  ] as const)("a file whose bytes reach the store while its upload $how is kept only as part of a live version once the sweep has been", async ({ ending, lands, stored, kept, left }) => {
    const world = await makeWorld();
    const begun = await beginPublish(world.install, OWNER, { name: "report", files: [PAGE] });
    if (!begun.ok) throw new Error("the fixture upload was refused");

    const upload = begun.upload.id;
    const spied = spyOn(world.install.store, "write");
    const write = spied.getMockImplementation();
    if (write === undefined) throw new Error("the fixture store has no write to wrap");

    spied.mockImplementation(async (...given) => {
      if (lands === "after the ending") await ENDINGS[ending](world, upload);
      const written = await write(...given);
      if (lands === "before the ending") await ENDINGS[ending](world, upload);

      return written;
    });
    const late = await uploadFile(world.install, OWNER, { upload, path: PAGE.path, body: new Blob(["page"]).stream() });
    const held = await versions(world);
    await ENDINGS.sweep(world, upload);

    expect([late.ok, held, await versions(world)]).toEqual([stored, [...kept], [...left]]);
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
