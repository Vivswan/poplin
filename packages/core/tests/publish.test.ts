import { describe, expect, spyOn, test } from "bun:test";

import { getSite } from "../src/actions/show";
import { listSites } from "../src/actions/list";
import { publishSite } from "../src/actions/publish";
import { deleteSite } from "../src/actions/delete";
import { ADMIN, DAY, file, made, makeWorld, NOW, OWNER, pages, type World } from "./actions-fixture";

type Request = Parameters<typeof publishSite>[2];

/** A refused publish: the settings of the install, what is asked, and the refusal. `onto` asks for an update of the fixture site, by its id unless a reference is given. */
type RefusedRow = readonly [why: string, settings: NonNullable<Parameters<typeof makeWorld>[0]>, request: Omit<Request, "site"> & { onto?: true | string }, refusal: object];

async function textAt(world: World, key: string): Promise<string | undefined> {
  const read = await world.install.store.read(key as Parameters<World["install"]["store"]["read"]>[0]);
  if (read.kind !== "found") return undefined;

  return new Response(read.body).text();
}

async function siteCount(world: World): Promise<number> {
  const listed = await listSites(world.install, ADMIN);

  return listed.ok ? listed.sites.length : -1;
}

describe("publishSite", () => {
  // Drift: the site object is the published contract of the CLI's `--json` and of every MCP tool; a field renamed, dropped, or built from the wrong column breaks every caller at once.
  test("a publish with no site makes a new private site each time, though the name repeats", async () => {
    const world = await makeWorld();
    const first = await publishSite(world.install, OWNER, { files: pages("one"), name: "report" });
    const second = await publishSite(world.install, OWNER, { files: pages("two"), name: "report" });
    if (!first.ok || !second.ok) throw new Error("a publish was refused");

    const { id } = first.site;
    const address = `https://report--${id}-page.example.com`;

    expect(first).toEqual({
      ok: true,
      left: [],
      before: null,
      site: {
        id,
        label: `report--${id}`,
        name: "report",
        public_name: null,
        title: null,
        access: "private",
        url: address,
        addresses: { site: address, public: null },
        search_engines: false,
        embeddable: true,
        expires: "never",
        versions: [{ number: 1, published: NOW, published_by: OWNER.holder }],
        live_version: 1,
        bytes: 9,
        files: 2,
        updated: NOW,
        state: "live",
        created: true,
      },
    } as never);
    expect(second.site.id).not.toBe(id);
    expect(await siteCount(world)).toBe(2);
    expect(await world.audit()).toEqual(["create", "create"]);
    expect((await world.keys()).length).toBe(4);
  });

  // Drift: a new site that ignored the install's defaults would stay up forever on an install set to expire its sites.
  test("a new site takes the install's default expiry and search-engines flag, and the settings asked for win over them", async () => {
    const world = await makeWorld({ default_expires: { count: 7, unit: "d" }, default_search_engines: true });
    const byDefault = await publishSite(world.install, OWNER, { files: pages("one"), name: "report" });
    const asked = await publishSite(world.install, OWNER, {
      files: pages("two"),
      name: "demo",
      access: "public",
      public_name: "docs",
      title: "Q3 sales",
      search_engines: false,
      embeddable: false,
      expires: "never",
    });

    expect(byDefault).toMatchObject({ site: { expires: NOW + 7 * DAY, search_engines: true } });
    expect(asked).toMatchObject({
      site: {
        access: "public",
        public_name: "docs",
        url: "https://docs-page.example.com",
        addresses: { public: "https://docs-page.example.com" },
        title: "Q3 sales",
        search_engines: false,
        embeddable: false,
        expires: "never",
      },
    });
  });

  // Drift: an update that reset the access would turn a shared link private, or a private site public, on every republish.
  test("a publish onto a site adds a live version and leaves its access, settings, and address as they were", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report", { access: "unlisted", title: "Q3 sales" });
    const before = await getSite(world.install, OWNER, id);
    const updated = await publishSite(world.install, OWNER, { files: [file("index.html", "report v2")], site: `report--${id}` });
    if (!before.ok || !updated.ok) throw new Error("the fixture was refused");

    const { folder } = { folder: (await world.keys())[0]?.split("/")[0] };

    expect(updated.site).toEqual({
      ...before.site,
      created: false,
      live_version: 2,
      bytes: before.site.bytes + 9,
      files: 3,
      versions: [...before.site.versions, { number: 2, published: NOW, published_by: OWNER.holder }],
    } as never);
    expect(updated.before).toEqual(before.site);
    expect(await world.audit()).toEqual(["create", "publish"]);
    expect(await world.keys()).toEqual([`${folder}/v1/css/site.css`, `${folder}/v1/index.html`, `${folder}/v2/index.html`]);
    expect(await textAt(world, `${folder}/v2/index.html`)).toBe("report v2");
  });

  // Drift: settings on an update are applied by the same publish; one that dropped them would publish new content under the old access without a word.
  test("an update that asks for settings applies them with the version, each change with its own audit entry", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    const updated = await publishSite(world.install, OWNER, { files: pages("report v2"), site: id, access: "public", title: "Q3 sales" });

    expect(updated).toMatchObject({ ok: true, site: { access: "public", public_name: "report", title: "Q3 sales", live_version: 2, created: false } });
    expect(await world.audit()).toEqual(["create", "access", "details", "publish"]);
  });

  // Drift: each row is a publish that must leave nothing behind; the store throws on its first write here, so a check that moved after the upload fails the row.
  test.each([
    ["no index.html at the top", {}, { files: [file("docs/index.html", "x")], name: "report" }, { code: "no_index" }],
    ["a path that climbs out of the site", {}, { files: [...pages("x"), file("../other/index.html", "x")], name: "report" }, { code: "bad_path", about: "../other/index.html" }],
    ["a path with an empty segment", {}, { files: [...pages("x"), file("css//site.css", "x")], name: "report" }, { code: "bad_path", about: "css//site.css" }],
    ["a path no address reaches", {}, { files: [...pages("x"), file("docs\\guide.html", "x")], name: "report" }, { code: "bad_path", about: "docs\\guide.html" }],
    ["a path given twice", {}, { files: [...pages("x"), file("index.html", "y")], name: "report" }, { code: "bad_path", about: "index.html" }],
    ["a size that is no byte count", {}, { files: [file("index.html", "x", -1)], name: "report" }, { code: "bad_argument", about: "files" }],
    ["a name that breaks the name rules", {}, { files: pages("x"), name: "Report" }, { code: "bad_name", about: "name" }],
    ["no name and no site", {}, { files: pages("x") }, { code: "bad_argument", about: "name" }],
    ["a name on an update", {}, { files: pages("x"), name: "other", onto: true }, { code: "bad_argument", about: "name" }],
    ["a public name another site holds", {}, { files: pages("x"), name: "report", access: "public", public_name: "taken" }, { code: "name_taken", about: "public_name" }],
    ["an update to a public name another site holds", {}, { files: pages("x"), onto: true, access: "public", public_name: "taken" }, { code: "name_taken", about: "public_name" }],
    ["the gallery's public name", {}, { files: pages("x"), name: "gallery", access: "public" }, { code: "reserved_name", about: "public_name" }],
    ["a public name with no public access", {}, { files: pages("x"), name: "report", public_name: "docs" }, { code: "bad_argument", about: "public_name" }],
    ["an expiry in no known form", {}, { files: pages("x"), name: "report", expires: "soon" }, { code: "bad_argument", about: "expires" }],
    ["a setting that does not exist", {}, { files: pages("x"), name: "report", colour: "red" } as never, { code: "bad_argument", about: "colour" }],
    ["a site that does not exist", {}, { files: pages("x"), onto: "zzzzzzzzzzzz" }, { code: "not_found" }],
    ["a reference that is none", {}, { files: pages("x"), onto: "./report" }, { code: "bad_argument", about: "site" }],
  ] as readonly RefusedRow[])("a publish with %s is refused before any file is written", async (_why, settings, request, refusal) => {
    const world = await makeWorld();
    await made(world, ADMIN, "taken", { access: "public" });
    const id = await made(world, OWNER, "first");
    await world.install.database.changeSettings(settings, { by: ADMIN.holder, at: NOW });
    const [keys, audit] = [await world.keys(), await world.audit()];
    world.faults.failWrite = 5;

    const { onto, ...asked } = request;
    const site = onto === true ? id : onto;
    const refused = await publishSite(world.install, OWNER, site === undefined ? asked : { ...asked, site });

    expect(refused).toEqual({ ok: false, ...refusal } as never);
    expect([await world.keys(), await world.audit(), await siteCount(world)]).toEqual([keys, audit, 2]);
  });

  // Drift: the limits keep an install inside its bucket's free tier; one counted against the wrong sum would refuse a publish that fits, or let the bucket fill.
  test.each([
    ["one site, a new site under", { max_site_size: { count: 50, unit: "B" } }, { bytes: 49 }, true],
    ["one site, a new site at", { max_site_size: { count: 50, unit: "B" } }, { bytes: 50 }, true],
    ["one site, a new site over", { max_site_size: { count: 50, unit: "B" } }, { bytes: 51 }, { code: "too_large", about: "max_site_size" }],
    ["one site, an update under, beside the version that stays", { max_site_size: { count: 50, unit: "B" } }, { bytes: 29, onto: true }, true],
    ["one site, an update at", { max_site_size: { count: 50, unit: "B" } }, { bytes: 30, onto: true }, true],
    ["one site, an update over", { max_site_size: { count: 50, unit: "B" } }, { bytes: 31, onto: true }, { code: "too_large", about: "max_site_size" }],
    ["all sites, under, the trash counted", { max_total_size: { count: 100, unit: "B" } }, { bytes: 39 }, true],
    ["all sites, at", { max_total_size: { count: 100, unit: "B" } }, { bytes: 40, onto: true }, true],
    ["all sites, a new site over", { max_total_size: { count: 100, unit: "B" } }, { bytes: 41 }, { code: "too_large", about: "max_total_size" }],
    ["all sites, an update over", { max_total_size: { count: 100, unit: "B" } }, { bytes: 41, onto: true }, { code: "too_large", about: "max_total_size" }],
    ["the count of sites, under", { max_sites: 3 }, { bytes: 1 }, true],
    ["the count of sites, at, the trash counted", { max_sites: 2 }, { bytes: 1 }, { code: "too_many_sites", about: "max_sites" }],
    ["the count of sites, over", { max_sites: 1 }, { bytes: 1 }, { code: "too_many_sites", about: "max_sites" }],
    ["the count of sites, an update at", { max_sites: 2 }, { bytes: 1, onto: true }, true],
  ] as readonly (readonly [string, NonNullable<Parameters<typeof makeWorld>[0]>, { bytes: number; onto?: true }, true | object])[])(
    "the limit on %s is held: a publish that fits is made, and one that does not is refused before any write",
    async (_which, limit, publish, outcome) => {
      // The install keeps two versions. One site holds versions of 10 and 20 bytes; a site of 30 bytes sits in the trash: 60 bytes and 2 sites in all.
      const world = await makeWorld({ versions_kept: 2 });
      const sized = (bytes: number): Request["files"] => [file("index.html", "x".repeat(bytes))];
      const first = await publishSite(world.install, OWNER, { files: sized(10), name: "report" });
      const trashed = await publishSite(world.install, OWNER, { files: sized(30), name: "old" });
      if (!first.ok || !trashed.ok) throw new Error("the fixture was refused");

      await publishSite(world.install, OWNER, { files: sized(20), site: first.site.id });
      await deleteSite(world.install, OWNER, { site: trashed.site.id });
      await world.install.database.changeSettings(limit, { by: ADMIN.holder, at: NOW });
      const keys = await world.keys();
      if (outcome !== true) world.faults.failWrite = 4;

      const asked = publish.onto === true ? { files: sized(publish.bytes), site: first.site.id } : { files: sized(publish.bytes), name: "next" };
      const answer = await publishSite(world.install, OWNER, asked);

      expect(answer).toMatchObject(outcome === true ? { ok: true } : { ok: false, ...outcome });
      expect((await world.keys()).length).toBe(outcome === true ? keys.length + 1 - (publish.onto === true ? 1 : 0) : keys.length);
    },
  );

  // Drift: the sizes the database keeps are what the limits and the dashboard read; a version recorded with the wrong bytes would skew both for as long as it is kept.
  test("each version is recorded with the bytes and the count of the files it stored", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { files: [file("index.html", "twelve bytes")], site: id });
    const site = await world.install.database.getSite(id as never);

    expect(site?.versions.map((version) => [version.number, version.bytes, version.files])).toEqual([
      [1, "report v1".length + "body{}".length, 2],
      [2, 12, 1],
    ]);
    expect(await world.install.database.readTotals()).toEqual({ sites: 1, trashed_sites: 0, bytes: 27, files: 3 });
  });

  // Drift: an update of a site in the trash would put content live behind the owner's back once the site is restored.
  test("an update of a site in the trash is refused", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    await deleteSite(world.install, OWNER, { site: id });
    const keys = await world.keys();

    expect(await publishSite(world.install, OWNER, { files: pages("report v2"), site: id })).toEqual({ ok: false, code: "in_trash" });
    expect([await world.keys(), await world.audit()]).toEqual([keys, ["create", "trash"]]);
  });

  // Drift: a file that is not the size it declared is a truncated or padded page; storing the version would serve it.
  test.each([
    ["longer", 3],
    ["shorter", 40],
  ])("a file whose stream is %s than its declared size refuses the publish, and no file and no row of it stays", async (_which, declared) => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    const [keys, audit] = [await world.keys(), await world.audit()];
    const files = [file("index.html", "report v2"), file("late.html", "twelve bytes", declared), file("never.html", "x")];

    const created = await publishSite(world.install, OWNER, { files, name: "other" });
    const updated = await publishSite(world.install, OWNER, { files, site: id });

    expect([created, updated]).toEqual([
      { ok: false, code: "size_mismatch", about: "late.html" },
      { ok: false, code: "size_mismatch", about: "late.html" },
    ]);
    expect([await world.keys(), await world.audit(), await siteCount(world)]).toEqual([keys, audit, 1]);
    expect(await getSite(world.install, OWNER, id)).toMatchObject({ site: { live_version: 1, versions: [{ number: 1 }] } });
  });

  // Drift: the row is written last so that a store failing midway never leaves a live version with files missing.
  test("an upload that fails midway leaves no row, no change of the live version, and no file of that version", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    const [keys, audit] = [await world.keys(), await world.audit()];

    world.faults.failWrite = 4;
    await expect(publishSite(world.install, OWNER, { files: pages("other v1"), name: "other" })).rejects.toThrow("the store is down");
    world.faults.failWrite = 6;
    await expect(publishSite(world.install, OWNER, { files: pages("report v2"), site: id, access: "public" })).rejects.toThrow("the store is down");

    expect([await world.keys(), await world.audit(), await siteCount(world)]).toEqual([keys, audit, 1]);
    expect(await getSite(world.install, OWNER, id)).toMatchObject({ site: { live_version: 1, access: "private", versions: [{ number: 1 }] } });
  });

  // Drift: the database has the last word on a public name; files uploaded for a publish it then refuses would sit in the bucket under no site.
  test("a public name taken while the files were uploading refuses the publish, and no file and no change of it stays", async () => {
    const world = await makeWorld();
    await made(world, ADMIN, "taken", { access: "public" });
    const id = await made(world, OWNER, "report");
    const [keys, audit] = [await world.keys(), await world.audit()];
    const lookup = spyOn(world.install.database, "getSiteByPublicName").mockResolvedValue(undefined);

    const created = await publishSite(world.install, OWNER, { files: pages("x"), name: "other", access: "public", public_name: "taken" });
    const updated = await publishSite(world.install, OWNER, { files: pages("x"), site: id, access: "public", public_name: "taken", title: "kept out" });
    lookup.mockRestore();

    expect([created, updated]).toEqual([
      { ok: false, code: "name_taken", about: "public_name" },
      { ok: false, code: "name_taken", about: "public_name" },
    ]);
    expect([await world.keys(), await world.audit(), await siteCount(world)]).toEqual([keys, audit, 2]);
    expect(await getSite(world.install, OWNER, id)).toMatchObject({ site: { live_version: 1, access: "private", title: null } });
  });

  // Drift: of two publishes onto one site the one that finishes last must not replace the newer one; its files are then no version at all.
  test("a publish overtaken by a newer one is refused as stale, and its files go", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    const slow = {
      ...file("index.html", "slow"),
      open: () =>
        new ReadableStream<Uint8Array>({
          async start(controller): Promise<void> {
            await publishSite(world.install, OWNER, { files: pages("fast"), site: id });
            controller.enqueue(new TextEncoder().encode("slow"));
            controller.close();
          },
        }),
    };

    expect(await publishSite(world.install, OWNER, { files: [slow], site: id })).toEqual({ ok: false, code: "stale_version" });
    expect(await getSite(world.install, OWNER, id)).toMatchObject({ site: { live_version: 3, versions: [{ number: 1 }, { number: 3 }] } });
    expect((await world.keys()).map((key) => key.split("/")[1])).toEqual(["v1", "v1", "v3", "v3"]);
    expect(await world.audit()).toEqual(["create", "publish"]);
  });

  // Drift: when the files of a failed publish cannot be removed either, a silent return would hide garbage in the bucket for good.
  test("a failed publish whose files cannot be removed says so, and still makes no row", async () => {
    const world = await makeWorld();
    world.faults.failRemoval = true;

    const failed = publishSite(world.install, OWNER, { files: [file("index.html", "x"), file("late.html", "twelve bytes", 3)], name: "report" });

    await expect(failed).rejects.toThrow(/^the publish was not made, and its files under [0-9a-z]{16}\/v1\/ could not all be removed$/);
    expect([await world.audit(), await siteCount(world)]).toEqual([[], 0]);
  });

  // Drift: `versions_kept` bounds what an install stores; a dropped version whose files stayed would fill the bucket unseen.
  test("a site keeps `versions_kept` versions, and the files of a dropped version go with it", async () => {
    const world = await makeWorld({ versions_kept: 2 });
    const id = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { files: pages("report v2"), site: id });
    const third = await publishSite(world.install, OWNER, { files: pages("report v3"), site: id });
    const folder = (await world.keys())[0]?.split("/")[0];

    world.faults.failRemoval = true;
    const fourth = await publishSite(world.install, OWNER, { files: pages("report v4"), site: id });

    expect(third).toMatchObject({ ok: true, left: [], site: { live_version: 3, versions: [{ number: 2 }, { number: 3 }] } });
    expect(fourth).toMatchObject({ ok: true, left: [`${folder}/v2/`], site: { live_version: 4, versions: [{ number: 3 }, { number: 4 }] } });
    expect((await world.keys()).map((key) => key.split("/")[1])).toEqual(["v2", "v2", "v3", "v3", "v4", "v4"]);
  });
});
