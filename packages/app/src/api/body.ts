// What a request carries, read under a cap: a JSON body, a file's bytes, and the query. Nothing is held past the cap.

import { type Refused, refuse } from "@poplin/core/src/actions/records";

/** The content type a JSON body is sent with. */
const JSON_TYPE = "application/json";

/** The content type a file's bytes are sent with. */
const BYTES_TYPE = "application/octet-stream";

/** A whole number as a query or a header gives it: no sign, no leading zero, no fraction, and short enough to be exact. */
const WHOLE_PATTERN = /^(?:0|[1-9]\d{0,14})$/;

/** Reads a JSON body as text, refusing bytes that are not UTF-8. */
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** What a query key is read as. */
type QueryKind = "text" | "number" | "switch";

/** The keys a route's query may hold, each with what it is read as. No other key is taken. */
export type QueryShape = Readonly<Record<string, QueryKind>>;

function readValue(kind: QueryKind, raw: string): string | number | boolean | undefined {
  if (kind === "text") return raw;

  if (kind === "number") return WHOLE_PATTERN.test(raw) ? Number(raw) : undefined;

  if (raw === "true") return true;

  return raw === "false" ? false : undefined;
}

/** The media type of a request's body, without its parameters, in lowercase. */
function mediaType(request: Request): string {
  return (request.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** The length a request declares for its body, `undefined` when it declares none that is a whole number. */
function declaredLength(request: Request): number | undefined {
  const length = request.headers.get("Content-Length") ?? "";

  return WHOLE_PATTERN.test(length) ? Number(length) : undefined;
}

/**
 * Decide whether a request's body is of the content type its route takes.
 *
 * @param sends - what the route's request carries; a route that carries nothing takes any
 */
export function hasContentType(request: Request, sends: "nothing" | "json" | "bytes"): boolean {
  if (sends === "nothing") return true;

  return mediaType(request) === (sends === "json" ? JSON_TYPE : BYTES_TYPE);
}

/**
 * Read a request's query by a route's shape.
 *
 * @returns the values of the keys that are given, or `bad_argument` naming the first key that is unknown, given twice, or not of its kind
 */
export function readQuery(url: URL, shape: QueryShape): { readonly ok: true; readonly values: Readonly<Record<string, string | number | boolean>> } | Refused<"bad_argument"> {
  const values: Record<string, string | number | boolean> = {};

  for (const [key, raw] of url.searchParams) {
    const kind = Object.hasOwn(shape, key) ? shape[key] : undefined;
    const value = kind === undefined || Object.hasOwn(values, key) ? undefined : readValue(kind, raw);
    if (value === undefined) return refuse("bad_argument", Object.hasOwn(shape, key) ? key : "query");

    values[key] = value;
  }

  return { ok: true, values };
}

/**
 * Pass a body's bytes on up to a cap, and break the stream off at the first byte beyond it.
 *
 * @param maxBytes - the most bytes the body may hold
 * @returns the capped stream, empty for a request without a body, and whether the cap was passed so far
 */
export function capBody(request: Request, maxBytes: number): { readonly stream: ReadableStream<Uint8Array>; readonly exceeded: () => boolean } {
  let bytes = 0;
  let over = (declaredLength(request) ?? 0) > maxBytes;

  const cap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      bytes += chunk.byteLength;
      over ||= bytes > maxBytes;

      if (over) {
        controller.error(new Error("the body is over its cap"));
      } else {
        controller.enqueue(chunk);
      }
    },
  });
  const source = request.body ?? new Blob([]).stream();

  return { stream: source.pipeThrough(cap), exceeded: () => over };
}

/**
 * Read a JSON body of at most `maxBytes`, a chunk at a time, so a longer one is dropped where it passes the cap.
 *
 * @returns the parsed value, `too_large` about `body` past the cap, or `bad_argument` about `body` for bytes that are no UTF-8 JSON
 */
export async function readJson(request: Request, maxBytes: number): Promise<{ readonly ok: true; readonly value: unknown } | Refused<"too_large" | "bad_argument">> {
  const body = capBody(request, maxBytes);
  if (body.exceeded()) {
    await body.stream.cancel();

    return refuse("too_large", "body");
  }

  try {
    const text = UTF8.decode(await new Response(body.stream).arrayBuffer());

    return { ok: true, value: JSON.parse(text) };
  } catch {
    return refuse(body.exceeded() ? "too_large" : "bad_argument", "body");
  }
}
