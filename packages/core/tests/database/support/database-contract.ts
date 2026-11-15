// The contract every `Database` keeps, as test cases that take a database factory. Every check reads back through the interface. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import { type LoginId, mintComputerLogin, type PendingLogin } from "../../../src/auth/computer-logins";
import type { Login } from "../../../src/auth/logins";
import { mintToken, type TokenId, type TokenRecord } from "../../../src/auth/tokens";
import type { Database, NewSite, NewUpload, NewVersion, Signed } from "../../../src/database/database";
import type { PublicName, SiteName } from "../../../src/names/names";
import type { AuditAction, AuditEntry } from "../../../src/records/audit";
import { defaultSettings } from "../../../src/records/settings";
import { mintSiteFolder, type Site } from "../../../src/records/site";
import type { Totals } from "../../../src/records/sizes";
import type { SiteId } from "../../../src/sites/ids";
import { type ManifestFile, mintUploadId, type UploadId } from "../../../src/records/upload";

/** The moment the fixtures are made at. */
export const NOW = 1_700_000_000_000;

/** A token's id, standing for the first of two people. */
export const ADA = "00000000000000aa" as TokenId;

/** A token's id, standing for the second. */
const BO = "00000000000000bb" as TokenId;

/** A change made by the first person at the fixture moment. */
export const BY_ADA: Signed = { by: ADA, at: NOW };

/** A site name, which is a valid public name too. */
export const REPORT = "report" as SiteName;

/** A public name. */
export const DOCS = "docs" as PublicName;

/** An id in the form of a site id that no fixture site gets. */
export const NO_SITE = "zzzzzzzzzzzz" as SiteId;

/** The size of a fixture version whose size the case does not look at. */
const SIZE = { bytes: 1000, files: 4 };

/** What an install with no site holds. */
const NOTHING: Totals = { sites: 0, trashed_sites: 0, bytes: 0, files: 0 };

/** A signing key of one repeated byte, so a leak of it shows which key leaked. */
export const FIRST_KEY = new Uint8Array(32).fill(0xa1);

/** A second signing key, of another byte. */
export const SECOND_KEY = new Uint8Array(32).fill(0xb2);

/** A third signing key, of another byte again. */
const THIRD_KEY = new Uint8Array(32).fill(0xc3);

/** A UTC day requests are counted on. */
export const TODAY = "2026-11-13";

/** The day after it. */
export const TOMORROW = "2026-11-14";

/** An id in the form of a site id, standing for a second site whose requests are counted. */
export const OTHER_SITE = "aaaaaaaaaaaa" as SiteId;

/** The files a fixture upload declares: 1000 bytes in two files, one under a path that needs quoting. */
const MANIFEST = [
  { path: "index.html", size: 700, content_type: "text/html" },
  { path: "it's \"quoted\"/100%.css", size: 300, content_type: "text/css" },
];

/** Room no fixture upload fills. */
const ROOMY = { own: 100, folderBytes: 1_000_000, staying: 0, totalBytes: 1_000_000, sites: null, day: "2026-11-13", dayFiles: 1_000_000 };

/** A change made by the second person a moment later. */
const BY_BO_LATER: Signed = { by: BO, at: NOW + 5 };

/** The settings of a new install. */
export const SETTINGS = defaultSettings({ installer: "ada@example.com" as Login, hostname: "poplin.example.com" });

/** The admin who decides the fixture logins. */
export const ADMIN = "ada@example.com" as Login;

/** A bound on stored logins that no fixture reaches. */
const ROOM = { perVisitor: 100, all: 100 };

/** Gives a new, empty database on every call, one that draws its site ids from `mintId` when a case passes one. */
type DatabaseFactory = (mintId?: () => SiteId) => Database | Promise<Database>;

/** Site ids handed out in order, so a test knows the id a site gets and can make two candidates collide. */
function mintFrom(...ids: string[]): () => SiteId {
  const left = [...ids];

  return () => {
    const next = left.shift();
    if (next === undefined) throw new Error("the fixture ran out of site ids");

    return next as SiteId;
  };
}

/** A pending login of a publisher, asked for at a moment from a computer named `laptop` by a visitor. */
export async function pendingLogin(now: number = NOW, visitor = "one-visitor"): Promise<PendingLogin> {
  return (await mintComputerLogin({ scope: "publisher", computer: "laptop", visitor, now })).login;
}

/** A draft of a site with this name; a public one takes its name as its public name unless another is given. */
export function draft(name: SiteName, access: NewSite["access"] = "private", publicName: PublicName = name as PublicName): NewSite {
  const fields = { name, folder: mintSiteFolder(), title: null, search_engines: false, expires: "never" as const, ...SIZE };
  if (access === "public") return { ...fields, access, public_name: publicName };

  return { ...fields, access };
}

/** A publish of the fixture size under a reserved number. */
export function publish(number: number, keep: number): NewVersion {
  return { number, keep, ...SIZE };
}

/**
 * Make a fixture site.
 *
 * @throws {Error} the site was refused, which is a broken fixture
 */
export async function made(database: Database, site: NewSite, signed: Signed = BY_ADA): Promise<Site> {
  const created = await database.createSite(site, signed);
  if (created.kind !== "done") throw new Error(`the fixture site was refused: ${created.kind}`);

  return created.site;
}

/** Record a fixture upload that makes a new site; answers its id and the site it plans. */
export async function begunSite(database: Database, site: NewSite, at: number = NOW): Promise<{ readonly id: UploadId; readonly site: NewSite }> {
  const planned = { ...site, embeddable: true };
  const upload: NewUpload = { id: mintUploadId(), folder: site.folder, number: 1, owner: ADA, plan: { kind: "create", site: planned }, manifest: MANIFEST, created_at: at };
  await database.addUpload(upload, ROOMY);

  return { id: upload.id, site: planned };
}

/** `count` declared files, `page-0.html` to the last, each of as many bytes as its number. */
export function numberedFiles(count: number): ManifestFile[] {
  return Array.from(Array(count).keys(), (index) => ({ path: `page-${index}.html`, size: index, content_type: "text/html" }));
}

/** Record an upload of a new site that declares the files of `manifest`, whatever they add up to; answers its id. */
export async function begunFiles(database: Database, manifest: readonly ManifestFile[]): Promise<UploadId> {
  const site = { ...draft(REPORT), embeddable: true };
  const upload: NewUpload = { id: mintUploadId(), folder: site.folder, number: 1, owner: ADA, plan: { kind: "create", site }, manifest, created_at: NOW };
  await database.addUpload(upload, { ...ROOMY, folderBytes: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER });

  return upload.id;
}

/** Record a fixture upload that stores a site from a backup under a folder made for it; answers its id and the site as finishing stores it. */
export async function begunImport(database: Database, site: Site): Promise<{ readonly id: UploadId; readonly site: Site }> {
  const placed = { ...site, folder: mintSiteFolder() };
  const upload: NewUpload = { id: mintUploadId(), folder: placed.folder, number: 1, owner: ADA, plan: { kind: "import", site: { id: site.id } }, manifest: MANIFEST, created_at: NOW };
  await database.addUpload(upload, ROOMY);

  return { id: upload.id, site: placed };
}

/**
 * Record a fixture upload that adds the next version to a site; answers its id.
 *
 * @throws {Error} no version number could be set aside, which is a broken fixture
 */
export async function begunVersion(database: Database, site: Site): Promise<UploadId> {
  const reserved = await database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") throw new Error(`the fixture version was refused: ${reserved.kind}`);

  const id = mintUploadId();
  await database.addUpload({ id, folder: site.folder, number: reserved.number, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW }, ROOMY);

  return id;
}

/** Store a site from a backup through an upload begun in its folder, and leave no record of the upload behind. */
export async function storedBack(database: Database, site: Site, signed: Signed = BY_ADA): ReturnType<Database["importUploadAsSite"]> {
  const upload: NewUpload = { id: mintUploadId(), folder: site.folder, number: 1, owner: ADA, plan: { kind: "import", site: {} }, manifest: MANIFEST, created_at: NOW };
  await database.addUpload(upload, ROOMY);

  try {
    return await database.importUploadAsSite(upload.id, site, signed);
  } finally {
    await database.abandonUpload(upload.id);
    await database.removeUpload(upload.id);
  }
}

/** What the kept versions of one site hold together, in the trash or not; `undefined` for no site. */
async function sizeOf(database: Database, id: SiteId): Promise<{ readonly bytes: number; readonly files: number } | undefined> {
  const site = await database.getSite(id);
  if (site === undefined) return undefined;

  return { bytes: site.versions.reduce((sum, version) => sum + version.bytes, 0), files: site.versions.reduce((sum, version) => sum + version.files, 0) };
}

/** Every site, the trash included, read a page at a time. */
async function everySite(database: Database): Promise<Site[]> {
  const sites: Site[] = [];
  let after: SiteId | undefined;

  for (;;) {
    const page = await database.exportSites(after === undefined ? { limit: 100 } : { limit: 100, after });
    sites.push(...page.sites);
    if (page.next === undefined) return sites;

    after = page.next;
  }
}

/** Every audit entry, the oldest first, read a page at a time. */
async function auditTrail(database: Database): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  let before: number | undefined;

  for (;;) {
    const page = await database.listAudit(before === undefined ? { limit: 100 } : { limit: 100, before });
    const last = page.at(-1);
    if (last === undefined) return entries.reverse();

    entries.push(...page);
    before = last.seq;
  }
}

async function auditActions(database: Database): Promise<AuditAction[]> {
  return (await auditTrail(database)).map((entry) => entry.action);
}

/** What the audit entries of one action set, the oldest first. */
async function auditDetails(database: Database, action: AuditAction): Promise<unknown[]> {
  return (await auditTrail(database)).filter((entry) => entry.action === action).map((entry) => entry.detail);
}

/** All a database shows of its sites, its audit log, and its totals: what a refused change leaves as it was. */
async function everything(database: Database): Promise<unknown> {
  return [await everySite(database), await auditTrail(database), await database.readTotals()];
}

async function requireTrueTotals(database: Database): Promise<void> {
  const sites = await everySite(database);
  const kept = sites.flatMap((site) => site.versions);
  const summed: Totals = {
    sites: sites.length,
    trashed_sites: sites.filter((site) => site.state === "trash").length,
    bytes: kept.reduce((sum, version) => sum + version.bytes, 0),
    files: kept.reduce((sum, version) => sum + version.files, 0),
  };
  const totals = await database.readTotals();
  const drifted = (["sites", "trashed_sites", "bytes", "files"] as const).some((key) => totals[key] !== summed[key]);
  if (drifted) throw new Error(`the totals ${JSON.stringify(totals)} drifted from the sums over every site ${JSON.stringify(summed)}`);
}

/**
 * A database that, after every operation it passes on, fails when the totals differ from the sums over every exported site: so every operation of every case is checked, a refused one too.
 *
 * Operations started together are checked once, after the last of them ends, so no check reads between two of them.
 */
function withTrueTotals(database: Database): Database {
  let running = 0;

  return new Proxy(database, {
    get(target, property): unknown {
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member !== "function") return member;

      return async (...given: unknown[]): Promise<unknown> => {
        running += 1;

        try {
          return await member.apply(target, given);
        } finally {
          running -= 1;
          if (running === 0) await requireTrueTotals(target);
        }
      };
    },
  });
}

async function opened(makeDatabase: DatabaseFactory, mintId?: () => SiteId): Promise<Database> {
  return withTrueTotals(await makeDatabase(mintId));
}

