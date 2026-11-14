// Publish in one call: a new site, or a new version of one. It runs the staged publish from its first step to its last, so the two cannot differ.

import type { Actor } from "../auth/scopes";
import { abandonPublish } from "./abandon-publish";
import { beginPublish } from "./begin-publish";
import type { SiteChanges } from "./changes";
import { finishPublish } from "./finish-publish";
import type { Install, Refused } from "./records";
import { uploadFile } from "./upload-file";

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
 * Without `site` it makes a new site called `name`. With `site`, a reference to a site, it adds a version to that site and takes no `name`. The settings apply to either; one left out is the default on a new site and stays as it is on an update.
 */
type PublishRequest = SiteChanges & { readonly files: AsyncIterable<PublishFile> | Iterable<PublishFile>; readonly site?: string; readonly name?: string };

/** What each step of a publish may answer when it is not done. */
type Step = typeof beginPublish | typeof uploadFile | typeof finishPublish;

/** The codes a publish may be refused with. */
type PublishCode = Extract<Awaited<ReturnType<Step>>, { readonly ok: false }>["code"];

/** Give up an upload that will not be finished. */
async function giveUp(install: Install, actor: Actor, upload: string, cause?: unknown): Promise<void> {
  const abandoned = await abandonPublish(install, actor, upload);
  if (!abandoned.ok || abandoned.left.length === 0) return;

  throw new Error(`the publish was not made, and its files under ${abandoned.left.join(", ")} could not all be removed`, { cause });
}

/**
 * Publish files as a new site, or as the next version of a site, and make them live.
 *
 * Nothing is written before the arguments, the file list, and the limits pass. A site needs an `index.html` at its top.
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

  const manifest = listed.map(({ path, size, contentType }) => ({ path, size, content_type: contentType }));
  const begun = await beginPublish(install, actor, { ...asked, files: manifest });
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
