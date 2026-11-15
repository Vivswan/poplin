// Seeds too large to make through the product one request at a time: each is one statement, so a row's worst case costs the test no time.
//
// A made-up site `n` has the id `000000000001`, the folder `0000000000000001`, and the name `site-1`; a made-up token `n` has the id `0000000000000001`.

import { beginLogin } from "@poplin/core/src/actions/computer-logins";
import { parseLoginSecret } from "@poplin/core/src/auth/computer-logins";
import { BINDINGS, done, OWNER } from "./install";
import { apiOf, sql, type Stage, unmeasured } from "./budget-stage";

/** Counts from 1 to the first value bound, as a table of one column `n`. */
const COUNTED = "WITH RECURSIVE counted(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counted WHERE n < ?1)";

/** The id of a made-up site, from its number. */
const SITE_ID = "printf('%012d', n)";

/** The folder of a made-up site, from its number. */
const FOLDER = "printf('%016d', n)";

/** The id of a made-up token, from its number. */
const TOKEN_ID = "printf('%016x', n)";

/** The hash a made-up token is stored with: it is the hash of no token. */
const NO_HASH = "0".repeat(64);

/** How many files are written to the bucket at once. */
const PUTS_AT_ONCE = 250;

/** The one byte every made-up file holds. */
const BYTE = "x";

/** The id of the made-up site of a number. */
export function siteId(n: number): string {
  return String(n).padStart(12, "0");
}

/** The folder of the made-up site of a number. */
export function siteFolder(n: number): string {
  return String(n).padStart(16, "0");
}

/** The id of the made-up token of a number. */
export function tokenId(n: number): string {
  return n.toString(16).padStart(16, "0");
}

/**
 * Make sites, the highest number changed last, each with as many kept versions as asked for and every version published by a token of its own.
 *
 * @param made - `trashed` puts every one in the trash; `versions` is how many each keeps, one when left out
 */
export async function manySites(stage: Stage, count: number, made: { readonly trashed?: boolean; readonly versions?: number } = {}): Promise<void> {
  const { now } = stage.w.clock;
  const versions = made.versions ?? 1;
  await sql(
    `${COUNTED} INSERT INTO sites (id, name, folder, access, title, search_engines, live_version, next_version, owner, created_at, updated_at, trashed_at)
     SELECT ${SITE_ID}, 'site-' || n, ${FOLDER}, 'private', 'Site ' || n, 0, 1, ?2 + 1, ${TOKEN_ID}, ?3 + n, ?3 + n, ?4 FROM counted`,
    count,
    versions,
    now - count,
    made.trashed === true ? now : null,
  );
  await sql("UPDATE versions SET bytes = 1000, files = 10");
  if (versions === 1) return;

  await sql(
    `${COUNTED}, numbered(v) AS (SELECT 2 UNION ALL SELECT v + 1 FROM numbered WHERE v < ?2)
     INSERT INTO versions (folder, number, published_at, published_by, bytes, files) SELECT ${FOLDER}, v, ?3, printf('%016x', n * 16 + v), 1000, 10 FROM counted, numbered`,
    count,
    versions,
    now,
  );
}

/** Give every made-up site a new id it never had: the id it was made with becomes one it gave up, which only the log still names. */
export async function newLinks(count: number): Promise<void> {
  await sql(`${COUNTED} INSERT INTO earlier_ids (id, folder) SELECT ${SITE_ID}, ${FOLDER} FROM counted`, count);
  await sql(`UPDATE sites SET id = 'a' || substr(id, 2)`);
}

/** Make publisher tokens that work, each with a note. */
export async function manyTokens(stage: Stage, count: number): Promise<void> {
  await sql(`${COUNTED} INSERT INTO tokens (id, hash, scope, note, created_at) SELECT ${TOKEN_ID}, ?2, 'publisher', 'token ' || n, ?3 + n FROM counted`, count, NO_HASH, stage.w.clock.now - count);
}

/** Make publisher tokens that were removed, each by the owner. */
export async function endedTokens(stage: Stage, count: number): Promise<void> {
  const { now } = stage.w.clock;
  await sql(
    `${COUNTED} INSERT INTO tokens (id, hash, scope, note, created_at, removed_at, removed_by) SELECT printf('%016x', n + 1048576), ?2, 'publisher', 'ended ' || n, ?3, ?3 + n, ?4 FROM counted`,
    count,
    NO_HASH,
    now - count,
    OWNER,
  );
}

