// The tickets that send a file of an upload straight to the bucket: one signed address a file, made with the upload key, which the bucket itself checks. No byte of the file passes through the Worker.
//
//   bound by the signature     the method PUT, the object's key, the moment the ticket runs out, and every header of `BOUND_HEADERS`
//   left to the bucket         a request that differs in any of them is refused there, and so is a body of another hash than its header names, and a second file for a key that holds one
//
// The address is signed, not the body: the bucket takes a signed address only with its payload unsigned, so the file's own hash travels as a signed header.
// A ticket is good until it runs out, which the bucket reads as a request starts. It writes once: sent again, the bucket keeps the file it holds and stores nothing.
// Nothing here calls the bucket, and nothing logs.

import type { ManifestFile } from "@poplin/core/src/records/upload";
import type { Ticket, Tickets } from "@poplin/core/src/storage/tickets";
import { AwsV4Signer } from "aws4fetch";
import type { UploadKey } from "../key/upload-key";

/** How long a ticket lives, in seconds, unless its upload ends sooner. The bucket takes no life under one second. */
const TICKET_LIFE_SECONDS = 600;

/** How many milliseconds a second holds. */
const MS_PER_SECOND = 1000;

/** The region every bucket of R2 is signed for. */
const REGION = "auto";

/** The service the bucket's API is signed as. */
const SERVICE = "s3";

/** Every header a ticket binds, with the value a file gives it: the declared length, type, and SHA-256, and the condition that the key holds no object yet. The bucket refuses a request that sends another value or leaves one out. */
const BOUND_HEADERS: readonly { readonly name: string; readonly of: (file: ManifestFile) => string }[] = [
  { name: "Content-Length", of: (file) => String(file.size) },
  { name: "Content-Type", of: (file) => file.content_type },
  { name: "x-amz-checksum-sha256", of: (file) => file.sha256 },
  { name: "If-None-Match", of: () => "*" },
];

/** What the signer is made of. */
interface SignerParts {
  /** The upload key the tickets are signed with. */
  readonly key: UploadKey;

  /** The account the bucket is in, which its address starts with. */
  readonly accountId: string;

  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;

  /** Where the bucket's API is, with no slash at its end; absent outside tests. */
  readonly endpoint?: string | undefined;
}

/** A moment as a signature writes it: `20260102T030405Z`. */
function stamp(at: number): string {
  return new Date(at).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/** Where the bucket's API answers for the key's bucket: the account's own host, or the one of the jurisdiction the bucket was made in. */
function endpointOf(parts: SignerParts): string {
  const { jurisdiction } = parts.key;

  return parts.endpoint ?? `https://${parts.accountId}${jurisdiction === undefined ? "" : `.${jurisdiction}`}.r2.cloudflarestorage.com`;
}

/**
 * Build the tickets of an install that holds an upload key.
 *
 * @returns what signs one ticket a file. A ticket lives ten minutes, or to its upload's own end where that comes sooner, counted in whole seconds and never less than one.
 *   The bucket refuses it after that, and refuses any request that is not the one it was signed for
 */
export function createBucketTickets(parts: SignerParts): Tickets {
  const { key } = parts;
  const base = `${endpointOf(parts)}/${key.bucket}`;
  const cache = new Map<string, ArrayBuffer>();

  return {
    async issue(upload, files) {
      // A signature is dated in whole seconds, so a ticket's life is counted from the start of the second it is signed in.
      const signedAt = Math.floor(parts.now() / MS_PER_SECOND) * MS_PER_SECOND;
      const seconds = Math.max(1, Math.min(TICKET_LIFE_SECONDS, Math.floor((upload.expires - signedAt) / MS_PER_SECOND)));
      const expires = signedAt + seconds * MS_PER_SECOND;
      const datetime = stamp(signedAt);

      const sign = async ({ file, key: objectKey }: (typeof files)[number]): Promise<Ticket> => {
        const headers = Object.fromEntries(BOUND_HEADERS.map(({ name, of }) => [name, of(file)]));
        const url = new URL(`${base}/${objectKey.split("/").map(encodeURIComponent).join("/")}`);
        url.searchParams.set("X-Amz-Expires", String(seconds));

        const signer = new AwsV4Signer({ method: "PUT", url: url.href, headers, accessKeyId: key.id, secretAccessKey: key.secret, service: SERVICE, region: REGION, cache, datetime, signQuery: true, allHeaders: true });
        const signed = await signer.sign();

        return { path: file.path, url: signed.url.href, method: "PUT", headers, expires };
      };

      const [first, ...rest] = files;
      if (first === undefined) return [];

      // The first ticket derives the signing key of the day into `cache`; every one after it then costs two hashes.
      return [await sign(first), ...(await Promise.all(rest.map(sign)))];
    },
  };
}
