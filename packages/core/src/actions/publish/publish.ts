// Publish in one call: a new site, or a new version of one. It runs the staged publish from its first step to its last, so the two cannot differ.

import type { Actor } from "../../auth/scopes";
import { abandonPublish } from "./abandon-publish";
import { type beginPublish, planUpload, recordUpload } from "./begin-publish";
import type { SiteChanges } from "../sites/changes";
import { finishPublish } from "./finish-publish";
import type { Install, Refused } from "../records";
import { sha256Of } from "../../storage/storage";
import { uploadFile } from "./upload-file";

/** The hash a file is planned under before its bytes are read: the SHA-256 of no bytes, in the form every hash has. No upload is recorded with it. */
const UNREAD_HASH = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

/** One file of a publish. `open` starts a new read from the first byte, and the stream holds exactly `size` bytes. */
interface PublishFile {
  /** Where the file sits in the site: segments joined by `/`, with none before the first. */
  readonly path: string;

  /** The length in bytes. */
  readonly size: number;

  /** The media type the file is served with. */
  readonly contentType: string;

  open(): ReadableStream<Uint8Array>;
}

/**
 * What a publish asks for.
 *
 * Without `site` it makes a new site called `name`. With `site`, a reference to a site, it adds a version to that site, and a `name` renames it. The settings apply to either; one left out is the default on a new site and stays as it is on an update.
 * `page_title` is the entry page's own title, which a site shows while no `title` is typed for it.
 */
type PublishRequest = SiteChanges & { readonly files: AsyncIterable<PublishFile> | Iterable<PublishFile>; readonly site?: string; readonly name?: string; readonly page_title?: string };

/** What each step of a publish may answer when it is not done. */
type Step = typeof beginPublish | typeof uploadFile | typeof finishPublish;

/** The codes a publish may be refused with. */
type PublishCode = Extract<Awaited<ReturnType<Step>>, { readonly ok: false }>["code"];

/** Give up an upload that will not be finished. */
async function giveUp(install: Install, actor: Actor, upload: string, cause?: unknown): Promise<void> {
  const abandoned = await abandonPublish(install, actor, upload);
  if (!abandoned.ok || abandoned.left.length === 0) return;

  throw new Error("the publish was not made, and its files could not all be removed", { cause });
}

/**
 * Publish files as a new site, or as the next version of a site, and make them live.
 *
 * No file is opened and nothing is written before the arguments, the file list, and the limits pass. A site needs an `index.html` at its top.
 *
 * @returns the site with `created`, the site as it was before (`null` for a new site), or a refusal that left no file and no change behind
 * @throws {Error} the store or the database failed; the message says when files were left behind
 */
export async function publishSite(install: Install, actor: Actor, request: PublishRequest): Promise<Extract<Awaited<ReturnType<typeof finishPublish>>, { readonly ok: true }> | Refused<PublishCode>> {
  const { files, ...asked } = request;
  const listed: PublishFile[] = [];

  // Each file's facts are kept as they are now, so a caller's later change to one cannot pass unchecked.
  for await (const file of files) {
    const { path, size, contentType } = file;
    listed.push({ path, size, contentType, open: () => file.open() });
  }

  // Everything that needs no file's bytes is checked first, under a stand-in hash: a publish that is refused opens no file.
  const declared = listed.map(({ path, size, contentType }) => ({ path, size, content_type: contentType, sha256: UNREAD_HASH }));
  const planned = await planUpload(install, actor, { ...asked, files: declared });
  if (!planned.ok) return planned;

  // Each file is then read to be hashed, one whole file in memory at a time, and the upload is recorded only once every file was.
  const hashes: string[] = [];
  for (const file of listed) hashes.push(await sha256Of(new Uint8Array(await new Response(file.open()).arrayBuffer())));

  const begun = await recordUpload(install, actor, planned, hashes);
  if (!begun.ok) return begun;

  const upload = begun.upload.id;

  for (const file of listed) {
    let stored: Awaited<ReturnType<typeof uploadFile>>;

    try {
      stored = await uploadFile(install, actor, { upload, path: file.path, body: file.open() });
    } catch (error) {
      await giveUp(install, actor, upload, error);

      throw error;
    }

    if (!stored.ok) {
      await giveUp(install, actor, upload);

      return stored;
    }
  }

  return finishPublish(install, actor, upload);
}