function emptyInstall(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: an empty install`, () => {
    // Drift: every read is asked before the first write; one that threw or made something up on an install with nothing in it would break setup.
    test("a new database holds no site, token, settings, signing key, or audit entry, and its totals are zero", async () => {
      const database = await opened(makeDatabase);

      expect<unknown>([
        await database.listSites({ trash: false, limit: 100 }),
        await database.listSites({ trash: true, limit: 100 }),
        await database.exportSites({ limit: 100 }),
        await database.getSite(NO_SITE),
        await database.getSiteByPublicName(DOCS),
        await database.findServed({ id: NO_SITE }, NOW),
        await database.readTotals(),
        await database.listTokens(),
        await database.getToken(ADA),
        await database.readSettings(),
        await database.readSigningKey(),
        await database.listAudit({ limit: 100 }),
      ]).toEqual([{ sites: [] }, { sites: [] }, { sites: [] }, undefined, undefined, undefined, NOTHING, [], undefined, undefined, undefined, []]);
    });
  });
}

function sites(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: sites`, () => {
    // Drift: a name is a label and the id is the key; a unique name would refuse the second "report" anyone publishes.
    test("two sites with one name coexist under different ids, each found by its own id alone", async () => {
      const database = await opened(makeDatabase);
      const first = await made(database, draft(REPORT));
      const second = await made(database, draft(REPORT));

      expect([first.name, second.name, first.id === second.id]).toEqual([REPORT, REPORT, false]);
      expect([await database.getSite(first.id), await database.getSite(second.id)]).toEqual([first, second]);
      expect(first).toEqual({
        id: first.id,
        name: REPORT,
        folder: first.folder,
        title: null,
        page_title: null,
        search_engines: false,
        embeddable: true,
        expires: "never",
        live_version: 1,
        versions: [{ number: 1, published_at: NOW, published_by: ADA, ...SIZE }],
        owner: ADA,
        created_at: NOW,
        updated_at: NOW,
        access: "private",
        state: "live",
      });
    });

    // Drift: a draft the types forbid still arrives from a request body; stored, it would be a site no read could turn back into a site.
    test.each([
      ["public access and no public name", (site: NewSite): unknown => ({ ...site, access: "public" })],
      ["an access that is none of the three", (site: NewSite): unknown => ({ ...site, access: "secret" })],
      ["a name that is no site name", (site: NewSite): unknown => ({ ...site, name: "No Such Name" })],
      ["a folder that is no folder key", (site: NewSite): unknown => ({ ...site, folder: "elsewhere" })],
      ["an empty title", (site: NewSite): unknown => ({ ...site, title: "" })],
      ["an expiry that is no moment", (site: NewSite): unknown => ({ ...site, expires: -1 })],
    ] as const)("a draft with %s is refused by a throw, and nothing is stored", async (_case, change) => {
      const database = await opened(makeDatabase);

      await expect(database.createSite(change(draft(REPORT)) as NewSite, BY_ADA)).rejects.toThrow();
      expect(await everything(database)).toEqual([[], [], NOTHING]);
    });

    // Drift: a folder holds one site's files; a second site in it would serve the first one's files and take them along when it is deleted.
    test("a folder that is a site's is refused to a new site by a throw and to an import with folder_taken, whatever became of that site, until it is deleted", async () => {
      const database = await opened(makeDatabase);
      const holder = await made(database, draft(REPORT));
      await made(database, draft(DOCS, "public"));
      const squatter = { ...draft(REPORT), folder: holder.folder };
      const refused = async (): Promise<void> => {
        const before = await everything(database);

        await expect(database.createSite(squatter, BY_ADA)).rejects.toThrow();
        expect(await storedBack(database, { ...holder, id: NO_SITE })).toEqual({ kind: "folder_taken" });
        expect(await everything(database)).toEqual(before);
      };

      await refused();
      const moved = await database.giveNewId(holder.id, BY_ADA);
      const id = moved.kind === "done" ? moved.site.id : holder.id;
      await refused();
      await database.trashSite(id, BY_ADA);
      await refused();

      expect([id === holder.id, (await database.getSite(id))?.folder]).toEqual([false, holder.folder]);
      expect(await database.createSite({ ...squatter, access: "public", public_name: DOCS }, BY_ADA)).toEqual({ kind: "name_taken" });
      await database.deleteSite(id, BY_ADA);
      expect((await database.createSite(squatter, BY_ADA)).kind).toBe("done");
    });

    // Drift: an id that is taken, as an id or as a public name, must cost a second draw and never a failed publish or a shadowed address.
    test("a candidate id that is a site's id or a site's public name is drawn again, for a new site and for a new id", async () => {
      const database = await opened(
        makeDatabase,
        mintFrom("aaaaaaaaaaaa", "aaaaaaaaaaaa", "cccccccccccc", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "aaaaaaaaaaaa", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"),
      );
      const first = await made(database, draft(REPORT));
      const second = await made(database, draft(REPORT, "public", "cccccccccccc" as PublicName));
      const third = await made(database, draft(DOCS));
      const moved = await database.giveNewId(third.id, BY_ADA);

      expect<unknown>([first.id, second.id, third.id, moved.kind === "done" ? moved.site.id : moved.kind]).toEqual([
        "aaaaaaaaaaaa",
        "bbbbbbbbbbbb",
        "dddddddddddd",
        "eeeeeeeeeeee",
      ]);
      expect(await auditActions(database)).toEqual(["create", "create", "create", "new_id"]);
      expect(await database.getSite("aaaaaaaaaaaa" as SiteId)).toEqual(first);
    });

    // Drift: a page that names many sites asks for all of them at once, and one invocation has a fixed count of queries; a lookup that dropped the trash, kept an old name, or made up a deleted site would mislabel the log.
    test("the names of many sites are read at once: the name each has now, the trash included, and nothing for an id that is no site's", async () => {
      const database = await opened(makeDatabase);
      const kept = await made(database, draft(REPORT));
      const renamed = await made(database, draft(REPORT));
      const trashed = await made(database, draft(REPORT));
      const deleted = await made(database, draft(REPORT));
      await database.changeDetails(renamed.id, { name: "notes" as SiteName }, BY_ADA);
      await database.trashSite(trashed.id, BY_ADA);
      await database.deleteSite(deleted.id, BY_ADA);

      const names = await database.getSiteNames([kept.id, renamed.id, trashed.id, deleted.id, NO_SITE, kept.id]);

      expect<unknown>([[...names].sort(), [...(await database.getSiteNames([]))]]).toEqual([
        [
          [kept.id, REPORT],
          [renamed.id, "notes"],
          [trashed.id, REPORT],
        ].sort(),
        [],
      ]);
    });

    // Drift: the folder is where the files are and the owner is whose site it is; a change that rewrote either would strand the files or hand the site over.
    test("a site keeps its name, folder, owner, and creation time through every change another person makes", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: BO, at: NOW + 5 };
      const steps = [
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeDetails(site.id, { title: "T" }, later),
        await database.reserveVersion(site.id).then(() => database.addVersion(site.id, publish(2, 3), later)),
        await database.setLiveVersion(site.id, "previous", later),
        await database.trashSite(site.id, later),
        await database.restoreSite(site.id, later),
        await database.giveNewId(site.id, later),
      ];
      const lasting = [site.name, site.folder, site.owner, site.created_at];

      const last = steps.at(-1);

      expect<unknown>(steps.map((step) => ("site" in step ? [step.site.name, step.site.folder, step.site.owner, step.site.created_at] : step.kind))).toEqual(
        steps.map(() => lasting),
      );
      expect(last !== undefined && "site" in last ? await database.reserveVersion(last.site.id) : last).toEqual({ kind: "reserved", number: 3 });
    });

    // Drift: a caller tells "there is no such site" from "it is in the trash" by these answers alone, and offers a restore only for the second.
    test.each([
      ["access changed", (database: Database, id: SiteId): Promise<{ kind: string }> => database.changeAccess(id, { access: "unlisted" }, BY_ADA)],
      ["details changed", (database: Database, id: SiteId): Promise<{ kind: string }> => database.changeDetails(id, { title: "T" }, BY_ADA)],
      ["a new id given", (database: Database, id: SiteId): Promise<{ kind: string }> => database.giveNewId(id, BY_ADA)],
      ["the site trashed", (database: Database, id: SiteId): Promise<{ kind: string }> => database.trashSite(id, BY_ADA)],
      ["a version reserved", (database: Database, id: SiteId): Promise<{ kind: string }> => database.reserveVersion(id)],
      ["a version published", (database: Database, id: SiteId): Promise<{ kind: string }> => database.addVersion(id, publish(2, 3), BY_ADA)],
      ["the live version moved", (database: Database, id: SiteId): Promise<{ kind: string }> => database.setLiveVersion(id, "previous", BY_ADA)],
    ] as const)("%s is refused with in_trash for a trashed site and with not_found for no site, and nothing is stored", async (_case, change) => {
      const database = await opened(makeDatabase);
      const trashed = await made(database, draft(REPORT));
      await database.trashSite(trashed.id, BY_ADA);

      const before = await everything(database);

      expect([(await change(database, trashed.id)).kind, (await change(database, NO_SITE)).kind]).toEqual(["in_trash", "not_found"]);
      expect(await everything(database)).toEqual(before);
    });

    test("restoring a site that is not in the trash is refused with not_in_trash, and restoring or deleting no site with not_found", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const refusals = [await database.restoreSite(site.id, BY_ADA), await database.restoreSite(NO_SITE, BY_ADA), await database.deleteSite(NO_SITE, BY_ADA)];

      expect(refusals.map((refusal) => refusal.kind)).toEqual(["not_in_trash", "not_found", "not_found"]);
    });

    // Drift: a public name is an address; two holders, or a name that reads as some site's id, would send a visitor to the wrong site.
    test.each([
      [
        "a new public site, the name held by another site",
        async (database: Database): Promise<unknown> => database.createSite(draft(REPORT, "public", DOCS), BY_ADA),
      ],
      [
        "a new public site, the name being another site's id",
        async (database: Database, holder: Site): Promise<unknown> => database.createSite(draft(REPORT, "public", holder.id as string as PublicName), BY_ADA),
      ],
      [
        "a site going public, the name held by another site",
        async (database: Database): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT))).id, { access: "public", public_name: DOCS }, BY_ADA),
      ],
      [
        "a site going public, the name being another site's id",
        async (database: Database, holder: Site): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT))).id, { access: "public", public_name: holder.id as string as PublicName }, BY_ADA),
      ],
      [
        "a site going public under its own id",
        async (database: Database): Promise<unknown> => {
          const site = await made(database, draft(REPORT));

          return database.changeAccess(site.id, { access: "public", public_name: site.id as string as PublicName }, BY_ADA);
        },
      ],
      [
        "a public site changing its name to one that is held",
        async (database: Database): Promise<unknown> =>
          database.changeAccess((await made(database, draft(REPORT, "public"))).id, { access: "public", public_name: DOCS }, BY_ADA),
      ],
    ] as const)("refuses %s with name_taken and writes no audit entry", async (_case, claim) => {
      const database = await opened(makeDatabase);
      const holder = await made(database, draft(DOCS, "public"));
      const refused = await claim(database, holder);
      const actions = await auditActions(database);

      expect(refused).toEqual({ kind: "name_taken" });
      expect(actions.filter((action) => action !== "create")).toEqual([]);
      expect(await database.getSiteByPublicName(DOCS)).toEqual(holder);
    });

    // Drift: read-then-write would let both callers see the name free; the check and the claim are one step, so the database decides.
    test("two claims of one public name at the same moment leave exactly one holder, and the loser gets name_taken", async () => {
      const database = await opened(makeDatabase);
      const [first, second] = [await made(database, draft(REPORT)), await made(database, draft(REPORT))];
      const claims = await Promise.all([first, second].map((site) => database.changeAccess(site.id, { access: "public", public_name: DOCS }, BY_ADA)));
      const holders = (await everySite(database)).filter((site) => site.access === "public" && site.public_name === DOCS);

      expect(claims.map((claim) => claim.kind).sort()).toEqual(["done", "name_taken"]);
      expect(holders).toHaveLength(1);
      expect((await auditActions(database)).filter((action) => action === "access")).toHaveLength(1);
      expect(
        [...claims, ...(await Promise.all([database.createSite(draft(DOCS, "public"), BY_ADA), database.createSite(draft(DOCS, "public"), BY_ADA)]))]
          .map((claim) => claim.kind)
          .sort(),
      ).toEqual(["done", "name_taken", "name_taken", "name_taken"]);
    });

    test("access moves between the three, a public name is claimed, changed, and freed, and asking for what already is writes nothing", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: BO, at: NOW + 5 };
      const steps = [
        await database.changeAccess(site.id, { access: "unlisted" }, later),
        await database.changeAccess(site.id, { access: "unlisted" }, later),
        await database.changeAccess(site.id, { access: "public", public_name: REPORT as PublicName }, later),
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeAccess(site.id, { access: "public", public_name: DOCS }, later),
        await database.changeAccess(site.id, { access: "private" }, later),
      ];

      expect<unknown>(
        steps.map((step) =>
          "site" in step ? [step.kind, step.site.access, "public_name" in step.site ? step.site.public_name : null, step.site.updated_at] : step.kind,
        ),
      ).toEqual([
        ["done", "unlisted", null, NOW],
        ["unchanged", "unlisted", null, NOW],
        ["done", "public", REPORT, NOW],
        ["done", "public", DOCS, NOW],
        ["unchanged", "public", DOCS, NOW],
        ["done", "private", null, NOW],
      ]);
      const named = { id: site.id, name: REPORT };
      expect<unknown>((await auditTrail(database)).filter((entry) => entry.action === "access")).toEqual([
        { seq: 2, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "unlisted", public_name: null } },
        { seq: 3, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "public", public_name: "report" } },
        { seq: 4, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "public", public_name: "docs" } },
        { seq: 5, at: NOW + 5, by: BO, action: "access", site: named, detail: { access: "private", public_name: null } },
      ]);
      expect([await database.getSiteByPublicName(DOCS), await database.getSiteByPublicName(REPORT as PublicName)]).toEqual([undefined, undefined]);
    });

    // Drift: "new link" exists to cut off everyone who holds the old address; an old id that still resolved would defeat it.
    test("after a new id the old id names no site, the public name leads to the new id, and the folder and versions are the same", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT, "public", DOCS));
      const moved = await database.giveNewId(site.id, { by: ADA, at: NOW + 9 });
      if (moved.kind !== "done") throw new Error(`the new id was refused: ${moved.kind}`);

      expect(moved.site).toEqual({ ...site, id: moved.site.id });
      expect(moved.site.id).not.toBe(site.id);
      expect((await auditTrail(database)).at(-1)).toMatchObject({ action: "new_id", site: { id: moved.site.id, name: REPORT }, detail: { from: site.id } });
      expect([await database.getSite(site.id), await database.findServed({ id: site.id }, NOW)]).toEqual([undefined, undefined]);
      expect([await database.getSiteByPublicName(DOCS), await database.findServed({ public_name: DOCS }, NOW), await database.getSite(moved.site.id)]).toEqual([
        moved.site,
        moved.site,
        moved.site,
      ]);
    });

    // Drift: the trash is an undo, so the site must come back whole, name included; and a trashed site must look exactly like no site to a visitor.
    test("a trashed site keeps its public name, is served at neither address, and comes back whole when restored", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT, "public", DOCS));
      const trashed = await database.trashSite(site.id, { by: ADA, at: NOW + 1 });
      const inTrash = { ...site, state: "trash", trashed_at: NOW + 1 };

      expect(trashed).toEqual({ kind: "done", site: inTrash } as typeof trashed);
      expect([await database.findServed({ id: site.id }, NOW), await database.findServed({ public_name: DOCS }, NOW)]).toEqual([undefined, undefined]);
      expect<unknown>([await database.getSite(site.id), await database.getSiteByPublicName(DOCS)]).toEqual([inTrash, inTrash]);
      expect(await database.createSite(draft(DOCS, "public"), BY_ADA)).toEqual({ kind: "name_taken" });
      expect(await database.restoreSite(site.id, { by: ADA, at: NOW + 2 })).toEqual({ kind: "done", site });
      expect(await database.findServed({ public_name: DOCS }, NOW)).toEqual(site);
    });

    // Drift: a site restored with an expiry already behind it would be live in the answer and served to nobody, and the sweep would trash it again.
    test.each([
      ["an expiry before the restore", NOW + 1, "never"],
      ["an expiry at the moment of the restore", NOW + 5, "never"],
      ["an expiry after the restore", NOW + 6, NOW + 6],
    ] as const)("a restore clears %s, and keeps one still ahead", async (_which, expires, kept) => {
      const database = await opened(makeDatabase);
      const site = await made(database, { ...draft(REPORT), expires });
      await database.trashSite(site.id, BY_ADA);
      const restored = { ...site, expires: kept };

      expect(await database.restoreSite(site.id, { by: ADA, at: NOW + 5 })).toEqual({ kind: "done", site: restored });
      expect([await database.getSite(site.id), await database.findServed({ id: site.id }, NOW + 5)]).toEqual([restored, restored]);
    });

    // Drift: a name held by a site that no longer exists could never be claimed again, and versions left behind would count against the install for good.
    test("deleting a site for good frees its public name and removes its versions with it", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT, "public", DOCS));
      await database.trashSite(site.id, BY_ADA);
      const trashed = await database.getSite(site.id);
      const deleted = await database.deleteSite(site.id, BY_ADA);

      expect(deleted).toEqual({ kind: "done", site: trashed } as typeof deleted);
      expect([await database.getSite(site.id), await database.getSiteByPublicName(DOCS)]).toEqual([undefined, undefined]);
      expect([await sizeOf(database, site.id), await database.readTotals()]).toEqual([undefined, NOTHING]);
      expect((await database.createSite(draft(DOCS, "public"), BY_ADA)).kind).toBe("done");
    });

    // Drift: the folder of a removed site is all that says files may still sit in the bucket; one that was not remembered would leave them there for good.
    test("every site removed for good leaves its folder as a leftover until it is forgotten, and a site stored back into its folder takes it out", async () => {
      const database = await opened(makeDatabase);
      const sites = [await made(database, draft(REPORT)), await made(database, draft(REPORT)), await made(database, draft(DOCS))];
      const folders = sites.map((site) => site.folder).sort();
      const [first, second, third] = folders;
      const before = await database.listLeftovers({ limit: 10 });
      for (const site of sites) await database.deleteSite(site.id, BY_ADA);

      const pages = [await database.listLeftovers({ limit: 2 }), await database.listLeftovers({ limit: 2, after: second })];
      const back = sites.find((site) => site.folder === first);
      if (back === undefined || second === undefined) throw new Error("the fixture sites are not there");

      await storedBack(database, back);
      await database.forgetLeftover(second);
      await database.forgetLeftover(second);

      expect([before, pages]).toEqual([{ folders: [] }, [{ folders: [first, second], next: second }, { folders: [third] }]] as never);
      expect(await database.listLeftovers({ limit: 10 })).toEqual({ folders: [third] } as never);
      await expect(database.listLeftovers({ limit: 0 })).rejects.toThrow(RangeError);
    });

    test.each([
      ["never", NOW, true],
      [NOW + 1, NOW, true],
      [NOW, NOW, false],
      [NOW - 1, NOW, false],
    ] as const)("a site expiring at %j is served at %j, by its id and by its public name: %j", async (expires, now, served) => {
      const database = await opened(makeDatabase);
      const site = await made(database, { ...draft(REPORT, "public", DOCS), expires });
      const found = [await database.findServed({ id: site.id }, now), await database.findServed({ public_name: DOCS }, now)];

      expect(found.map((answer) => answer !== undefined)).toEqual([served, served]);
      expect((await database.getSite(site.id))?.expires).toBe(expires);
    });

    test("details change only where a given value differs, and a trashed or missing site is refused", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const later: Signed = { by: ADA, at: NOW + 3 };
      const changed = { ...site, name: DOCS, title: "Q3 report", search_engines: true, expires: NOW + 100 };

      expect(await database.changeDetails(site.id, { name: DOCS, title: "Q3 report", search_engines: true, expires: NOW + 100 }, later)).toEqual({
        kind: "done",
        site: changed,
      });
      expect(await database.changeDetails(site.id, { title: "Q3 report" }, { by: ADA, at: NOW + 4 })).toEqual({ kind: "unchanged", site: changed });
      expect(await database.changeDetails(site.id, {}, { by: ADA, at: NOW + 4 })).toEqual({ kind: "unchanged", site: changed });
      expect(await database.changeDetails(site.id, { title: null, expires: "never" }, later)).toEqual({
        kind: "done",
        site: { ...changed, title: null, expires: "never" },
      });
      expect(await database.changeDetails(NO_SITE, { title: "x" }, later)).toEqual({ kind: "not_found" });
      await expect(database.changeDetails(site.id, { title: "" }, later)).rejects.toThrow();
      expect((await auditActions(database)).filter((action) => action === "details")).toHaveLength(2);
    });

    // Drift: the serving code forbids framing from this flag alone; a site made without it, or a change that did not stick, would open or seal the wrong site.
    test("a site is embeddable unless made otherwise, and the flag is set to false and back with one audit entry each", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const sealed = await made(database, { ...draft(REPORT), embeddable: false });
      const flags = [
        await database.changeDetails(site.id, { embeddable: false }, BY_ADA),
        await database.changeDetails(site.id, { embeddable: false }, BY_ADA),
        await database.changeDetails(site.id, { embeddable: true }, BY_ADA),
      ];

      expect([site.embeddable, sealed.embeddable]).toEqual([true, false]);
      expect(flags.map((flag) => ("site" in flag ? [flag.kind, flag.site.embeddable] : flag.kind))).toEqual([
        ["done", false],
        ["unchanged", false],
        ["done", true],
      ]);
      expect(await auditDetails(database, "details")).toEqual([{ embeddable: false }, { embeddable: true }]);
      expect((await database.getSite(site.id))?.embeddable).toBe(true);
    });

    // Drift: the dashboard pages through this; a page that skipped or repeated a site, or mixed the trash in, would hide or double sites.
    test("a listing pages through the sites newest change first, apart from the trash, and by owner when asked", async () => {
      const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd", "eeeeeeeeeeee"));
      const ids: SiteId[] = [];
      for (const [by, at] of [
        [ADA, NOW],
        [BO, NOW],
        [ADA, NOW + 1],
        [BO, NOW + 2],
        [ADA, NOW + 3],
      ] as const)
        ids.push((await made(database, draft(REPORT), { by, at })).id);
      await database.trashSite("dddddddddddd" as SiteId, { by: ADA, at: NOW + 9 });

      const first = await database.listSites({ trash: false, limit: 3 });
      const second = await database.listSites({ trash: false, limit: 3, ...(first.next === undefined ? {} : { after: first.next }) });
      const page = (listed: { readonly sites: readonly Site[] }): string[] => listed.sites.map((site) => site.id);

      expect<unknown>([page(first), first.next, page(second), second.next]).toEqual([
        ["eeeeeeeeeeee", "cccccccccccc", "bbbbbbbbbbbb"],
        { updated_at: NOW, id: "bbbbbbbbbbbb" },
        ["aaaaaaaaaaaa"],
        undefined,
      ]);
      expect(page(await database.listSites({ trash: true, limit: 100 }))).toEqual(["dddddddddddd"]);
      expect(page(await database.listSites({ trash: false, owner: BO, limit: 100 }))).toEqual(["bbbbbbbbbbbb"]);
      expect(page(await database.listSites({ trash: true, owner: ADA, limit: 100 }))).toEqual([]);
      expect(ids).toHaveLength(5);
      await expect(database.listSites({ trash: false, limit: 0 })).rejects.toThrow(RangeError);
      await expect(database.listSites({ trash: false, limit: 101 })).rejects.toThrow(RangeError);
    });
  });
}

