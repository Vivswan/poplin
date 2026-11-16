// A staged publish as the database holds it between its first request and its last, and the one place a row of the uploads table becomes that value. Its manifest is read where it is stored.

import * as v from "valibot";

import { isContentType, isSha256 } from "../storage/storage";
import { COUNT, HOLDER, MOMENT, POSITIVE, SITE_ID } from "./fields";
import { randomText } from "./random-text";
import { NEW_SITE, SITE_ACCESS, SITE_DETAILS, SITE_FOLDER, TITLE } from "./site";

/** The form of an upload id. */
const UPLOAD_ID_PATTERN = /^[0-9a-z]{16}$/;

/** The longest content type a file is stored with, in characters. */
const MAX_CONTENT_TYPE_LENGTH = 255;

/** How many fields a declared file holds. */
const MANIFEST_FILE_FIELDS = 4;

/** The id of a staged publish. */
export const UPLOAD_ID = v.custom<UploadId>(isUploadId, "an upload id is 16 lowercase base36 characters");

/** One file of a publish as it is declared before its bytes are sent: a `path`, a `size` that is a count, and a `content_type` a header can carry and a store can keep as written, the `sha256` of its bytes in base64, and nothing besides. */
export const MANIFEST_FILE = v.custom<ManifestFile>(isManifestFile, "a declared file holds a path, a size, a content type, and the SHA-256 of its bytes");

/** Whether an upload still takes files, is live, or will never be. */
export const UPLOAD_STATE = v.picklist(["pending", "finished", "abandoned"]);

/** What finishing an upload makes: a new site, a copy of the version `from` names, the next version of a site with the settings and the page title asked with it, or a site from a backup, kept as the row `siteFromRow` reads. */
const PLAN = v.variant("kind", [
  v.object({ kind: v.literal("create"), site: NEW_SITE }),
  v.object({ kind: v.literal("duplicate"), site: NEW_SITE, from: v.object({ id: SITE_ID, folder: SITE_FOLDER, number: POSITIVE }) }),
  v.object({ kind: v.literal("update"), access: v.optional(SITE_ACCESS), details: SITE_DETAILS, page_title: v.optional(TITLE) }),
  v.object({ kind: v.literal("import"), site: v.record(v.string(), v.unknown()) }),
]);

/** What a row of the uploads table holds besides its manifest. */
const UPLOAD_COLUMNS = {
  id: UPLOAD_ID,
  folder: SITE_FOLDER,
  number: POSITIVE,
  owner: HOLDER,
  state: UPLOAD_STATE,
  plan: v.pipe(v.string(), v.parseJson(), PLAN),
  bytes: COUNT,
  files: POSITIVE,
  dropped: v.pipe(v.string(), v.parseJson(), v.array(POSITIVE)),
  created_at: MOMENT,
};

/** A row of the uploads table without its manifest. */
const UPLOAD_ROW = v.object(UPLOAD_COLUMNS);

declare const uploadIdBrand: unique symbol;

/** Sixteen base36 characters, from `mintUploadId` or `parseUploadId`; no other code can make one. */
export type UploadId = string & { readonly [uploadIdBrand]: true };

/** One declared file. */
export interface ManifestFile {
  /** Where it sits in the site. */
  readonly path: string;

  /** Its length in bytes. */
  readonly size: number;

  /** The media type it is served with. */
  readonly content_type: string;

  /** The SHA-256 of its bytes in base64, which the store holds the bytes to. */
  readonly sha256: string;
}

/** What finishing an upload makes. */
export type UploadPlan = Readonly<v.InferOutput<typeof PLAN>>;

/**
 * A staged publish.
 *
 * Its files go under `folder` as version `number`. `pending` takes files; `finished` is live, and `dropped` names the versions the site stopped keeping with it; `abandoned` will never be live.
 *
 * An import's files go under `folder` as every version of its site, each declared as `v<number>/<path>`, and its `number` is 1.
 *
 * `bytes` is the sum of the declared sizes and `files` their count. `owner` is whoever began it.
 */
export type Upload = Readonly<v.InferOutput<typeof UPLOAD_ROW>>;

/** Decide whether a sent value is a declared file. A long list is checked one file at a time, so this reads each field once and builds nothing. */
function isManifestFile(sent: unknown): boolean {
  if (typeof sent !== "object" || sent === null) return false;

  const { path, size, content_type: type, sha256 } = sent as Readonly<Record<string, unknown>>;
  if (typeof path !== "string" || typeof type !== "string" || typeof sha256 !== "string") return false;

  if (!Number.isSafeInteger(size) || (size as number) < 0) return false;

  if (type.length > MAX_CONTENT_TYPE_LENGTH || !isContentType(type) || !isSha256(sha256)) return false;

  return Object.keys(sent).length === MANIFEST_FILE_FIELDS;
}

function isUploadId(value: unknown): boolean {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value);
}

/**
 * Make the id of a new upload.
 *
 * @returns 16 base36 characters, about 82 bits, each as likely as any other
 */
export function mintUploadId(): UploadId {
  return randomText("upload-id") as UploadId;
}

/**
 * Read an upload id from sent text.
 *
 * @returns the id, or `undefined` for anything that has not its form
 */
export function parseUploadId(raw: string): UploadId | undefined {
  return isUploadId(raw) ? (raw as UploadId) : undefined;
}

/**
 * Turn a row of the uploads table into an upload.
 *
 * @throws {Error} the row is no upload
 */
export function uploadFromRow(row: unknown): Upload {
  const parsed = v.safeParse(UPLOAD_ROW, row);
  if (!parsed.success) throw new Error(`a stored upload is not an upload: ${v.summarize(parsed.issues)}`);

  return parsed.output;
}
