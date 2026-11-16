// The tickets that send a file straight to the bucket, against a bucket that works the signature out again from the secret and refuses whatever was not signed.
// Without these a ticket could let its holder send other bytes, another length, or another type, write another key, or live longer than it says; or the install's login could travel to the bucket with a file.

import { describe, expect, test } from "bun:test";
import type { ManifestFile, UploadId } from "@poplin/core/src/records/upload";
import { type ObjectKey, sha256Of } from "@poplin/core/src/storage/storage";
import type { Ticket } from "@poplin/core/src/storage/tickets";
import { objectKey } from "@poplin/core/tests/storage/support/storage-contract";
import { uint8ArrayToBase64 } from "uint8array-extras";
import { createClient } from "../../../../../cli/src/client/client";
import type { UploadKey } from "../../../src/shared/install/key/upload-key";
import { createBucketTickets } from "../../../src/shared/storage/r2-tickets";
import { EXAMPLE_ACCOUNT } from "../worker/support/example-bindings";
import { fakeBucket, refusalOf } from "./support/fake-bucket";

/** The moment every ticket here is signed at. */
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

/** An upload key in the form the Worker keeps, and nothing like a real one. */
const KEY: UploadKey = { id: "0123456789abcdef0123456789abcdef", secret: "5".repeat(64), bucket: "poplin-sites", minted_at: NOW - 600_000 };

/** Where the bucket's API answers for that key. */
const HOST = `https://${EXAMPLE_ACCOUNT}.r2.cloudflarestorage.com`;

/** An upload that ends a day after the tickets are signed. */
const UPLOAD = { id: "upload-of-the-test" as UploadId, expires: NOW + 86_400_000 };

/** The bytes of the one page most tests send. */
const PAGE = new TextEncoder().encode("<p>a page</p>");

/** The install the CLI's client is logged in to, and its token. */
const INSTALL = { server: "https://poplin.example.com", token: "token-of-the-test-0123456789" };

/** One file as an upload declares it, and the key its bytes are stored at. */
async function declared(path: string, bytes: Uint8Array<ArrayBuffer>, type = "text/html"): Promise<{ readonly file: ManifestFile; readonly key: ObjectKey }> {
  return { file: { path, size: bytes.length, content_type: type, sha256: await sha256Of(bytes) }, key: objectKey(`sitefolder/v3/${path}`) };
}

/** A bucket that takes the key, the signer over it, and the ticket of one page. */
async function staged(now: () => number = () => NOW): Promise<{ readonly bucket: ReturnType<typeof fakeBucket>; readonly ticket: Ticket }> {
  const bucket = fakeBucket({ accessKeyId: KEY.id, secret: KEY.secret, region: "auto" }, KEY.bucket, now);
  const [ticket] = await createBucketTickets({ key: KEY, accountId: EXAMPLE_ACCOUNT, now: () => NOW }).issue(UPLOAD, [await declared("index.html", PAGE)]);
  if (ticket === undefined) throw new Error("the signer answered no ticket");

  return { bucket, ticket };
}

/** Send what a ticket names, with any part of the request changed. */
function send(bucket: ReturnType<typeof fakeBucket>, ticket: Ticket, changed: { readonly url?: string; readonly method?: string; readonly headers?: Record<string, string>; readonly body?: Uint8Array<ArrayBuffer> } = {}): Promise<Response> {
  return bucket.fetch(changed.url ?? ticket.url, { method: changed.method ?? ticket.method, headers: changed.headers ?? ticket.headers, body: changed.body ?? PAGE });
}