function versions(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: versions`, () => {
    // Drift: a site without a version has nothing to serve; the database itself makes version 1 with the site, of the size and by the maker the call states.
    test("a new site holds version 1 alone, live, as its maker published it, and the next number set aside is 2", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, { ...draft(REPORT), bytes: 100, files: 2 }, { by: BO, at: NOW + 1 });
      const first = { number: 1, published_at: NOW + 1, published_by: BO, bytes: 100, files: 2 };

      expect([site.live_version, site.versions, (await database.getSite(site.id))?.versions]).toEqual([1, [first], [first]]);
      expect<unknown>([await sizeOf(database, site.id), await database.readTotals()]).toEqual([
        { bytes: 100, files: 2 },
        { sites: 1, trashed_sites: 0, bytes: 100, files: 2 },
      ]);
      expect(await database.setLiveVersion(site.id, "previous", BY_ADA)).toEqual({ kind: "no_such_version" });
      expect(await database.reserveVersion(site.id)).toEqual({ kind: "reserved", number: 2 });
    });

    // Drift: two publishes to one site upload into the folder of their version number; one number handed out twice would mix their files.
    test("version numbers reserved at the same moment are all different, and a publish goes live under its number while old versions are dropped", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const reserved = await Promise.all([1, 2, 3].map(() => database.reserveVersion(site.id)));
      const numbers = reserved.map((answer) => (answer.kind === "reserved" ? answer.number : 0)).sort();
      const second = await database.addVersion(site.id, publish(2, 3), { by: BO, at: NOW + 2 });
      const fourth = await database.addVersion(site.id, publish(4, 2), { by: BO, at: NOW + 4 });

      expect(numbers).toEqual([2, 3, 4]);
      expect(second).toMatchObject({
        kind: "done",
        dropped: [],
        site: { live_version: 2, updated_at: NOW + 2, versions: [{ number: 1 }, { number: 2, published_at: NOW + 2, published_by: BO }] },
      });
      expect(fourth).toMatchObject({ kind: "done", dropped: [1], site: { live_version: 4, versions: [{ number: 2 }, { number: 4 }] } });
      expect(await database.addVersion(site.id, publish(3, 2), BY_ADA)).toEqual({ kind: "stale_number" });
      expect(await database.addVersion(site.id, publish(5, 2), BY_ADA)).toEqual({ kind: "stale_number" });
      expect(await database.addVersion(NO_SITE, publish(2, 2), BY_ADA)).toEqual({ kind: "not_found" });
      await expect(database.addVersion(site.id, publish(5, 0), BY_ADA)).rejects.toThrow(RangeError);
      expect(await auditActions(database)).toEqual(["create", "publish", "publish"]);
      expect<unknown>((await auditTrail(database)).slice(1).map((entry) => [entry.by, entry.at, entry.site, entry.detail])).toEqual([
        [BO, NOW + 2, { id: site.id, name: REPORT }, { version: 2 }],
        [BO, NOW + 4, { id: site.id, name: REPORT }, { version: 4 }],
      ]);
      expect(await database.setLiveVersion(site.id, "previous", BY_ADA)).toMatchObject({ kind: "done", site: { live_version: 2 } });
    });

    // Drift: "go back one" decided from an earlier read would send two rollbacks to the same version; here each one moves from where the site is.
    test("the live version moves to a kept number or to the one before, and never to a version that is not kept", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      for (const number of [2, 3]) {
        await database.reserveVersion(site.id);
        await database.addVersion(site.id, publish(number, 3), BY_ADA);
      }

      const moves = [
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, "previous", BY_ADA),
        await database.setLiveVersion(site.id, 3, BY_ADA),
        await database.setLiveVersion(site.id, 3, BY_ADA),
        await database.setLiveVersion(site.id, 7, BY_ADA),
        await database.setLiveVersion(NO_SITE, 1, BY_ADA),
      ];

      expect(moves.map((move) => ("site" in move ? [move.kind, move.site.live_version] : move.kind))).toEqual([
        ["done", 2],
        ["done", 1],
        "no_such_version",
        ["done", 3],
        ["unchanged", 3],
        "no_such_version",
        "not_found",
      ]);
      expect(await auditDetails(database, "live_version")).toEqual([{ version: 2 }, { version: 1 }, { version: 3 }]);
    });
  });
}

function sizes(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: sizes`, () => {
    // Drift: a publish is refused from these numbers alone; a total that missed a dropped version or a deleted site would refuse an install with room left.
    test("the totals and a site's size follow every version kept, dropped, and deleted, and count the trash", async () => {
      const database = await opened(makeDatabase);
      const big = await made(database, { ...draft(REPORT), bytes: 100, files: 2 });
      const small = await made(database, { ...draft(DOCS, "public"), bytes: 7, files: 1 });
      const seen: unknown[] = [];
      const after = async (change: unknown): Promise<void> => {
        await change;
        seen.push([await database.readTotals(), await sizeOf(database, big.id), await sizeOf(database, small.id)]);
      };

      await after(undefined);
      await after(database.reserveVersion(big.id));
      await after(database.addVersion(big.id, { number: 2, keep: 2, bytes: 250, files: 5 }, BY_ADA));
      await after(database.reserveVersion(big.id).then(() => database.addVersion(big.id, { number: 3, keep: 2, bytes: 40, files: 1 }, BY_ADA)));
      await after(database.addVersion(big.id, { number: 2, keep: 2, bytes: 9000, files: 9 }, BY_ADA));
      await after(database.createSite({ ...draft(REPORT, "public", DOCS), bytes: 9000, files: 9 }, BY_ADA));
      await after(database.setLiveVersion(big.id, "previous", BY_ADA));
      await after(database.trashSite(small.id, BY_ADA));
      await after(database.restoreSite(small.id, BY_ADA));
      await after(database.trashSite(small.id, BY_ADA).then(() => database.deleteSite(small.id, BY_ADA)));
      await after(database.deleteSite(big.id, BY_ADA));

      const totals = (sites: number, trashed: number, bytes: number, files: number): unknown => ({ sites, trashed_sites: trashed, bytes, files });
      expect(seen).toEqual([
        [totals(2, 0, 107, 3), { bytes: 100, files: 2 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 107, 3), { bytes: 100, files: 2 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 357, 8), { bytes: 350, files: 7 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 1, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(2, 0, 297, 7), { bytes: 290, files: 6 }, { bytes: 7, files: 1 }],
        [totals(1, 0, 290, 6), { bytes: 290, files: 6 }, undefined],
        [totals(0, 0, 0, 0), undefined, undefined],
      ]);
    });

    test.each([
      ["bytes below zero", { bytes: -1, files: 1 }],
      ["a fraction of a file", { bytes: 1, files: 1.5 }],
      ["bytes past what a number holds exactly", { bytes: 2 ** 53, files: 1 }],
    ] as const)("a size with %s is refused for a new site and for a new version, and nothing is stored", async (_case, size) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.reserveVersion(site.id);

      await expect(database.createSite({ ...draft(DOCS), ...size }, BY_ADA)).rejects.toThrow();
      await expect(database.addVersion(site.id, { number: 2, keep: 3, ...size }, BY_ADA)).rejects.toThrow(RangeError);
      expect(await database.readTotals()).toEqual({ sites: 1, trashed_sites: 0, ...SIZE });
    });
  });
}

