// What the stand-in for the Cloudflare API is asked and what it answers: Cloudflare's documented envelopes, written by hand.

/** One request the code under test sent. `path` holds the query string too. */
export interface Asked {
  readonly method: string;
  readonly path: string;
  readonly key: string | null;
  readonly body: unknown;
}

/** Wrap a result in Cloudflare's success envelope. */
export function reply(result: unknown): Response {
  return Response.json({ success: true, errors: [], messages: [], result });
}

/** Cloudflare's failure envelope under an HTTP status. */
export function refusal(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status, headers });
}

/** One page of a list: the items on page one and nothing after, as a list that fits one page answers. */
export function page(asked: Asked, items: readonly unknown[]): Response {
  const number = Number(new URL(asked.path, "http://localhost").searchParams.get("page") ?? "1");

  return reply(number === 1 ? items : []);
}

/** What a request carried: its JSON, or for a form the JSON text of each field, read, and the whole text of each file. */
export async function bodyOf(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.startsWith("multipart/form-data") === true) {
    const fields = [...(await request.formData()).entries()].map(async ([name, value]) => [name, typeof value === "string" ? JSON.parse(value) : await (value as Blob).text()]);

    return Object.fromEntries(await Promise.all(fields));
  }

  const text = await request.text();

  return text === "" ? undefined : JSON.parse(text);
}
