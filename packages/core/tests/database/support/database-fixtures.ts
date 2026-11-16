// What the cases of the database contract share: the fixture values, and the helpers that make a site, an upload or a login through the interface.


import { mintComputerLogin, type PendingLogin } from "../../../src/auth/computer-logins";
import type { Login } from "../../../src/auth/logins";
import type { TokenId } from "../../../src/auth/tokens";
import type { Database, Done, NewSite, NewUpload, Published, Refused, Signed, SitesPage, SitesQuery } from "../../../src/database/database";
import type { PublicName, SiteName } from "../../../src/names/names";
import type { AuditAction, AuditEntry } from "../../../src/records/audit";
import { defaultSettings } from "../../../src/records/settings";
import { mintSiteFolder, type Site } from "../../../src/records/site";
import type { Totals } from "../../../src/records/sizes";
import type { SiteId } from "../../../src/sites/ids";
import { type ManifestFile, mintUploadId, type UploadId } from "../../../src/records/upload";
import type { VersionContents } from "../../../src/records/version-contents";

/** The moment the fixtures are made at. */
export const NOW = 1_700_000_000_000;

/** A token's id, standing for the first of two people. */
export const ADA = "00000000000000aa" as TokenId;

/** A token's id, standing for the second. */
export const BO = "00000000000000bb" as TokenId;

/** A change made by the first person at the fixture moment. */
export const BY_ADA: Signed = { by: ADA, at: NOW };

/** A site name, which is a valid public name too. */
export const REPORT = "report" as SiteName;

/** A public name. */
export const DOCS = "docs" as PublicName;

/** An id in the form of a site id that no fixture site gets. */
export const NO_SITE = "zzzzzzzzzzzz" as SiteId;

/** The size of a fixture version whose size the case does not look at. */
export const SIZE = { bytes: 1000, files: 4 };

/** What an install with no site holds. */
export const NOTHING: Totals = { sites: 0, trashed_sites: 0, bytes: 0, files: 0 };

/** A visitor key of one repeated byte, so a leak of it shows which key leaked. */
export const FIRST_KEY = new Uint8Array(32).fill(0xa1);

/** A second visitor key, of another byte. */
export const SECOND_KEY = new Uint8Array(32).fill(0xb2);

/** A third visitor key, of another byte again. */
export const THIRD_KEY = new Uint8Array(32).fill(0xc3);

/** A UTC day requests are counted on. */
export const TODAY = "2026-11-13";

/** The day after it. */
export const TOMORROW = "2026-11-14";

/** An id in the form of a site id, standing for a second site whose requests are counted. */
export const OTHER_SITE = "aaaaaaaaaaaa" as SiteId;

/** A hash in the form a declared file names one: the SHA-256 of `<h1>hi</h1>`, which no fixture file here holds. The database keeps it and never reads it. */
export const SHA256 = "5/u2+79M4pSRPrYrU/8Dp1RmSc/cDYJNnjorRUFQL38=";

/** The files a fixture upload declares: 1000 bytes in two files, one under a path that needs quoting. */
export const MANIFEST = [
  { path: "index.html", size: 700, content_type: "text/html", sha256: SHA256 },
  { path: "it's \"quoted\"/100%.css", size: 300, content_type: "text/css", sha256: SHA256 },
];

/** Room no fixture upload fills. */
export const ROOMY = { own: 100, folderBytes: 1_000_000, staying: 0, totalBytes: 1_000_000, sites: null, day: "2026-11-13", dayFiles: 1_000_000, writes: 2, dayWrites: 1_000_000 };

/** The room of the uploads the fixture sites and versions are made through: bounded by nothing, and counted on a day no case counts on. */
const FIXTURE_ROOM = { ...ROOMY, folderBytes: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER, day: "2026-01-01", dayFiles: Number.MAX_SAFE_INTEGER, writes: 0 };

/** A change made by the second person a moment later. */
export const BY_BO_LATER: Signed = { by: BO, at: NOW + 5 };

/** The settings of a new install. */
export const SETTINGS = defaultSettings({ installer: "ada@example.com" as Login });

/** The admin who decides the fixture logins. */
export const ADMIN = "ada@example.com" as Login;

/** A bound on stored logins that no fixture reaches. */
export const ROOM = { perVisitor: 100, all: 100 };

/** Gives a new, empty database on every call, one that draws its site ids from `mintId` when a case passes one. */
export type DatabaseFactory = (mintId?: () => SiteId) => Database | Promise<Database>;

/** A version as `publishedVersion` publishes it: the number set aside for it, how many versions the site keeps at most, its size, and what it holds when that is known. */
export interface NewVersion {
  readonly number: number;
  readonly keep: number;
  readonly bytes: number;
  readonly files: number;
  readonly contents?: VersionContents;
}