function backups(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: export and import`, () => {
    // Drift: a backup that skipped a site, or put one back under another id or without a version, would break an address or lose a rollback.
    test("every site is exported a page at a time in id order, the trash included, and reads back the same once deleted and imported", async () => {
      const database = await opened(makeDatabase, mintFrom("cccccccccccc", "aaaaaaaaaaaa", "eeeeeeeeeeee", "bbbbbbbbbbbb", "dddddddddddd"));
      const [rolledBack, trashed] = [await made(database, draft(REPORT, "public", DOCS)), await made(database, { ...draft(REPORT), title: "Old" })];
      for (const name of [REPORT, DOCS, REPORT]) await made(database, draft(name, "unlisted"), { by: BO, at: NOW + 1 });
      for (const number of [2, 3]) {
        await database.reserveVersion(rolledBack.id);
        await database.addVersion(rolledBack.id, { number, keep: 3, bytes: number * 11, files: number }, { by: BO, at: NOW + number });
      }
      await database.reserveVersion(rolledBack.id);
      await database.setLiveVersion(rolledBack.id, 2, BY_ADA);
      await database.trashSite(trashed.id, { by: BO, at: NOW + 7 });

      const pages = [await database.exportSites({ limit: 2 })];
      while (pages.at(-1)?.next !== undefined) pages.push(await database.exportSites({ limit: 2, after: pages.at(-1)?.next as SiteId }));
      const exported = pages.flatMap((page) => page.sites);
      const before = await database.readTotals();
      for (const site of exported) await database.deleteSite(site.id, BY_ADA);
      const emptied = await database.readTotals();
      const imported = [];
      for (const site of exported) imported.push(await storedBack(database, site, { by: BO, at: NOW + 99 }));
      const readBack = await Promise.all(exported.map((site) => database.getSite(site.id)));

      expect<unknown>(pages.map((page) => [page.sites.map((site) => site.id), page.next])).toEqual([
        [["aaaaaaaaaaaa", "bbbbbbbbbbbb"], "bbbbbbbbbbbb"],
        [["cccccccccccc", "dddddddddddd"], "dddddddddddd"],
        [["eeeeeeeeeeee"], undefined],
      ]);
      expect(exported.map((site) => [site.state, site.live_version, site.versions.map((version) => version.number)])).toEqual([
        ["trash", 1, [1]],
        ["live", 1, [1]],
        ["live", 2, [1, 2, 3]],
        ["live", 1, [1]],
        ["live", 1, [1]],
      ]);
      expect(imported).toEqual(exported.map((site) => ({ kind: "done", site })));
      expect(readBack).toEqual(exported);
      expect([emptied, await database.readTotals()]).toEqual([{ sites: 0, trashed_sites: 0, bytes: 0, files: 0 }, before]);
      expect(await database.reserveVersion(rolledBack.id)).toEqual({ kind: "reserved", number: 4 });
      const imports = (await auditTrail(database)).filter((entry) => entry.action === "imported");
      expect<unknown>(imports.map((entry) => [entry.by, entry.at, entry.site, entry.detail])).toEqual(
        exported.map((site) => [BO, NOW + 99, { id: site.id, name: site.name }, { versions: site.versions.length }]),
      );
      await expect(database.exportSites({ limit: 0 })).rejects.toThrow(RangeError);
      await expect(database.exportSites({ limit: 101 })).rejects.toThrow(RangeError);
    });

    // Drift: an import that overwrote a site, or left a row behind when it was refused, would corrupt the install it was meant to restore.
    test.each([
      ["id_taken", "its id is a site's id", (site: Site): Site => ({ ...site, folder: mintSiteFolder() })],
      ["id_taken", "its id is a site's public name", (site: Site): Site => ({ ...site, id: "cccccccccccc" as SiteId, folder: mintSiteFolder() })],
      ["folder_taken", "its folder is a site's folder", (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId })],
      [
        "name_taken",
        "its public name is a site's public name",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, folder: mintSiteFolder(), access: "public", public_name: "cccccccccccc" as PublicName }),
      ],
      [
        "name_taken",
        "its public name is a site's id",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, folder: mintSiteFolder(), access: "public", public_name: "aaaaaaaaaaaa" as PublicName }),
      ],
      [
        "name_taken",
        "its public name is its own id",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, folder: mintSiteFolder(), access: "public", public_name: "ffffffffffff" as PublicName }),
      ],
      ["id_taken", "its id and its folder are both a site's", (site: Site): Site => site],
      [
        "folder_taken",
        "its folder and its public name are both a site's",
        (site: Site): Site => ({ ...site, id: "ffffffffffff" as SiteId, access: "public", public_name: "cccccccccccc" as PublicName }),
      ],
    ] as const)("an import is refused with %s when %s, and nothing of it is stored", async (kind, _case, change) => {
      const database = await opened(makeDatabase, mintFrom("aaaaaaaaaaaa", "bbbbbbbbbbbb"));
      await made(database, draft(REPORT));
      await made(database, draft(REPORT, "public", "cccccccccccc" as PublicName));
      await database.reserveVersion("aaaaaaaaaaaa" as SiteId);
      const published = await database.addVersion("aaaaaaaaaaaa" as SiteId, publish(2, 3), BY_ADA);
      if (published.kind !== "done") throw new Error(`the fixture publish was refused: ${published.kind}`);

      const before = await everything(database);

      expect(await storedBack(database, change(published.site))).toEqual({ kind });
      expect(await everything(database)).toEqual(before);
      expect(await database.reserveVersion("aaaaaaaaaaaa" as SiteId)).toEqual({ kind: "reserved", number: 3 });
    });

    // Drift: these values could only come from a damaged or hand-edited backup; stored, they would be a site no read could turn back into a site.
    test.each([
      ["a live version that is not among its versions", (site: Site): unknown => ({ ...site, live_version: 9 })],
      ["one version number twice", (site: Site): unknown => ({ ...site, versions: [...site.versions, ...site.versions] })],
      ["no version", (site: Site): unknown => ({ ...site, versions: [] })],
      ["a version numbered 0", (site: Site): unknown => ({ ...site, live_version: 0, versions: [{ ...site.versions[0], number: 0 }] })],
      ["a version without a size", (site: Site): unknown => ({ ...site, versions: [{ number: 1, published_at: NOW, published_by: ADA }] })],
      ["public access and no public name", (site: Site): unknown => ({ ...site, access: "public" })],
      ["an id that is no site id", (site: Site): unknown => ({ ...site, id: "NOT-AN-ID" })],
      ["a place in the trash since no moment", (site: Site): unknown => ({ ...site, state: "trash", trashed_at: null })],
    ] as const)("an import of a site with %s throws, and nothing is stored", async (_case, change) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.deleteSite(site.id, BY_ADA);

      await expect(storedBack(database, change(site) as Site)).rejects.toThrow();
      expect(await database.readTotals()).toEqual({ sites: 0, trashed_sites: 0, bytes: 0, files: 0 });
    });
  });
}

function signingKey(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the signing key`, () => {
    // Drift: two Workers that each kept their own key would refuse each other's cookies, signing people out at random.
    test("starters at the same moment end with one key, a later starter gets it, and replacing it is the only thing that changes it", async () => {
      const database = await opened(makeDatabase);
      const none = await database.readSigningKey();
      const started = await Promise.all([FIRST_KEY, SECOND_KEY, THIRD_KEY].map((fresh) => database.ensureSigningKey(fresh, NOW)));
      const winner = started.find((start) => start.kind === "created")?.key;
      const later = await database.ensureSigningKey(new Uint8Array(32).fill(0xd4), NOW + 1);
      await database.rotateSigningKey(new Uint8Array(48).fill(0xe5), { by: BO, at: NOW + 2 });

      expect(none).toBeUndefined();
      expect(started.map((start) => start.kind).sort()).toEqual(["created", "kept", "kept"]);
      expect<unknown>(started.map((start) => start.key)).toEqual([winner, winner, winner]);
      expect<unknown>([FIRST_KEY, SECOND_KEY, THIRD_KEY]).toContainEqual(winner);
      expect<unknown>(later).toEqual({ kind: "kept", key: winner });
      expect<unknown>(await database.readSigningKey()).toEqual(new Uint8Array(48).fill(0xe5));
      expect(await auditTrail(database)).toEqual([{ seq: 1, at: NOW + 2, by: BO, action: "signed_everyone_out", site: null, detail: {} }]);
      await expect(database.ensureSigningKey(new Uint8Array(31), NOW)).rejects.toThrow(RangeError);
      await expect(database.rotateSigningKey(new Uint8Array(31), BY_ADA)).rejects.toThrow(RangeError);
      expect<unknown>(await database.readSigningKey()).toEqual(new Uint8Array(48).fill(0xe5));
    });

    // Drift: a backup or a dashboard page that carried the key would let whoever reads it sign a cookie for any login.
    test("no listing, export, settings read, or audit entry holds the key, before or after it is replaced", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      await database.addToken((await mintToken({ scope: "admin", note: "laptop", now: NOW })).record, BY_ADA);
      const site = await made(database, draft(REPORT, "public", DOCS));
      await database.trashSite((await made(database, draft(REPORT))).id, BY_ADA);
      await database.ensureSigningKey(FIRST_KEY, NOW);
      await database.rotateSigningKey(SECOND_KEY, BY_ADA);

      const shown = JSON.stringify([
        await database.exportSites({ limit: 100 }),
        await database.listSites({ trash: false, limit: 100 }),
        await database.listSites({ trash: true, limit: 100 }),
        await database.getSite(site.id),
        await sizeOf(database, site.id),
        await database.readTotals(),
        await database.readSettings(),
        await database.listTokens(),
        await database.listAudit({ limit: 100 }),
      ]);
      const needles = ["a1".repeat(32), "b2".repeat(32), "161,161", "178,178", '"161"', '"178"'];

      expect(needles.filter((needle) => shown.includes(needle))).toEqual([]);
      expect(shown).toContain("signed_everyone_out");
      expect<unknown>(await database.readSigningKey()).toEqual(SECOND_KEY);
    });
  });
}

