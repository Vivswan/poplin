// A bucket's own API in memory, as strict as the real one about what a signed address allows: it works the signature out again from the secret, by the published rules, and stores a file only when every bound part of the request is the one that was signed.
// It shares no code with the signer under test, so a signer that drifts from the rules is refused here as the bucket would refuse it.

import { base64ToUint8Array, uint8ArrayToBase64, uint8ArrayToHex } from "uint8array-extras";

/** The algorithm every signed address names. */
const ALGORITHM = "AWS4-HMAC-SHA256";

/** What stands for the body in the signature of a signed address. */
const UNSIGNED = "UNSIGNED-PAYLOAD";

/** The characters `encodeURIComponent` leaves that the signature's own encoding does not. */
const LEFT_PLAIN = /[!'()*]/g;

/** Whose signature the bucket takes, and for where. */
interface Credentials {
  readonly accessKeyId: string;
  readonly secret: string;
  readonly region: string;
}

/** One request as the bucket reads it. */
interface Signed {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
}

/** One stored object. */
interface Stored {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: string | null;
}

/** A bucket in memory. `fetch` takes a request as a platform `fetch` does; `objects` is what it stored, by key. */
export interface FakeBucket {
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  readonly objects: Map<string, Stored>;
}

function encoded(text: string): string {
  return encodeURIComponent(text).replace(LEFT_PLAIN, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmac(key: Uint8Array<ArrayBuffer> | ArrayBuffer, text: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  return crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(text));
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function refused(status: number, code: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`, { status, headers: { "Content-Type": "application/xml" } });
}

/** A moment as a signed address writes it, read back into milliseconds since the epoch. */
function momentOf(stamp: string): number {
  return Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
}

/**
 * Check the signature of a signed address by the published rules of Signature Version 4.
 *
 * @param now - the moment the request starts, in milliseconds since the epoch
 * @returns `undefined` for a request that is the one that was signed and has not run out, else the code the bucket refuses it with
 */
export async function refusalOf(request: Signed, credentials: Credentials, now: number): Promise<string | undefined> {
  const url = new URL(request.url);
  const query = url.searchParams;
  const stamp = query.get("X-Amz-Date") ?? "";
  const scope = `${stamp.slice(0, 8)}/${credentials.region}/s3/aws4_request`;
  if (query.get("X-Amz-Algorithm") !== ALGORITHM || query.get("X-Amz-Credential") !== `${credentials.accessKeyId}/${scope}`) return "InvalidAccessKeyId";

  const names = (query.get("X-Amz-SignedHeaders") ?? "").split(";");
  const headers = names.map((name) => `${name}:${(name === "host" ? url.host : (request.headers.get(name) ?? "")).trim()}\n`).join("");
  const path = url.pathname.split("/").map((segment) => encoded(decodeURIComponent(segment))).join("/");
  const pairs = [...query].filter(([name]) => name !== "X-Amz-Signature").map(([name, value]) => `${encoded(name)}=${encoded(value)}`);
  const canonical = [request.method, path, pairs.sort().join("&"), headers, names.join(";"), UNSIGNED].join("\n");
  const toSign = [ALGORITHM, stamp, scope, uint8ArrayToHex(await sha256(new TextEncoder().encode(canonical)))].join("\n");

  let key: ArrayBuffer | Uint8Array<ArrayBuffer> = new TextEncoder().encode(`AWS4${credentials.secret}`);
  for (const part of [stamp.slice(0, 8), credentials.region, "s3", "aws4_request"]) key = await hmac(key, part);

  if (uint8ArrayToHex(new Uint8Array(await hmac(key, toSign))) !== query.get("X-Amz-Signature")) return "SignatureDoesNotMatch";

  // A signature is read first, so a changed lifetime is a changed request, never a longer ticket.
  return now >= momentOf(stamp) + Number(query.get("X-Amz-Expires")) * 1000 ? "AccessDenied" : undefined;
}

async function bytesOf(body: RequestInit["body"]): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * Build a bucket that takes signed addresses for one key.
 *
 * It refuses with 403 a request whose signature is not the one its parts make, or that has run out, and with 400 one that also carries a login, or whose body is not as long as it says.
 * It refuses with 412 one whose bytes are not of the hash it names, and one that asks to write only a key that holds nothing while the key holds an object. Only a request it takes is stored.
 *
 * @param bucket - the bucket's name, which every address has as its first segment
 * @param now - the clock, in milliseconds since the epoch
 */
export function fakeBucket(credentials: Credentials, bucket: string, now: () => number): FakeBucket {
  const objects = new Map<string, Stored>();

  const fetch: FakeBucket["fetch"] = async (input, init) => {
    const headers = new Headers(init.headers);
    const refusal = await refusalOf({ method: init.method ?? "GET", url: input, headers }, credentials, now());
    if (refusal !== undefined) return refused(403, refusal);

    // The bucket takes one proof of who asks: a signed address that also carries a login is no request it knows.
    if (headers.has("Authorization")) return refused(400, "InvalidArgument");

    const bytes = await bytesOf(init.body);
    if (headers.has("Content-Length") && Number(headers.get("Content-Length")) !== bytes.length) return refused(400, "IncompleteBody");

    const key = decodeURIComponent(new URL(input).pathname).slice(`/${bucket}/`.length);
    if (headers.get("If-None-Match") === "*" && objects.has(key)) return refused(412, "PreconditionFailed");

    const named = headers.get("x-amz-checksum-sha256");
    if (named !== null && uint8ArrayToBase64(await sha256(bytes)) !== uint8ArrayToBase64(base64ToUint8Array(named))) return refused(412, "PreconditionFailed");

    objects.set(key, { bytes, type: headers.get("Content-Type") });

    return new Response(null, { status: 200 });
  };

  return { fetch, objects };
}