/** Site ids handed out in order, so a test knows the id a site gets and can make two candidates collide. */
export function mintFrom(...ids: string[]): () => SiteId {
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

/** The names of every page of a listing outside the trash unless asked, two sites a page, each page asked with the `next` of the one before. */
export async function pagedNames(database: Database, query: Partial<SitesQuery>): Promise<string[][]> {
  const pages: string[][] = [];
  let after: SitesPage["next"];
  do {
    const page = await database.listSites({ trash: false, limit: 2, ...query, ...(after === undefined ? {} : { after }) });
    pages.push(page.sites.map((site) => site.name));
    after = page.next;
  } while (after !== undefined);

  return pages;
}

/** A publish of the fixture size under a reserved number. */
export function publish(number: number, keep: number): NewVersion {
  return { number, keep, ...SIZE };
}

/** Declared files that are `files` in number and `bytes` long together. */
function filesOf(size: Pick<NewVersion, "bytes" | "files">): ManifestFile[] {
  return Array.from(Array(size.files).keys(), (index) => ({ path: `file-${index}.html`, size: index === 0 ? size.bytes : 0, content_type: "text/html", sha256: SHA256 }));
}

/** Give up a fixture upload that still waits, and remove its record. */
async function forgotten(database: Database, id: UploadId): Promise<void> {
  await database.abandonUpload(id);
  await database.removeUpload(id);
}

/**
 * Make a site as an install does, through an upload begun for it by whoever signs and published in its folder, and leave no record of the upload behind.
 *
 * @param contents - what version 1 holds; nothing is known of it when left out
 * @throws {Error} the draft breaks a field rule, or its folder is a site's
 */
export async function publishedSite(database: Database, site: NewSite, signed: Signed = BY_ADA, contents?: VersionContents): Promise<Done | Refused<"name_taken">> {
  const upload: NewUpload = { id: mintUploadId(), folder: site.folder, number: 1, owner: signed.by, plan: { kind: "create", site: { embeddable: true, ...site } }, manifest: MANIFEST, created_at: signed.at };
  await database.addUpload(upload, FIXTURE_ROOM);

  try {
    const created = await database.publishUploadAsSite(upload.id, site, signed, contents === undefined ? {} : { contents });
    if (created.kind === "done") return created;

    if (created.kind === "name_taken") return { kind: "name_taken" };

    throw new Error("the fixture upload did not wait for its site");
  } finally {
    await forgotten(database, upload.id);
  }
}

/**
 * Publish a version of a site as an install does, through an upload of that size under the number, and leave no record of the upload behind. The page's title stays as the version before left it.
 *
 * @param id - the site; for an id of no site the upload sits in a folder of no site
 * @throws {RangeError} `keep` is not a whole number from 1 up
 */
export async function publishedVersion(database: Database, id: SiteId, version: NewVersion, signed: Signed = BY_ADA): Promise<Published | Refused<"not_found" | "in_trash" | "stale_number">> {
  const site = await database.getSite(id);
  const manifest = filesOf(version);
  const upload: NewUpload = { id: mintUploadId(), folder: site?.folder ?? mintSiteFolder(), number: version.number, owner: signed.by, plan: { kind: "update", details: {} }, manifest, created_at: signed.at };
  await database.addUpload(upload, FIXTURE_ROOM);

  try {
    const title = site?.page_title ?? null;
    const pageTitle = title === null ? {} : { page_title: title };
    const contents = version.contents === undefined ? {} : { contents: version.contents };
    const added = await database.publishUploadAsVersion(upload.id, { keep: version.keep, details: {}, ...pageTitle, ...contents }, signed);
    if (added.kind === "done") return added;

    if (added.kind === "not_found" || added.kind === "in_trash" || added.kind === "stale_number") return { kind: added.kind };

    throw new Error(`the fixture version was refused: ${added.kind}`);
  } finally {
    await forgotten(database, upload.id);
  }
}

/**
 * Make a fixture site.
 *
 * @throws {Error} the site was refused, which is a broken fixture
 */
export async function made(database: Database, site: NewSite, signed: Signed = BY_ADA): Promise<Site> {
  const created = await publishedSite(database, site, signed);
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
  return Array.from(Array(count).keys(), (index) => ({ path: `page-${index}.html`, size: index, content_type: "text/html", sha256: SHA256 }));
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
export async function storedBack(database: Database, site: Site, signed: Signed = BY_ADA, contents?: Parameters<Database["importUploadAsSite"]>[3]): ReturnType<Database["importUploadAsSite"]> {
  const upload: NewUpload = { id: mintUploadId(), folder: site.folder, number: 1, owner: ADA, plan: { kind: "import", site: {} }, manifest: MANIFEST, created_at: NOW };
  await database.addUpload(upload, ROOMY);

  try {
    return await database.importUploadAsSite(upload.id, site, signed, contents);
  } finally {
    await database.abandonUpload(upload.id);
    await database.removeUpload(upload.id);
  }
}

/** What the kept versions of one site hold together, in the trash or not; `undefined` for no site. */
export async function sizeOf(database: Database, id: SiteId): Promise<{ readonly bytes: number; readonly files: number } | undefined> {
  const site = await database.getSite(id);
  if (site === undefined) return undefined;

  return { bytes: site.versions.reduce((sum, version) => sum + version.bytes, 0), files: site.versions.reduce((sum, version) => sum + version.files, 0) };
}

/** Every site, the trash included, read a page at a time. */
export async function everySite(database: Database): Promise<Site[]> {
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
export async function auditTrail(database: Database): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  let after: number | undefined;

  for (;;) {
    const page = await database.listAudit({ limit: 100, dir: "asc", after });
    const last = page.at(-1);
    if (last === undefined) return entries;

    entries.push(...page);
    after = last.seq;
  }
}

export async function auditActions(database: Database): Promise<AuditAction[]> {
  return (await auditTrail(database)).map((entry) => entry.action);
}

/** What the audit entries of one action set, the oldest first. */
export async function auditDetails(database: Database, action: AuditAction): Promise<unknown[]> {
  return (await auditTrail(database)).filter((entry) => entry.action === action).map((entry) => entry.detail);
}

/** All a database shows of its sites, its audit log, and its totals: what a refused change leaves as it was. */
export async function everything(database: Database): Promise<unknown> {
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

export async function opened(makeDatabase: DatabaseFactory, mintId?: () => SiteId): Promise<Database> {
  return withTrueTotals(await makeDatabase(mintId));
}