function auditLog(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the audit log`, () => {
    const signed: Signed = { by: BO, at: NOW + 1 };

    // Drift: the Activity tab is only as true as this; a change with no entry, or an entry for a change that was refused, makes it lie.
    test.each([
      ["a site made", async (database: Database): Promise<unknown> => database.createSite(draft(DOCS), signed), ["create"]],
      [
        "access changed",
        async (database: Database, site: Site): Promise<unknown> => database.changeAccess(site.id, { access: "unlisted" }, signed),
        ["access"],
      ],
      ["details changed", async (database: Database, site: Site): Promise<unknown> => database.changeDetails(site.id, { title: "T" }, signed), ["details"]],
      ["a new id given", async (database: Database, site: Site): Promise<unknown> => database.giveNewId(site.id, signed), ["new_id"]],
      ["a site trashed", async (database: Database, site: Site): Promise<unknown> => database.trashSite(site.id, signed), ["trash"]],
      ["a site restored", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.restoreSite(trashed.id, signed), ["restore"]],
      ["a site deleted", async (database: Database, site: Site): Promise<unknown> => database.deleteSite(site.id, signed), ["delete"]],
      [
        "a version reserved and published",
        async (database: Database, site: Site): Promise<unknown> => [
          await database.reserveVersion(site.id),
          await database.addVersion(site.id, publish(2, 3), signed),
        ],
        ["publish"],
      ],
      [
        "a token added",
        async (database: Database): Promise<unknown> => database.addToken((await mintToken({ scope: "publisher", note: "ci", now: NOW })).record, signed),
        ["token_added"],
      ],
      [
        "the live version moved back",
        async (database: Database, site: Site): Promise<unknown> => [
          await database.reserveVersion(site.id),
          await database.addVersion(site.id, publish(2, 3), signed),
          await database.setLiveVersion(site.id, "previous", signed),
        ],
        ["publish", "live_version"],
      ],
      ["settings changed", async (database: Database): Promise<unknown> => database.changeSettings({ trash_days: 30 }, signed), ["settings_changed"]],
      [
        "a deleted site imported",
        async (database: Database, site: Site): Promise<unknown> => [await database.deleteSite(site.id, signed), await storedBack(database, site, signed)],
        ["delete", "imported"],
      ],
      ["the signing key replaced", async (database: Database): Promise<unknown> => database.rotateSigningKey(SECOND_KEY, signed), ["signed_everyone_out"]],
      ["a signing key stored where none was", async (database: Database): Promise<unknown> => database.ensureSigningKey(FIRST_KEY, NOW), []],
      ["a site imported that is already there", async (database: Database, site: Site): Promise<unknown> => storedBack(database, site, signed), []],
      ["a note appended", async (database: Database): Promise<unknown> => database.appendAudit({ action: "login", detail: {} }, signed), ["login"]],
      [
        "access set to what it is",
        async (database: Database, site: Site): Promise<unknown> => database.changeAccess(site.id, { access: "private" }, signed),
        [],
      ],
      [
        "access changed on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.changeAccess(trashed.id, { access: "unlisted" }, signed),
        [],
      ],
      [
        "details changed on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.changeDetails(trashed.id, { title: "T" }, signed),
        [],
      ],
      ["a new id for a trashed site", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.giveNewId(trashed.id, signed), []],
      ["a new id for no site", async (database: Database): Promise<unknown> => database.giveNewId(NO_SITE, signed), []],
      ["a trashed site trashed again", async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.trashSite(trashed.id, signed), []],
      ["a live site restored", async (database: Database, site: Site): Promise<unknown> => database.restoreSite(site.id, signed), []],
      ["no site deleted", async (database: Database): Promise<unknown> => database.deleteSite(NO_SITE, signed), []],
      [
        "a version reserved for a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.reserveVersion(trashed.id),
        [],
      ],
      [
        "a version published to a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.addVersion(trashed.id, publish(1, 3), signed),
        [],
      ],
      [
        "an unreserved version published",
        async (database: Database, site: Site): Promise<unknown> => database.addVersion(site.id, publish(2, 3), signed),
        [],
      ],
      ["the live version set to what it is", async (database: Database, site: Site): Promise<unknown> => database.setLiveVersion(site.id, 1, signed), []],
      [
        "the live version moved on a trashed site",
        async (database: Database, _site: Site, trashed: Site): Promise<unknown> => database.setLiveVersion(trashed.id, "previous", signed),
        [],
      ],
      ["no token revoked", async (database: Database): Promise<unknown> => database.revokeToken(BO, signed), []],
      ["settings stored a second time", async (database: Database): Promise<unknown> => database.initSettings(SETTINGS, signed), []],
      ["no setting changed", async (database: Database): Promise<unknown> => database.changeSettings({}, signed), []],
      [
        "a setting set to what it is",
        async (database: Database): Promise<unknown> =>
          database.changeSettings({ trash_days: 7, default_expires: "never", logins: SETTINGS.logins }, signed),
        [],
      ],
    ] as const)("%s writes exactly these entries: %#", async (_case, change, entries) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const trashed = await made(database, draft(REPORT));
      await database.trashSite(trashed.id, BY_ADA);
      await database.initSettings(SETTINGS, BY_ADA);
      const before = (await auditTrail(database)).length;
      await change(database, site, trashed);

      const written = (await auditTrail(database)).slice(before);

      expect<unknown>(written.map((entry) => [entry.action, entry.by, entry.at])).toEqual(entries.map((action) => [action, BO, NOW + 1]));
    });

    test("entries read back newest first, a page at a time, each with who, when, and the site as it was named then", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      await database.trashSite(site.id, { by: BO, at: NOW + 1 });
      await database.deleteSite(site.id, { by: BO, at: NOW + 2 });
      await database.appendAudit({ action: "login", detail: { from: "dashboard" } }, { by: "ada@example.com" as Login, at: NOW + 3 });
      const named = { id: site.id, name: REPORT };
      const newest = await database.listAudit({ limit: 2 });

      expect(newest).toEqual([
        { seq: 4, at: NOW + 3, by: "ada@example.com" as Login, action: "login", site: null, detail: { from: "dashboard" } },
        { seq: 3, at: NOW + 2, by: BO, action: "delete", site: named, detail: {} },
      ]);
      expect(await database.listAudit({ limit: 100, before: 3 })).toEqual([
        { seq: 2, at: NOW + 1, by: BO, action: "trash", site: named, detail: {} },
        { seq: 1, at: NOW, by: ADA, action: "create", site: named, detail: { access: "private", public_name: null } },
      ]);
      await expect(database.listAudit({ limit: 0 })).rejects.toThrow(RangeError);
    });
  });
}

function everLoggedIn(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: whether anybody has logged in`, () => {
    // Drift: the setup page is open to anyone until the first login and shut for good after it; an answer that counted another entry as a login would shut it on the person setting up, and one that missed a login under later entries would open it again.
    test("it is no before any login, whatever else the log holds, and yes from the first login on, however much is written after it", async () => {
      const database = await opened(makeDatabase);
      const by = { by: ADA, at: NOW };
      const before = await database.hasLoggedIn();
      await database.initSettings(SETTINGS, by);
      for (const action of ["domain_synced", "login_allowed", "login_denied", "signed_everyone_out"] as const) await database.appendAudit({ action, detail: { from: "login" } }, by);

      const without = await database.hasLoggedIn();
      await database.appendAudit({ action: "login", detail: {} }, by);
      const first = await database.hasLoggedIn();
      for (let entry = 0; entry < 150; entry += 1) await database.appendAudit({ action: "domain_synced", detail: { from: "setup" } }, by);

      expect([before, without, first, await database.hasLoggedIn()]).toEqual([false, false, true, true]);
    });
  });
}

function tokensAndSettings(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: tokens and settings`, () => {
    // Drift: the record `mintToken` makes is what a presented token is checked against; a field lost on the way through a row would refuse every token.
    test("a minted token's record reads back as minted, lists newest first, and is gone once revoked", async () => {
      const database = await opened(makeDatabase);
      const admin = (await mintToken({ scope: "admin", note: "laptop", now: NOW })).record;
      const publisher = (await mintToken({ scope: "publisher", note: "", now: NOW + 1 })).record;

      const impostor = { ...admin, note: "replacement" };

      expect([await database.addToken(admin, BY_ADA), await database.addToken(publisher, BY_ADA), await database.addToken(impostor, BY_ADA)]).toEqual([
        { kind: "done" },
        { kind: "done" },
        { kind: "id_taken" },
      ]);
      expect([await database.getToken(admin.id), await database.getToken(publisher.id), await database.getToken(BO)]).toEqual([admin, publisher, undefined]);
      expect(await database.listTokens()).toEqual([publisher, admin]);
      expect([await database.revokeToken(admin.id, BY_ADA), await database.revokeToken(admin.id, BY_ADA)]).toEqual([
        { kind: "done", token: admin },
        { kind: "not_found" },
      ]);
      expect(await database.listTokens()).toEqual([publisher]);
      expect((await auditTrail(database)).map((entry) => [entry.action, entry.detail])).toEqual([
        ["token_added", { token: admin.id, scope: "admin", note: "laptop" }],
        ["token_added", { token: publisher.id, scope: "publisher", note: "" }],
        ["token_revoked", { token: admin.id, scope: "admin", note: "laptop" }],
      ]);
    });

    // Drift: the token page shows this list; an order that changed between two reads would shuffle tokens made in the same millisecond.
    test("tokens made at the same moment list in descending order of id, after every newer one", async () => {
      const database = await opened(makeDatabase);
      const minted = await Promise.all(["a", "b", "c"].map((note) => mintToken({ scope: "publisher", note, now: NOW })));
      const newer = (await mintToken({ scope: "publisher", note: "d", now: NOW + 1 })).record;
      for (const token of [...minted.map((mint) => mint.record), newer]) await database.addToken(token, BY_ADA);
      const descending = minted.map((mint) => mint.record.id).sort((left, right) => (left < right ? 1 : -1));

      expect((await database.listTokens()).map((token) => token.id)).toEqual([newer.id, ...descending]);
    });

    // Drift: two admins each changing one setting must both be heard; a whole-record write would let the second silently undo the first.
    test("settings are stored once, and two changes of different keys at the same moment both land", async () => {
      const database = await opened(makeDatabase);

      expect([await database.readSettings(), await database.changeSettings({ trash_days: 30 }, BY_ADA)]).toEqual([undefined, { kind: "not_set_up" }]);
      expect(await database.initSettings(SETTINGS, BY_ADA)).toEqual({ kind: "done", values: SETTINGS });
      expect(await database.initSettings({ ...SETTINGS, trash_days: 99 }, BY_ADA)).toEqual({ kind: "already_set", values: SETTINGS });

      const size = { count: 5, unit: "GB" } as const;
      await Promise.all([
        database.changeSettings({ trash_days: 30, default_expires: { count: 7, unit: "d" } }, BY_ADA),
        database.changeSettings({ max_total_size: size, max_sites: 40 }, BY_ADA),
      ]);

      expect(await database.readSettings()).toEqual({
        ...SETTINGS,
        trash_days: 30,
        default_expires: { count: 7, unit: "d" },
        max_total_size: size,
        max_sites: 40,
      });
      expect(await database.changeSettings({ default_expires: "never", max_sites: "none" }, BY_ADA)).toEqual({
        kind: "done",
        values: { ...SETTINGS, trash_days: 30, max_total_size: size },
      });
      expect((await auditDetails(database, "settings_changed")).at(-1)).toEqual({ default_expires: "never", max_sites: "none" });
      await expect(database.changeSettings({ trash_days: 0 }, BY_ADA)).rejects.toThrow();
      await expect(database.changeSettings({ logins: [] }, BY_ADA)).rejects.toThrow();
    });
  });
}

function sweepPlace(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the place of the scheduled sweep`, () => {
    // Drift: a new instance may make every scheduled run, so the kept place is all that carries a walk from one run to the next. One that read back changed would skip sites, and one never forgotten would keep a new walk from starting.
    test("the place reads back as it was kept, the last one kept is the one read, and a forgotten one is gone", async () => {
      const database = await opened(makeDatabase);
      const inTrash = { trash: true, after: { updated_at: NOW, id: OTHER_SITE } } as const;
      const before = await database.readSweepPlace();

      await database.keepSweepPlace(inTrash);
      const first = await database.readSweepPlace();
      await database.keepSweepPlace({ leftovers: true });
      const second = await database.readSweepPlace();
      await database.keepSweepPlace(undefined);

      expect([before, first, second, await database.readSweepPlace()]).toEqual([undefined, inTrash, { leftovers: true }, undefined]);
    });
  });
}