/**
 * Add entries to the audit log, each a publish of a made-up site of its own by a made-up token of its own. Whether the sites and the tokens are there is the row's to seed.
 *
 * @param about - how many sites the entries are about in turn; every entry its own when left out
 */
export async function manyEntries(stage: Stage, count: number, about = count): Promise<void> {
  await sql(
    `${COUNTED} INSERT INTO audit (at, actor, action, site_id, site_name, detail)
     SELECT ?2 + n, ${TOKEN_ID}, 'publish', printf('%012d', 1 + n % CAST(?3 AS INTEGER)), 'site-' || (1 + n % CAST(?3 AS INTEGER)), '{"version":1}' FROM counted`,
    count,
    stage.w.clock.now - count,
    about,
  );
}

/** The path of the made-up file of a number: the entry page first. */
export function filePath(n: number): string {
  return n === 0 ? "index.html" : `page-${n}.html`;
}

/** Write made-up files of one byte each under a prefix of the bucket, as the product stores a version's files. */
export async function manyFiles(prefix: string, count: number): Promise<void> {
  for (let from = 0; from < count; from += PUTS_AT_ONCE) {
    const some = Array.from({ length: Math.min(PUTS_AT_ONCE, count - from) }, (_file, at) => BINDINGS.SITES.put(`${prefix}${filePath(from + at)}`, BYTE, { httpMetadata: { contentType: "text/html" } }));
    await Promise.all(some);
  }
}

/**
 * Make the made-up site 1 with one version that holds so many files, each stored in the bucket.
 *
 * @param made - `trashed` puts the site in the trash
 */
export async function siteWithFiles(stage: Stage, files: number, made: { readonly trashed?: boolean } = {}): Promise<void> {
  await manySites(stage, 1, made);
  await sql("UPDATE versions SET files = ?1, bytes = ?1", files);
  await manyFiles(`${siteFolder(1)}/v1/`, files);
}

/**
 * Begin a publish through the API, and store some of its files in the bucket.
 *
 * @param asked - `declared` is how many files the publish declares, `stored` how many of them the bucket holds, from the first on; `site` names the site it is the next version of, a new site when left out
 * @returns the upload's id
 */
export async function uploadOf(stage: Stage, token: string, asked: { readonly declared: number; readonly stored: number; readonly site?: string }): Promise<string> {
  const files = Array.from({ length: asked.declared }, (_file, at) => ({ path: filePath(at), size: BYTE.length, content_type: "text/html" }));
  const named = asked.site === undefined ? { name: "large" } : { site: asked.site };
  const begun = await done<{ upload: { id: string } }>(await apiOf(unmeasured(stage), token).uploads.$post({ query: {}, json: { ...named, files } }));
  const placed = await BINDINGS.DB.prepare("SELECT folder, number FROM uploads WHERE id = ?1").bind(begun.upload.id).first<{ folder: string; number: number }>();
  if (placed === null) throw new Error("the row's upload is not there");

  await manyFiles(`${placed.folder}/v${placed.number}/`, asked.stored);

  return begun.upload.id;
}

/**
 * Make logins of computers that wait to be allowed, three a visitor, through the rule book: the API counts the logins begun in a minute, which a seed must not use up.
 *
 * @param scope - what each computer asks to be; a publisher when left out
 * @returns the id of each and the code its terminal shows, the oldest first
 */
export async function waitingLogins(stage: Stage, count: number, scope: "publisher" | "admin" = "publisher"): Promise<readonly { readonly id: string; readonly code: string }[]> {
  const logins: { readonly id: string; readonly code: string }[] = [];
  for (let at = 0; at < count; at += 1) {
    const begun = await beginLogin(stage.install, { scope, computer: `laptop ${at}` }, `visitor-${Math.floor(at / 3)}`);
    if (!begun.ok) throw new Error(`the row's login was refused: ${begun.code}`);

    logins.push({ id: parseLoginSecret(begun.secret) ?? "", code: begun.code });
  }

  return logins;
}

