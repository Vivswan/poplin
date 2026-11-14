// A staged publish as the database holds it between its first request and its last, and the one place a row of the uploads table becomes that value.

import * as v from "valibot";

import { mintSiteId } from "../sites/ids";
import { isContentType } from "../storage/storage";
import { COUNT, HOLDER, MOMENT, POSITIVE } from "./fields";
import { NEW_SITE, SITE_ACCESS, SITE_DETAILS, SITE_FOLDER, TITLE } from "./site";

/** How many characters an upload id holds. */
const UPLOAD_ID_LENGTH = 16;

/** The form of an upload id. */
const UPLOAD_ID_PATTERN = /^[0-9a-z]{16}$/;

/** The longest content type a file is stored with, in characters. */
const MAX_CONTENT_TYPE_LENGTH = 255;

/** The id of a staged publish. */
export const UPLOAD_ID = v.custom<UploadId>(isUploadId, "an upload id is 16 lowercase base36 characters");

/** The media type a file is served with: text a header can carry and a store can keep as written. */
const CONTENT_TYPE = v.pipe(v.string(), v.maxLength(MAX_CONTENT_TYPE_LENGTH), v.check(isContentType, "a content type is not empty and holds no control character and no lone surrogate"));

/** One file of a publish as it is declared before its bytes are sent. */
export const MANIFEST_FILE = v.strictObject({ path: v.string(), size: COUNT, content_type: CONTENT_TYPE });

/** What finishing an upload makes: a new site, the next version of one under the settings asked for with it and the title of its entry page, or a site from a backup, kept as the row `siteFromRow` reads. */
const PLAN = v.variant("kind", [
  v.object({ kind: v.literal("create"), site: NEW_SITE }),
  v.object({ kind: v.literal("update"), access: v.optional(SITE_ACCESS), details: SITE_DETAILS, page_title: v.optional(TITLE) }),
  v.object({ kind: v.literal("import"), site: v.record(v.string(), v.unknown()) }),
]);

/** What a row of the uploads table holds besides its manifest. */
const UPLOAD_COLUMNS = {
  id: UPLOAD_ID,
  folder: SITE_FOLDER,
  number: POSITIVE,
  owner: HOLDER,
  state: v.picklist(["pending", "finished", "abandoned"]),
  plan: v.pipe(v.string(), v.parseJson(), PLAN),
  bytes: COUNT,
  files: POSITIVE,
  dropped: v.pipe(v.string(), v.parseJson(), v.array(POSITIVE)),
  created_at: MOMENT,
};

/** A row of the uploads table without its manifest. */
const UPLOAD_ROW = v.object(UPLOAD_COLUMNS);

/** The manifest of an upload, as the JSON text its row holds. */
const MANIFEST_TEXT = v.pipe(v.string(), v.parseJson(), v.array(MANIFEST_FILE));

declare const uploadIdBrand: unique symbol;

/** Sixteen base36 characters, from `mintUploadId` or `parseUploadId`; no other code can make one. */
export type UploadId = string & { readonly [uploadIdBrand]: true };

/** One declared file: where it sits in the site, its length in bytes, and the media type it is served with. */
export type ManifestFile = Readonly<v.InferOutput<typeof MANIFEST_FILE>>;

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

function isUploadId(value: unknown): boolean {
  return typeof value === "string" && UPLOAD_ID_PATTERN.test(value);
}

/**
 * Make the id of a new upload.
 *
 * @returns 16 base36 characters, about 82 bits, each as likely as any other
 */
export function mintUploadId(): UploadId {
  // Two minted site ids give 24 evenly drawn characters; the first 16 are as evenly drawn.
  return `${mintSiteId()}${mintSiteId()}`.slice(0, UPLOAD_ID_LENGTH) as UploadId;
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

/**
 * Read the manifest a row of the uploads table holds.
 *
 * @throws {Error} the text is no manifest
 */
export function manifestFromText(text: unknown): readonly ManifestFile[] {
  const parsed = v.safeParse(MANIFEST_TEXT, text);
  if (!parsed.success) throw new Error(`a stored manifest is not a manifest: ${v.summarize(parsed.issues)}`);

  return parsed.output;
}