function updateCheck(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the newest release the install knows of`, () => {
    // Drift: the day's one question about a newer version is asked again only when the kept moment is of another day. A moment or a release that read back changed would ask on every scheduled run, or show a release nobody published.
    test("what was kept reads back as it was, with a release and with none, and the last kept is the one read", async () => {
      const database = await opened(makeDatabase);
      const release = { version: "0.2.0", released: "2026-12-01", notes: "https://example.com/changelog/#v0-2-0", database: true };
      const before = await database.readUpdateCheck();

      await database.keepUpdateCheck({ checked_at: NOW, news: null });
      const none = await database.readUpdateCheck();
      await database.keepUpdateCheck({ checked_at: NOW + 1, news: release });

      expect([before, none, await database.readUpdateCheck()]).toEqual([undefined, { checked_at: NOW, news: null }, { checked_at: NOW + 1, news: release }]);
    });
  });
}

function computerLogins(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the logins of computers`, () => {
    // Drift: the record `mintComputerLogin` makes is what a presented secret is checked against, and the code is what an admin is shown; a field lost on the way through a row would refuse every login.
    test("a pending login reads back as minted by its id and by its code, and a second one under its id or its code is refused", async () => {
      const database = await opened(makeDatabase);
      const login = await pendingLogin();
      const other = await pendingLogin();

      expect([
        await database.addComputerLogin(login, ROOM),
        await database.addComputerLogin({ ...other, id: login.id }, ROOM),
        await database.addComputerLogin({ ...other, code: login.code }, ROOM),
      ]).toEqual([{ kind: "done" }, { kind: "taken" }, { kind: "taken" }]);
      expect([await database.getComputerLogin(login.id), await database.findComputerLogin(login.code), await database.getComputerLogin(other.id), await database.findComputerLogin(other.code)]).toEqual([
        login,
        login,
        undefined,
        undefined,
      ]);
      expect(await auditTrail(database)).toEqual([]);
    });

    // Drift: anyone may ask for a login, so the room is the only bound on the table and on what one visitor holds of it. A bound that counted a decided or stale login, or took its place, would lock a visitor out or lose an allowed computer its token.
    test("a visitor keeps their newest waiting logins and all visitors together no more than the room, of callers at the same moment too, and a decided or stale login neither counts nor gives way", async () => {
      const database = await opened(makeDatabase);
      const room = { perVisitor: 2, all: 4 };
      const stored = async (logins: readonly PendingLogin[]): Promise<(string | undefined)[]> => Promise.all(logins.map(async (login) => (await database.getComputerLogin(login.id))?.state));
      const [stale, allowed, denied] = [await pendingLogin(NOW - 1), await pendingLogin(), await pendingLogin()];
      for (const login of [stale, allowed, denied]) await database.addComputerLogin(login, { perVisitor: 3, all: 4 });
      await database.decideComputerLogin(allowed.code, { state: "allowed", by: ADMIN, at: NOW });
      await database.decideComputerLogin(denied.code, { state: "denied", by: ADMIN, at: NOW });

      const own = [await pendingLogin(stale.expiresAt), await pendingLogin(stale.expiresAt + 1), await pendingLogin(stale.expiresAt + 2)];
      for (const login of own) await database.addComputerLogin(login, room);
      const afterOwn = await stored([stale, allowed, denied, ...own]);

      const others = await Promise.all(["two", "three", "four"].map((visitor) => pendingLogin(stale.expiresAt + 3, visitor)));
      const added = await Promise.all(others.map((login) => database.addComputerLogin(login, room)));

      expect(afterOwn).toEqual(["pending", "allowed", "denied", undefined, "pending", "pending"]);
      expect([added, await stored([stale, allowed, denied, ...own]), (await stored(others)).filter((state) => state === "pending").length]).toEqual([
        [{ kind: "done" }, { kind: "done" }, { kind: "done" }],
        ["pending", "allowed", "denied", undefined, undefined, "pending"],
        3,
      ]);
    });

    // Drift: a decision is what turns a request into a token; one that could be made twice, after the login ran out, or without its audit entry would let a denied or stale request through unseen.
    test("a pending login is decided once and before it runs out, with one audit entry that names the scope and the computer", async () => {
      const database = await opened(makeDatabase);
      const [allowed, denied, stale] = await Promise.all([pendingLogin(), pendingLogin(), pendingLogin()]);
      for (const login of [allowed, denied, stale]) await database.addComputerLogin(login, ROOM);
      const allow = { state: "allowed", by: ADMIN, at: NOW + 1 } as const;
      const deny = { state: "denied", by: ADMIN, at: NOW + 2 } as const;

      expect([
        await database.decideComputerLogin(allowed.code, allow),
        await database.decideComputerLogin(allowed.code, deny),
        await database.decideComputerLogin(denied.code, deny),
        await database.decideComputerLogin(denied.code, allow),
        await database.decideComputerLogin(stale.code, { ...allow, at: stale.expiresAt }),
        await database.decideComputerLogin((await pendingLogin()).code, allow),
      ]).toEqual([
        { kind: "done", login: { ...allowed, state: "allowed", decidedBy: ADMIN } },
        { kind: "not_pending" },
        { kind: "done", login: { ...denied, state: "denied", decidedBy: ADMIN } },
        { kind: "not_pending" },
        { kind: "not_pending" },
        { kind: "not_pending" },
      ]);
      expect((await auditTrail(database)).map((entry) => [entry.at, entry.by, entry.action, entry.detail])).toEqual([
        [NOW + 1, ADMIN, "login_allowed", { scope: "publisher", computer: "laptop" }],
        [NOW + 2, ADMIN, "login_denied", { scope: "publisher", computer: "laptop" }],
      ]);
      expect(await database.getComputerLogin(stale.id)).toEqual(stale);
    });

    // Drift: two admins, or one who presses twice, decide at the same moment; both heard would leave a login allowed in the audit log and denied in its row.
    test("of an Allow and a Deny made at the same moment one is done, with its one audit entry", async () => {
      const database = await opened(makeDatabase);
      const login = await pendingLogin();
      await database.addComputerLogin(login, ROOM);

      const decided = await Promise.all((["allowed", "denied"] as const).map((state) => database.decideComputerLogin(login.code, { state, by: ADMIN, at: NOW + 1 })));
      const stored = await database.getComputerLogin(login.id);

      expect(decided.map((answer) => answer.kind).sort()).toEqual(["done", "not_pending"]);
      expect((await auditTrail(database)).map((entry) => entry.action)).toEqual([stored?.state === "allowed" ? "login_allowed" : "login_denied"]);
    });

    // Drift: the token is handed out once; a login that stayed after its token was stored, or two callers both served, would mint a second token nobody allowed.
    test("an allowed login gives one token, signed by who allowed it, and is gone; no other login gives any", async () => {
      const database = await opened(makeDatabase);
      const [allowed, pending, denied, stale] = await Promise.all([pendingLogin(), pendingLogin(), pendingLogin(), pendingLogin()]);
      for (const login of [allowed, pending, denied, stale]) await database.addComputerLogin(login, ROOM);
      for (const login of [allowed, stale]) await database.decideComputerLogin(login.code, { state: "allowed", by: ADMIN, at: NOW + 1 });
      await database.decideComputerLogin(denied.code, { state: "denied", by: ADMIN, at: NOW + 1 });
      const token = async (scope: "publisher" | "admin" = "publisher"): Promise<TokenRecord> => (await mintToken({ scope, note: "laptop", now: NOW + 2 })).record;

      expect([
        await database.redeemComputerLogin(pending.id, await token()),
        await database.redeemComputerLogin(denied.id, await token()),
        await database.redeemComputerLogin(stale.id, { ...(await token()), createdAt: stale.expiresAt }),
        await database.redeemComputerLogin(allowed.id, await token("admin")),
      ]).toEqual([{ kind: "not_allowed" }, { kind: "not_allowed" }, { kind: "not_allowed" }, { kind: "not_allowed" }]);

      const candidates = [await token(), await token()];
      const together = await Promise.all(candidates.map((candidate) => database.redeemComputerLogin(allowed.id, candidate)));
      const stored = await database.listTokens();
      const entries = (await auditTrail(database)).filter((entry) => entry.action === "token_added");

      expect(together.map((answer) => answer.kind).sort()).toEqual(["done", "not_allowed"]);
      expect(await database.redeemComputerLogin(allowed.id, await token())).toEqual({ kind: "not_allowed" });
      expect(await database.getComputerLogin(allowed.id)).toBeUndefined();
      expect(stored).toEqual(candidates.filter((_candidate, index) => together[index]?.kind === "done"));
      expect(entries.map((entry) => [entry.at, entry.by, entry.detail])).toEqual([[NOW + 2, ADMIN, { token: stored[0]?.id, scope: "publisher", note: "laptop" }]]);
    });

    // Drift: a login nobody decided or collected would stay for ever; a sweep that took a live one would end a login a person is in the middle of.
    test("the sweep removes every login that ran out, whatever its state, and leaves the others", async () => {
      const database = await opened(makeDatabase);
      const [old, decided, live] = await Promise.all([pendingLogin(), pendingLogin(), pendingLogin(NOW + 1)]);
      for (const login of [old, decided, live]) await database.addComputerLogin(login, ROOM);
      await database.decideComputerLogin(decided.code, { state: "allowed", by: ADMIN, at: NOW + 1 });

      expect([await database.sweepComputerLogins(old.expiresAt - 1), await database.sweepComputerLogins(old.expiresAt), await database.sweepComputerLogins(old.expiresAt)]).toEqual([0, 2, 0]);
      expect([await database.getComputerLogin(old.id), await database.getComputerLogin(decided.id), await database.getComputerLogin(live.id)]).toEqual([undefined, undefined, live]);
    });
  });
}

function loginRoom(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: which waiting login gives way`, () => {
    // Drift: the order is (most held, oldest, smallest id). A store that compared times as text would keep 999 over 1000, and one that broke a tie by visitor would evict another login than the next store does.
    test("the oldest login of the visitor with the most gives way, by the number of its time and not its digits, and of two asked at one moment the one with the smaller id", async () => {
      const database = await opened(makeDatabase);
      const room = { perVisitor: 3, all: 4 };
      const asked = async (visitor: string, at: number, id: string): Promise<PendingLogin> => ({ ...(await pendingLogin(at, visitor)), id: id as LoginId });
      const [early, first, second, later] = [await asked("two", 998, "00000000000000d4"), await asked("one", 999, "00000000000000c3"), await asked("one", 1000, "00000000000000b2"), await asked("two", 1000, "00000000000000a1")];
      const waiting = async (): Promise<string[]> => {
        const stored = await Promise.all([early, first, second, later].map((login) => database.getComputerLogin(login.id)));

        return stored.flatMap((login) => (login === undefined ? [] : [`${login.visitor} at ${login.createdAt}`]));
      };
      const after: string[][] = [];

      for (const login of [early, first, second, later]) await database.addComputerLogin(login, room);
      for (const [at, visitor] of [
        [1001, "three"],
        [1002, "four"],
        [1003, "five"],
      ] as const) {
        await database.addComputerLogin(await pendingLogin(at, visitor), room);
        after.push(await waiting());
      }

      expect(after).toEqual([
        ["one at 999", "one at 1000", "two at 1000"],
        ["one at 1000", "two at 1000"],
        ["one at 1000"],
      ]);
    });
  });
}

function requestCounts(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the day's request counts`, () => {
    // Drift: the limits on a day's requests read these two numbers; a site's requests left out of the total, or yesterday's carried over, would refuse the wrong site.
    test("two sites add to their own counts and to one total, a read changes nothing, and a new day starts from nothing", async () => {
      const database = await opened(makeDatabase);

      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 0, all: 0 });
      expect(await database.addRequests({ day: TODAY, site: NO_SITE, requests: 50 })).toEqual({ site: 50, all: 50 });
      expect(await database.addRequests({ day: TODAY, site: OTHER_SITE, requests: 1 })).toEqual({ site: 1, all: 51 });
      expect(await database.addRequests({ day: TODAY, site: NO_SITE, requests: 50 })).toEqual({ site: 100, all: 101 });
      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 100, all: 101 });
      expect([await database.readRequests(TODAY), await database.readRequests(TOMORROW)]).toEqual([
        { site: 0, all: 101 },
        { site: 0, all: 0 },
      ]);
      expect([await database.readRequests(TOMORROW, NO_SITE), await database.readRequests(TODAY, NO_SITE)]).toEqual([
        { site: 0, all: 0 },
        { site: 100, all: 101 },
      ]);
      expect(await database.addRequests({ day: TOMORROW, site: OTHER_SITE, requests: 2 })).toEqual({ site: 2, all: 2 });
      expect([await database.readRequests(TODAY, NO_SITE), await database.readRequests(TODAY, OTHER_SITE)]).toEqual([
        { site: 100, all: 101 },
        { site: 1, all: 101 },
      ]);
      await expect(database.readRequests("today", NO_SITE)).rejects.toThrow(RangeError);
      expect(await auditTrail(database)).toEqual([]);
    });

    // Drift: a site's views are a sum over seven UTC days read by day and site; a day too many, a day of another month sorted wrongly, or another site's rows would show opens that never were.
    test("views add up per site over the day and the six before it, across a month's end, apart from the requests, and a count older than that is dropped with the next addition", async () => {
      const database = await opened(makeDatabase);
      const counted = [
        { day: "2026-10-25", site: NO_SITE, requests: 9, views: 9 },
        { day: "2026-10-26", site: NO_SITE, requests: 50, views: 50 },
        { day: "2026-10-31", site: NO_SITE, requests: 4, views: 3 },
        { day: "2026-11-01", site: NO_SITE, requests: 10, views: 2 },
        { day: "2026-11-01", site: NO_SITE, requests: 5 },
        { day: "2026-11-01", site: OTHER_SITE, requests: 7, views: 7 },
      ];
      for (const one of counted) await database.addRequests(one);

      expect([...(await database.readViews([NO_SITE, OTHER_SITE, "bbbbbbbbbbbb" as SiteId], "2026-11-01"))]).toEqual([
        [NO_SITE, { today: 2, week: 55 }],
        [OTHER_SITE, { today: 7, week: 7 }],
        ["bbbbbbbbbbbb" as SiteId, { today: 0, week: 0 }],
      ]);
      expect([...(await database.readViews([NO_SITE], "2026-10-31"))]).toEqual([[NO_SITE, { today: 3, week: 53 }]]);
      expect([await database.readViews([], "2026-11-01"), await database.readRequests("2026-11-01", NO_SITE)]).toEqual([new Map(), { site: 15, all: 22 }]);

      await database.addRequests({ day: "2026-11-02", site: OTHER_SITE, requests: 1 });

      expect([...(await database.readViews([NO_SITE], "2026-11-01"))]).toEqual([[NO_SITE, { today: 2, week: 5 }]]);
      await expect(database.readViews([NO_SITE], "tomorrow")).rejects.toThrow(RangeError);
    });

    // Drift: the counts are kept under a site's id, and a new link changes the id; counts left under the old one would show a site nobody ever opened, and free its share of the day.
    test("a site that gets a new id keeps its views and its day's requests under it, a site named twice is read once, and no other site's counts move", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft("report" as SiteName));
      const other = await made(database, draft("notes" as SiteName));
      const day = new Date(NOW).toISOString().slice(0, 10);
      const old = new Date(NOW - 7 * 86_400_000).toISOString().slice(0, 10);
      await database.addRequests({ day, site: site.id, requests: 15, views: 12 });
      await database.addRequests({ day, site: other.id, requests: 4, views: 3 });
      // Counted last, so no later count drops it: only the move could take it along.
      await database.addRequests({ day: old, site: site.id, requests: 9, views: 9 });

      const moved = await database.giveNewId(site.id, BY_ADA);
      if (moved.kind !== "done") throw new Error("no new id was given");

      expect([...(await database.readViews([moved.site.id, moved.site.id, site.id, other.id], day))]).toEqual([
        [moved.site.id, { today: 12, week: 12 }],
        [site.id, { today: 0, week: 0 }],
        [other.id, { today: 3, week: 3 }],
      ]);
      expect([await database.readRequests(day, moved.site.id), await database.readRequests(day, site.id), await database.readRequests(old, moved.site.id)]).toEqual([
        { site: 15, all: 19 },
        { site: 0, all: 19 },
        { site: 0, all: 9 },
      ]);
    });

    // Drift: additions from several Worker instances land at once; one read back and written again would lose the others.
    test("additions made at the same moment are all kept", async () => {
      const database = await opened(makeDatabase);
      await Promise.all(Array.from({ length: 20 }, () => database.addRequests({ day: TODAY, site: NO_SITE, requests: 5 })));

      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 100, all: 100 });
    });

    // Drift: days are compared as text, so a day in another form would sort wrongly and be dropped or kept forever.
    test.each([
      { day: "2026-11-13T00:00", requests: 1 },
      { day: "today", requests: 1 },
      { day: TODAY, requests: 0 },
      { day: TODAY, requests: 1.5 },
      { day: TODAY, requests: 2, views: 3 },
      { day: TODAY, requests: 2, views: -1 },
      { day: TODAY, requests: 2, views: 0.5 },
    ])("day $day with $requests requests and $views views is refused and nothing is counted", async ({ day, requests, views }) => {
      const database = await opened(makeDatabase);

      await expect(database.addRequests({ day, site: NO_SITE, requests, views })).rejects.toThrow(RangeError);
      expect(await database.readRequests(TODAY, NO_SITE)).toEqual({ site: 0, all: 0 });
    });
  });
}