describe("the bucket the tickets are tried against", () => {
  // Drift: the bucket here is hand-made. Unless it takes the address Amazon publishes as its own example of a signed address, a signer and a bucket that share a mistake would agree with each other and with nothing else.
  test("takes the signed address of Amazon's published example, and refuses it with one character of the path changed", async () => {
    const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
    const query = [
      "X-Amz-Algorithm=AWS4-HMAC-SHA256",
      "X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request",
      "X-Amz-Date=20130524T000000Z",
      "X-Amz-Expires=86400",
      "X-Amz-SignedHeaders=host",
      "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    ].join("&");
    const at = Date.UTC(2013, 4, 24, 12);
    const asked = (path: string, now = at): Promise<string | undefined> => refusalOf({ method: "GET", url: `https://examplebucket.s3.amazonaws.com/${path}?${query}`, headers: new Headers() }, credentials, now);

    expect([await asked("test.txt"), await asked("text.txt"), await asked("test.txt", at + 86_400_000)]).toEqual([undefined, "SignatureDoesNotMatch", "AccessDenied"]);
  });
});

describe("createBucketTickets", () => {
  test("a ticket sent as it says stores the file at its key with its type, and names the bucket's own address", async () => {
    const { bucket, ticket } = await staged();
    const answered = await send(bucket, ticket);

    expect([answered.status, [...bucket.objects.keys()], bucket.objects.get("sitefolder/v3/index.html")?.type]).toEqual([200, ["sitefolder/v3/index.html"], "text/html"]);
    expect([ticket.path, ticket.method, ticket.url.startsWith(`${HOST}/poplin-sites/sitefolder/v3/index.html?`), ticket.expires]).toEqual(["index.html", "PUT", true, NOW + 600_000]);
    expect(Object.keys(ticket.headers)).toEqual(["Content-Length", "Content-Type", "x-amz-checksum-sha256", "If-None-Match"]);
  });

  const other = new TextEncoder().encode("<p>b page</p>");
  const changes: readonly { readonly name: string; readonly status: number; readonly change: (ticket: Ticket) => Parameters<typeof send>[2] }[] = [
    { name: "other bytes of the same length", status: 412, change: () => ({ body: other }) },
    { name: "a longer file, with the length it has", status: 403, change: (ticket) => ({ body: new Uint8Array(PAGE.length + 1), headers: { ...ticket.headers, "Content-Length": String(PAGE.length + 1) } }) },
    { name: "a longer file, under the length that was signed", status: 400, change: () => ({ body: new Uint8Array(PAGE.length + 1) }) },
    { name: "another type", status: 403, change: (ticket) => ({ headers: { ...ticket.headers, "Content-Type": "text/javascript" } }) },
    { name: "the hash of other bytes, with those bytes", status: 403, change: (ticket) => ({ body: other, headers: { ...ticket.headers, "x-amz-checksum-sha256": uint8ArrayToBase64(new Uint8Array(32)) } }) },
    { name: "no hash at all", status: 403, change: (ticket) => ({ headers: { "Content-Length": ticket.headers["Content-Length"] ?? "", "Content-Type": "text/html", "If-None-Match": "*" } }) },
    { name: "no condition that the key holds nothing", status: 403, change: (ticket) => ({ headers: Object.fromEntries(Object.entries(ticket.headers).filter(([name]) => name !== "If-None-Match")) }) },
    { name: "another key", status: 403, change: (ticket) => ({ url: ticket.url.replace("/index.html?", "/other.html?") }) },
    { name: "another version's folder", status: 403, change: (ticket) => ({ url: ticket.url.replace("/v3/", "/v2/") }) },
    { name: "a read", status: 403, change: () => ({ method: "GET" }) },
    { name: "a removal", status: 403, change: () => ({ method: "DELETE" }) },
    { name: "a longer life written into the address", status: 403, change: (ticket) => ({ url: ticket.url.replace("X-Amz-Expires=600", "X-Amz-Expires=6000") }) },
    { name: "the install's login beside it", status: 400, change: (ticket) => ({ headers: { ...ticket.headers, Authorization: `Bearer ${INSTALL.token}` } }) },
  ];

  // Drift: each row is something the holder of a ticket could try. One that the bucket took would put bytes into a site that its publish never declared.
  test.each(changes)("a ticket sent with $name is refused, and nothing is stored", async ({ status, change }) => {
    const { bucket, ticket } = await staged();
    const answered = await send(bucket, ticket, change(ticket));

    expect([answered.status, bucket.objects.size]).toEqual([status, 0]);
  });

  test("a ticket is taken until it runs out and refused from that moment on, and no ticket outlives its upload", async () => {
    let now = NOW + 599_999;
    const { bucket, ticket } = await staged(() => now);
    const inTime = await send(bucket, ticket);
    now = NOW + 600_000;
    const late = await send(bucket, ticket);
    const ending = { ...UPLOAD, expires: NOW + 90_500 };
    const [short] = await createBucketTickets({ key: KEY, accountId: EXAMPLE_ACCOUNT, now: () => NOW }).issue(ending, [await declared("index.html", PAGE)]);
    // A signature is dated in whole seconds: a ticket signed half a second on ends when the bucket says, not half a second after.
    const [midSecond] = await createBucketTickets({ key: KEY, accountId: EXAMPLE_ACCOUNT, now: () => NOW + 500 }).issue(UPLOAD, [await declared("index.html", PAGE)]);

    expect([inTime.status, late.status]).toEqual([200, 403]);
    expect([short?.expires, new URL(short?.url ?? HOST).searchParams.get("X-Amz-Expires"), midSecond?.expires]).toEqual([NOW + 90_000, "90", NOW + 600_000]);
  });

  const paths = ["a b.html", "100%41.txt", "a+b.txt", "what?.txt", "part#1.txt", "it's (1)*!.txt", "\u00e9/\u65e5\u672c.txt", "~tilde/under_score-dash.txt"];

  // Drift: an address is written from a key twice, by the signer and by the bucket. A character the two write apart is a file that is refused, or stored under another name than the site serves.
  test.each(paths)("a file named %s is stored under exactly that name", async (path) => {
    const bucket = fakeBucket({ accessKeyId: KEY.id, secret: KEY.secret, region: "auto" }, KEY.bucket, () => NOW);
    const [ticket] = await createBucketTickets({ key: KEY, accountId: EXAMPLE_ACCOUNT, now: () => NOW }).issue(UPLOAD, [await declared(path, PAGE, "text/plain")]);
    const answered = ticket === undefined ? undefined : await send(bucket, ticket);

    expect([answered?.status, [...bucket.objects.keys()]]).toEqual([200, [`sitefolder/v3/${path}`]]);
  });

  test("a hundred tickets come in the order of their files, each for its own file, and none holds the key's secret", async () => {
    const files = await Promise.all(Array.from({ length: 100 }, (_unused, index) => declared(`pages/${index}.html`, new TextEncoder().encode(`<p>${index}</p>`))));
    const tickets = await createBucketTickets({ key: KEY, accountId: EXAMPLE_ACCOUNT, now: () => NOW }).issue(UPLOAD, files);

    expect(tickets.map((ticket) => [ticket.path, new URL(ticket.url).pathname])).toEqual(files.map(({ file, key }) => [file.path, `/poplin-sites/${key}`]));
    expect([new Set(tickets.map((ticket) => new URL(ticket.url).searchParams.get("X-Amz-Signature"))).size, JSON.stringify(tickets).includes(KEY.secret)]).toEqual([100, false]);
  });

  test("a bucket made in a jurisdiction is signed for at that jurisdiction's own address", async () => {
    const [ticket] = await createBucketTickets({ key: { ...KEY, jurisdiction: "eu" }, accountId: EXAMPLE_ACCOUNT, now: () => NOW }).issue(UPLOAD, [await declared("index.html", PAGE)]);

    expect(new URL(ticket?.url ?? HOST).origin).toBe(`https://${EXAMPLE_ACCOUNT}.eu.r2.cloudflarestorage.com`);
  });

  // Drift: a ticket writes once, so a file whose first answer was lost is refused when it is sent again. A client that read that refusal as a failure would give up a publish whose every file arrived.
  test("a ticket sent a second time is refused with 412 and the file the bucket holds stays, and the CLI's client takes that as the file sent", async () => {
    const { bucket, ticket } = await staged();
    const client = createClient({ ...INSTALL, fetch: bucket.fetch });
    const first = await send(bucket, ticket);
    const second = await send(bucket, ticket);

    expect([first.status, second.status, await client.send(ticket, PAGE), [...bucket.objects.keys()]]).toEqual([200, 412, { ok: true, value: undefined }, ["sitefolder/v3/index.html"]]);
  });

  // Drift: the token is the install's alone. The bucket here refuses a request that carries a login, so a client that sent it along would fail every file.
  test("the CLI's client sends a file by its ticket with the ticket's headers and no login, and the bucket takes it", async () => {
    const { bucket, ticket } = await staged();
    const seen: (string | null)[] = [];
    const client = createClient({
      ...INSTALL,
      fetch: (input, init) => {
        seen.push(new Headers(init.headers).get("Authorization"));

        return bucket.fetch(input, init);
      },
    });

    expect([await client.send(ticket, PAGE), seen, [...bucket.objects.keys()]]).toEqual([{ ok: true, value: undefined }, [null], ["sitefolder/v3/index.html"]]);
  });
});