function uploadFiles(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the files of an upload`, () => {
    // Drift: a file request finds its one file among thousands by path; a lookup that matched a near path, or another upload's file, would store bytes at the wrong length.
    test("one file is found among 5,000 by its exact path, the first and the last alike, and each of two uploads that share a path answers its own file", async () => {
      const database = await opened(makeDatabase);
      const large = await begunFiles(database, numberedFiles(5000));
      const small = await begunFiles(database, numberedFiles(3).map((file) => ({ ...file, size: file.size + 100, content_type: "text/plain" })));
      const found = async (id: UploadId, path: string): Promise<unknown> => (await database.getUploadFile(id, path))?.file ?? "none";
      const paths = ["page-0.html", "page-2.html", "page-4999.html", "page-5000.html", "page-499", "Page-2.html", "page-2.html/", ""];

      expect(await Promise.all(paths.map((path) => found(large, path)))).toEqual([
        { path: "page-0.html", size: 0, content_type: "text/html" },
        { path: "page-2.html", size: 2, content_type: "text/html" },
        { path: "page-4999.html", size: 4999, content_type: "text/html" },
        "none",
        "none",
        "none",
        "none",
        "none",
      ]);
      expect([await found(small, "page-2.html"), await found(small, "page-3.html")]).toEqual([{ path: "page-2.html", size: 102, content_type: "text/plain" }, "none"]);
      expect([(await database.getUpload(large))?.manifest.length, (await database.getUploadFile(large, ""))?.upload.files]).toEqual([5000, 5000]);
    });

    // Drift: a path is any text a key may be; one read as a number, as a JSON path, or as a property of an object would be found under another file, or moved to the front of the list a finish compares in order.
    test("paths made of digits, of JSON path signs, of quotes, of the names an object is born with, and two of one hash are each found as written, and the manifest keeps their order", async () => {
      const database = await opened(makeDatabase);
      // The second path and the last have one hash of 32 bits, 96444b56, by the FNV-1a rule.
      const signs = ["index.html", "page-2794.html", "2024", "10", "9", "$", "$.a", "$[0]", "a.b[0]", "[1]", "0/0", 'say "hi"', "it's", "100%_done"];
      const paths = [...signs, "constructor", "__proto__", "toString", "length", "\u00fc/\u{1F600}.html", " ", `${"long/".repeat(200)}page.html`, "page-64060.html"];
      const manifest = paths.map((path, index) => ({ path, size: index, content_type: `text/x-${index}; charset="utf-8"` }));
      const upload = await begunFiles(database, manifest);
      const each = await Promise.all(paths.map(async (path) => (await database.getUploadFile(upload, path))?.file));
      const absent = await Promise.all(["0", "$.b", "[0]", "a", "valueOf", '"index.html"', "'index.html'", "index.html ", "f96444b56"].map(async (path) => (await database.getUploadFile(upload, path))?.file));

      expect([(await database.getUpload(upload))?.manifest, each]).toEqual([manifest, manifest]);
      expect(absent.filter((file) => file !== undefined)).toEqual([]);
    });

    // Drift: a path names one file; an upload recorded with a path twice would answer one size for it and hold another in its manifest.
    test("an upload whose manifest names a path twice is refused whole", async () => {
      const database = await opened(makeDatabase);
      const site = { ...draft(REPORT), embeddable: true };
      const twice = [...MANIFEST, { path: "index.html", size: 1, content_type: "text/plain" }];
      const upload: NewUpload = { id: mintUploadId(), folder: site.folder, number: 1, owner: ADA, plan: { kind: "create", site }, manifest: twice, created_at: NOW };

      await expect(database.addUpload(upload, ROOMY)).rejects.toThrow();
      expect([await database.getUpload(upload.id), await database.getUploadFile(upload.id, "index.html")]).toEqual([undefined, undefined]);
    });
  });
}

function uploads(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: uploads`, () => {
    // Drift: every later step reads the upload back; a manifest that lost a path's quotes or a file's size would store a file under the wrong key or at the wrong length.
    test("an upload reads back as recorded, one file of it is found by its exact path, and an upload given up keeps no manifest", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const created = await begunSite(database, draft(REPORT));
      const updated = await begunVersion(database, site);
      const read = await database.getUpload(created.id);
      const quoted = await database.getUploadFile(created.id, MANIFEST[1]?.path ?? "");
      const unnamed = await database.getUploadFile(created.id, "index.htm");
      await database.abandonUpload(updated);

      expect(read).toEqual({
        upload: {
          id: created.id,
          folder: created.site.folder,
          number: 1,
          owner: ADA,
          state: "pending",
          plan: { kind: "create", site: created.site },
          bytes: 1000,
          files: 2,
          dropped: [],
          created_at: NOW,
        },
        manifest: MANIFEST,
      } as never);
      expect<unknown>([quoted, unnamed?.file, await database.getUploadFile(mintUploadId(), "index.html")]).toEqual([{ upload: read?.upload, file: MANIFEST[1] }, undefined, undefined]);
      expect(await auditActions(database)).toEqual(["create"]);
      expect([(await database.getUpload(updated))?.manifest, (await database.getUploadFile(updated, "index.html"))?.file]).toEqual([[], undefined]);
    });

    // Drift: finishing is the one step that makes files live; a site made twice, or made from an upload that was given up, would serve files nobody meant to publish.
    test("an upload becomes a site once: of two finishes at the same moment one makes it, and an abandoned upload makes none", async () => {
      const database = await opened(makeDatabase);
      const live = await begunSite(database, draft(REPORT));
      const given = await begunSite(database, draft(REPORT));
      await database.abandonUpload(given.id);

      const [first, second] = await Promise.all([database.publishUploadAsSite(live.id, live.site, BY_ADA), database.publishUploadAsSite(live.id, live.site, BY_ADA)]);
      const lost = await database.publishUploadAsSite(given.id, given.site, BY_ADA);
      const elsewhere = await database.publishUploadAsSite(given.id, draft(REPORT), BY_ADA);

      expect([first.kind, second.kind].sort()).toEqual(["done", "not_pending"]);
      expect([lost.kind, elsewhere.kind, (await database.getUpload(live.id))?.upload.state]).toEqual(["not_pending", "not_pending", "finished"]);
      expect([await auditActions(database), await database.readTotals()]).toEqual([["create"], { sites: 1, trashed_sites: 0, bytes: 1000, files: 4 }]);
    });

    // Drift: a public name taken while the files were uploading must leave the upload pending, so the files it holds are still owned by a record that can be given up.
    test("an upload whose public name another site took in the meantime makes no site and stays pending", async () => {
      const database = await opened(makeDatabase);
      const upload = await begunSite(database, draft(REPORT, "public", DOCS));
      await made(database, draft(REPORT, "public", DOCS));

      expect(await database.publishUploadAsSite(upload.id, upload.site, BY_ADA)).toEqual({ kind: "name_taken" });
      expect([(await database.getUpload(upload.id))?.upload.state, await auditActions(database)]).toEqual(["pending", ["create"]]);
    });

    // Drift: an import's files are in the store before its site is; a site stored twice, or stored from an import that was given up while its files were removed, would be served with files missing.
    test("an import becomes its site once, as the backup held it: of two finishes at the same moment one stores it, and an import that was given up stores none", async () => {
      const database = await opened(makeDatabase);
      const first = await made(database, draft(REPORT, "public", DOCS), BY_BO_LATER);
      const second = await made(database, draft(REPORT));
      for (const site of [first, second]) await database.deleteSite(site.id, BY_ADA);
      const live = await begunImport(database, first);
      const given = await begunImport(database, second);
      await database.abandonUpload(given.id);

      const signed = { by: ADA, at: NOW + 99 };
      const finishes = await Promise.all([database.importUploadAsSite(live.id, live.site, signed), database.importUploadAsSite(live.id, live.site, signed)]);
      const lost = await database.importUploadAsSite(given.id, given.site, signed);
      const elsewhere = await database.importUploadAsSite(given.id, { ...given.site, folder: mintSiteFolder() }, signed);

      expect(finishes.map((finish) => finish.kind).sort()).toEqual(["done", "not_pending"]);
      expect(finishes.find((finish) => finish.kind === "done")).toEqual({ kind: "done", site: live.site });
      expect([lost.kind, elsewhere.kind, (await database.getUpload(live.id))?.upload.state, (await database.getUpload(given.id))?.upload.state]).toEqual(["not_pending", "not_pending", "finished", "abandoned"]);
      expect([await database.getSite(first.id), await database.getSite(second.id), await database.readTotals()]).toEqual([live.site, undefined, { sites: 1, trashed_sites: 0, bytes: 1000, files: 4 }]);
      expect((await auditTrail(database)).slice(4).map((entry) => [entry.action, entry.by, entry.at, entry.site?.id, entry.detail])).toEqual([["imported", ADA, NOW + 99, first.id, { versions: 1 }]]);
    });

    // Drift: what a refused import leaves pending still owns its files; one marked finished without its site, or one that changed the site in its way, would lose track of one of the two.
    test.each([
      ["its id is a site's", "id_taken", (site: Site, held: Site): Site => ({ ...site, id: held.id })],
      ["its id is a site's public name", "id_taken", (site: Site): Site => ({ ...site, id: "cccccccccccc" as SiteId })],
      ["its public name is a site's", "name_taken", (site: Site): Site => ({ ...site, access: "public", public_name: "cccccccccccc" as PublicName })],
      ["its public name is a site's id", "name_taken", (site: Site, held: Site): Site => ({ ...site, access: "public", public_name: held.id as string as PublicName })],
    ] as const)("an import is refused with %s as %s: nothing is stored, and the upload stays pending", async (_case, kind, change) => {
      const database = await opened(makeDatabase);
      const held = await made(database, draft(REPORT, "public", "cccccccccccc" as PublicName));
      const gone = await made(database, draft(REPORT));
      await database.deleteSite(gone.id, BY_ADA);
      const upload = await begunImport(database, change(gone, held));
      const before = await everything(database);

      expect(await database.importUploadAsSite(upload.id, upload.site, BY_ADA)).toEqual({ kind });
      expect([await everything(database), (await database.getUpload(upload.id))?.upload.state]).toEqual([before, "pending"]);
    });

    // Drift: the folder of an import is made for it; a site already in it means its files are another site's, which the row must refuse whatever the caller checked before.
    test("an import whose folder is a site's is refused with folder_taken, and one that is no site throws: both leave the upload pending", async () => {
      const database = await opened(makeDatabase);
      const held = await made(database, draft(REPORT));
      const gone = await made(database, draft(REPORT));
      await database.deleteSite(gone.id, BY_ADA);
      const upload: NewUpload = { id: mintUploadId(), folder: held.folder, number: 1, owner: ADA, plan: { kind: "import", site: {} }, manifest: MANIFEST, created_at: NOW };
      await database.addUpload(upload, ROOMY);
      const before = await everything(database);

      expect(await database.importUploadAsSite(upload.id, { ...gone, folder: held.folder }, BY_ADA)).toEqual({ kind: "folder_taken" });
      await expect(database.importUploadAsSite(upload.id, { ...gone, folder: held.folder, live_version: 9 }, BY_ADA)).rejects.toThrow();
      expect([await everything(database), (await database.getUpload(upload.id))?.upload.state]).toEqual([before, "pending"]);
    });

    // Drift: the settings asked with an update go live with its version; a refused version that had already changed the access would publish old content under a new access.
    test.each([
      ["a higher version already kept", { access: { access: "public", public_name: DOCS }, details: { title: "Q3 sales" } }, "stale", "stale_number"],
      ["a public name another site holds", { access: { access: "public", public_name: "taken" as PublicName }, details: { title: "Q3 sales" } }, "none", "name_taken"],
      ["a site in the trash", { details: { title: "Q3 sales" } }, "trash", "in_trash"],
      ["a site that is gone", { details: { title: "Q3 sales" } }, "delete", "not_found"],
    ] as const)("an update refused for %s changes neither the site's settings nor its versions, and writes no audit entry", async (_why, asked, before, refusal) => {
      const database = await opened(makeDatabase);
      await made(database, draft(REPORT, "public", "taken" as PublicName));
      const site = await made(database, draft(REPORT));
      const upload = await begunVersion(database, site);
      if (before === "stale") await database.publishUploadAsVersion(await begunVersion(database, site), { keep: 3, details: {} }, BY_ADA);
      if (before === "trash") await database.trashSite(site.id, BY_ADA);
      if (before === "delete") await database.deleteSite(site.id, BY_ADA);
      const stored = await everything(database);

      expect(await database.publishUploadAsVersion(upload, { keep: 3, ...asked }, BY_BO_LATER)).toEqual({ kind: refusal });
      expect([await everything(database), (await database.getUpload(upload))?.upload.state]).toEqual([stored, "pending"]);
    });

    // Drift: the versions a publish drops are named in the upload's record, which is all that tells the sweep whose files to remove after a crash.
    test("an update goes live with its settings in one step, each with its audit entry, and its record names the versions it dropped", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const second = await begunVersion(database, site);
      const third = await begunVersion(database, site);
      await database.publishUploadAsVersion(second, { keep: 2, details: {} }, BY_ADA);

      const settings = { access: { access: "public", public_name: DOCS }, details: { title: "Q3 sales", embeddable: false } } as const;
      const published = await database.publishUploadAsVersion(third, { keep: 1, ...settings }, BY_BO_LATER);
      const again = await database.publishUploadAsVersion(third, { keep: 1, access: { access: "unlisted" }, details: { title: "changed" } }, BY_BO_LATER);
      const live = { access: "public", public_name: DOCS, title: "Q3 sales", embeddable: false, live_version: 3, updated_at: NOW + 5 };

      expect(published).toMatchObject({ kind: "done", dropped: [1, 2], site: { ...live, versions: [{ number: 3, bytes: 1000, files: 2, published_by: BO }] } });
      expect([again, await database.getUpload(third)]).toMatchObject([{ kind: "not_pending" }, { manifest: [], upload: { state: "finished", dropped: [1, 2] } }]);
      expect(await auditActions(database)).toEqual(["create", "publish", "access", "details", "publish"]);
      expect([await database.getSiteByFolder(site.folder), await database.readTotals()]).toMatchObject([{ id: site.id, title: "Q3 sales" }, { sites: 1, bytes: 1000, files: 2 }]);
    });

    // Drift: the typed title and the page's own are two columns; a version that wrote its page's title over the typed one would lose a title the owner set.
    test("a version brings its page's title and leaves the typed one, a typed title taken away leaves the page's, and a backup carries both", async () => {
      const database = await opened(makeDatabase);
      const begun = await begunSite(database, { ...draft(REPORT), page_title: "Field notes" });
      const created = await database.publishUploadAsSite(begun.id, begun.site, BY_ADA);
      if (created.kind !== "done") throw new Error(`the fixture site was refused: ${created.kind}`);

      const { site } = created;
      const typed = await database.changeDetails(site.id, { title: "Q3 sales" }, BY_ADA);
      const second = await database.publishUploadAsVersion(await begunVersion(database, site), { keep: 3, details: {}, page_title: "Second page" }, BY_ADA);
      const [exported] = (await database.exportSites({ limit: 1 })).sites;
      const cleared = await database.changeDetails(site.id, { title: null }, BY_ADA);
      const third = await database.publishUploadAsVersion(await begunVersion(database, site), { keep: 3, details: {} }, BY_ADA);
      if (exported === undefined) throw new Error("the fixture site is not exported");

      await database.deleteSite(site.id, BY_ADA);
      const back = await begunImport(database, exported);
      const imported = await database.importUploadAsSite(back.id, back.site, BY_ADA);

      expect([site, typed, second, cleared, third, imported]).toMatchObject([
        { title: null, page_title: "Field notes" },
        { site: { title: "Q3 sales", page_title: "Field notes" } },
        { site: { title: "Q3 sales", page_title: "Second page", live_version: 2 } },
        { site: { title: null, page_title: "Second page" } },
        { site: { title: null, page_title: null, live_version: 3 } },
        { kind: "done", site: { title: "Q3 sales", page_title: "Second page", live_version: 2 } },
      ]);
      expect(await auditActions(database)).toEqual(["create", "details", "publish", "details", "publish", "delete", "imported"]);
    });

    // Drift: the sweep removes a record only after its files; a pending record that could be removed would orphan the files still being uploaded under it.
    test("a record is removed only once it is finished or abandoned, and old uploads list a page at a time, the oldest first", async () => {
      const database = await opened(makeDatabase);
      const ids: UploadId[] = [];
      for (const age of [3, 1, 2]) ids.push((await begunSite(database, draft(REPORT), NOW - age)).id);

      const [oldest, newest, middle] = ids as [UploadId, UploadId, UploadId];
      const first = await database.listUploads({ before: NOW, limit: 2 });
      const rest = await database.listUploads({ before: NOW, limit: 2, after: first.next });
      const kept = await database.removeUpload(oldest);
      const given = [await database.abandonUpload(oldest), await database.abandonUpload(oldest), await database.removeUpload(oldest), await database.removeUpload(oldest)];

      expect([first.uploads.map((upload) => upload.id), rest.uploads.map((upload) => upload.id), rest.next]).toEqual([[oldest, middle], [newest], undefined]);
      expect([(await database.listUploads({ before: NOW - 2, limit: 2 })).uploads.length, kept, given]).toEqual([0, false, [true, false, true, false]]);
      await expect(database.listUploads({ before: NOW, limit: 101 })).rejects.toThrow(RangeError);
    });

    // Drift: these are uploads no later step could store a file for or finish; each row is one the database must refuse to record.
    test.each([
      ["a second upload under the same folder and number", (upload: NewUpload): NewUpload => ({ ...upload, id: mintUploadId() })],
      ["a second upload with the same id", (upload: NewUpload): NewUpload => ({ ...upload, folder: mintSiteFolder() })],
      ["an upload of no file", (upload: NewUpload): NewUpload => ({ ...upload, id: mintUploadId(), folder: mintSiteFolder(), manifest: [] })],
      ["a file of a negative size", (upload: NewUpload): NewUpload => ({ ...upload, id: mintUploadId(), folder: mintSiteFolder(), manifest: [{ ...MANIFEST[0], size: -1 }] as never })],
      ["an id that is none", (upload: NewUpload): NewUpload => ({ ...upload, id: "nope" as UploadId, folder: mintSiteFolder() })],
    ])("%s is refused, and nothing of it is kept", async (_state, change) => {
      const database = await opened(makeDatabase);
      const { folder } = draft(REPORT);
      const upload: NewUpload = { id: mintUploadId(), folder, number: 2, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW };
      await database.addUpload(upload, ROOMY);

      await expect(database.addUpload(change(upload), ROOMY)).rejects.toThrow();
      expect((await database.listUploads({ before: NOW + 1, limit: 10 })).uploads.length).toBe(1);
    });

    // Drift: the limits bound what the bucket and the database hold; an upload measured in one step and recorded in the next would let requests sent together pass every limit at once.
    test.each([
      ["its owner's pending uploads", { own: 2 }, "version", 1, "own_full"],
      ["the bytes pending under its folder", { folderBytes: 2000 }, "version", 1, "folder_full"],
      ["the bytes of its folder with the site's newest version", { folderBytes: 2000, staying: 1 }, "version", 0, "folder_full"],
      ["the bytes of every site and every pending upload", { totalBytes: 4000 }, "version", 1, "total_full"],
      ["the sites there are and are being made", { sites: 3 }, "site", 1, "sites_full"],
      ["the files declared on its day", { dayFiles: 6 }, "version", 1, "day_full"],
    ] as const)("of three uploads recorded at the same moment only as many are kept as fit the room for %s", async (_bound, bound, kind, fit, refusal) => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const room = { ...ROOMY, ...bound };
      const version = (number: number): NewUpload => ({ id: mintUploadId(), folder: site.folder, number, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW });
      const candidate = (number: number): NewUpload => (kind === "version" ? version(number) : { ...version(1), folder: mintSiteFolder() });
      await database.addUpload({ ...version(1), folder: mintSiteFolder() }, ROOMY);
      await database.addUpload({ ...version(2), owner: BO }, ROOMY);

      const together = await Promise.all([3, 4, 5].map((number) => database.addUpload(candidate(number), room)));
      const kinds = together.map((added) => added.kind).sort();

      expect(kinds).toEqual([...Array.from({ length: fit }, () => "done" as const), ...Array.from({ length: 3 - fit }, () => refusal)].sort());
      expect((await database.listUploads({ before: NOW + 1, limit: 10 })).uploads.length).toBe(2 + fit);
    });

    // Drift: the record of a finished upload is all that says which dropped versions still have files; one that could not be shortened would have every removal start over.
    test("the dropped versions of a finished upload are set to the ones still to go, and those of a pending upload are left alone", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const finished = await begunVersion(database, site);
      const pending = await begunVersion(database, site);
      await database.publishUploadAsVersion(finished, { keep: 1, details: {} }, BY_ADA);
      await database.setUploadDropped(finished, []);
      await database.setUploadDropped(pending, [1]);

      expect([(await database.getUpload(finished))?.upload.dropped, (await database.getUpload(pending))?.upload.dropped]).toEqual([[], []]);
    });

    // Drift: a site made by an admin finishing a publisher's upload must stay the publisher's, or the publisher loses the site it uploaded.
    test("a site made from an upload belongs to whoever began the upload, and its audit entry to whoever finished it", async () => {
      const database = await opened(makeDatabase);
      const upload = await begunSite(database, draft(REPORT));
      const made = await database.publishUploadAsSite(upload.id, upload.site, BY_BO_LATER);

      expect(made).toMatchObject({ kind: "done", site: { owner: ADA, created_at: NOW + 5, versions: [{ published_by: ADA }] } });
      expect((await auditTrail(database)).map((entry) => [entry.action, entry.by])).toEqual([["create", BO]]);
    });
  });
}

function declaredFiles(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the files declared in a day`, () => {
    // Drift: every stored file is a bucket operation the host bills past a monthly amount. A count that an upload given up gave back would let a loop of begin and abandon store without end, and one that outlived its day would refuse tomorrow's publish.
    test("the files of every upload begun on a day count against that day, an upload given up gives none back, the next day begins at none, and one begun late for the day before still counts against it", async () => {
      const database = await opened(makeDatabase);
      const site = await made(database, draft(REPORT));
      const room = { ...ROOMY, dayFiles: 4 };
      const begin = async (number: number, day: string): Promise<{ readonly id: UploadId; readonly kind: string }> => {
        const id = mintUploadId();
        const added = await database.addUpload({ id, folder: site.folder, number, owner: ADA, plan: { kind: "update", details: {} }, manifest: MANIFEST, created_at: NOW }, { ...room, day });

        return { id, kind: added.kind };
      };

      const first = await begin(2, TODAY);
      await database.abandonUpload(first.id);
      const kinds = [first.kind];
      for (const [number, day] of [[3, TODAY], [4, TODAY], [5, TOMORROW], [6, TODAY], [7, TOMORROW], [8, TOMORROW]] as const) kinds.push((await begin(number, day)).kind);

      expect(kinds).toEqual(["done", "done", "day_full", "done", "day_full", "done", "day_full"]);
    });
  });
}

/**
 * Register the contract every `Database` keeps, whatever it stores its records in.
 *
 * @param makeDatabase - gives a new, empty database on every call; it draws its site ids from the function a case passes, and at random when none is passed
 */
export function describeDatabase(label: string, makeDatabase: DatabaseFactory): void {
  emptyInstall(label, makeDatabase);
  sites(label, makeDatabase);
  versions(label, makeDatabase);
  sizes(label, makeDatabase);
  backups(label, makeDatabase);
  signingKey(label, makeDatabase);
  auditLog(label, makeDatabase);
  everLoggedIn(label, makeDatabase);
  tokensAndSettings(label, makeDatabase);
  computerLogins(label, makeDatabase);
  loginRoom(label, makeDatabase);
  sweepPlace(label, makeDatabase);
  updateCheck(label, makeDatabase);
  requestCounts(label, makeDatabase);
  uploads(label, makeDatabase);
  uploadFiles(label, makeDatabase);
  declaredFiles(label, makeDatabase);
}
