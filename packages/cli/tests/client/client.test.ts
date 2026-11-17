import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type AddressInfo, createServer } from "node:net";

import { answered, bytes, ORIGIN, openApi } from "../../../app/tests/api/support/install";
import { LISTED_SITES } from "../../../core/src/actions/sites/list";
import { WHOAMI_ANSWER } from "../../../core/src/actions/access/manage-tokens";
import { SITE_ANSWER } from "../../../core/src/actions/sites/site-object";
import { BEGUN_UPLOAD } from "../../../core/src/actions/publish/uploads";
import { type Client, createClient, type Fetch } from "../../src/client/client";

/** A token in the form of one, which no install knows. */
const TOKEN = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

/** A ticket for one file of six bytes at the install's own route, as the install hands one out. */
const TICKET = {
  path: "css/a b.css",
  url: "/api/uploads/0123456789abcdef/file?path=css%2Fa+b.css",
  method: "PUT",
  headers: { "Content-Type": "application/octet-stream", "Content-Length": "6" },
  expires: 1_700_086_400_000,
} as const;

/** A `fetch` that never answers until the request is given up. */
const hangs: Fetch = (_input, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));

/** The refusal the requests of a cut connection are answered with, once they are answered at all. */
const NOT_THERE = { kind: "refused", status: 404, code: "not_found", message: "there is no such thing here" } as const;

/** The line a request that is sent once more is told with. */
const SENT_AGAIN = "the connection to the install was cut before any answer: sending the request again";

/** The line a request that never left is told with when it is tried once more. */
const TRIED_AGAIN = "no connection to the install: trying once more in 1 s";

/** One request of each kind a cut may meet: a read, the begin of an upload, a change, a file, and a download. */
const ASKS = {
  read: (client: Client) => client.call(LISTED_SITES, (api) => api.sites.$get()),
  begin: (client: Client) => client.call(BEGUN_UPLOAD, (api) => api.uploads.$post({ json: { name: "notes", files: [] } }), "repeatable"),
  change: (client: Client) => client.call(SITE_ANSWER, (api) => api.sites[":site"].rollback.$post({ param: { site: "docs" }, json: {} })),
  file: (client: Client) => client.send(TICKET, new TextEncoder().encode("body{}")),
  download: (client: Client) => client.download({ site: "docs", version: 1, path: "index.html" }),
} as const;

/**
 * Open a server on this machine that cuts the connection of its first requests before any answer, and answers each one after them with a refusal in JSON under `status`.
 *
 * @param cuts - how each of the first requests is cut: the socket is ended, or reset
 * @returns its origin, how many requests reached it, and what closes it
 */
async function openCutting(cuts: readonly ("ended" | "reset")[], status: number): Promise<{ readonly origin: string; readonly requests: () => number; readonly close: () => Promise<void> }> {
  const body = JSON.stringify({ error: { code: NOT_THERE.code, message: NOT_THERE.message } });
  let requests = 0;

  const server = createServer((socket) => {
    socket.on("error", () => undefined);
    socket.once("data", () => {
      const cut = cuts[requests];
      requests += 1;

      if (cut === "reset") return socket.resetAndDestroy();

      if (cut === "ended") return socket.end();

      return socket.end(`HTTP/1.1 ${status} Answered\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests: () => requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** What a `fetch` throws, as a runtime shapes it: a `TypeError` that names a code itself, as Bun's does, or on its cause, as Node's does. */
function thrownBy(runtime: "bun" | "node", code: string): TypeError {
  if (runtime === "bun") return Object.assign(new TypeError("The socket connection was closed unexpectedly."), { code });

  return new TypeError("fetch failed", { cause: Object.assign(new Error(`read ${code}`), { code }) });
}

describe("client", () => {
  test("a call is built from the routes the app declares: the method, the path, the bearer token, and the body with its type and its length", async () => {
    const seen: { method: string; url: string; headers: Record<string, string>; body: string }[] = [];
    const record: Fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body: await request.text() });

      return answer(404, { error: { code: "not_found", message: "there is no such thing here" } });
    };
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: record });

    await client.call(SITE_ANSWER, (api) => api.sites[":site"].$get({ param: { site: "report--k3f9x2ab71qz" } }));
    await client.call(SITE_ANSWER, (api) => api.sites[":site"].$patch({ param: { site: "docs" }, json: { title: "Q3 sales" } }));
    await client.send(TICKET, new TextEncoder().encode("body{}"));
    await client.call(LISTED_SITES, (api) => api.sites.$get({ query: { trash: "true", limit: "5" } }));

    expect(seen.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${ORIGIN}/api/sites/report--k3f9x2ab71qz`,
      `PATCH ${ORIGIN}/api/sites/docs`,
      `PUT ${ORIGIN}/api/uploads/0123456789abcdef/file?path=css%2Fa+b.css`,
      `GET ${ORIGIN}/api/sites?trash=true&limit=5`,
    ]);
    expect(seen.map((request) => request.headers.authorization)).toEqual(Array(4).fill(`Bearer ${TOKEN}`));
    expect(seen.map((request) => [request.headers["content-type"], request.headers["content-length"], request.body])).toEqual([
      [undefined, undefined, ""],
      ["application/json", undefined, '{"title":"Q3 sales"}'],
      ["application/octet-stream", "6", "body{}"],
      [undefined, undefined, ""],
    ]);
  });

  test("the real API's answers are read: a done call is its value, and a refusal its code", async () => {
    const install = await openApi();
    const fetch: Fetch = (input, init) => install.api.fetch(new Request(input, init));
    const admin = createClient({ server: ORIGIN, token: install.tokens.admin, fetch });
    const nobody = createClient({ server: ORIGIN, token: TOKEN, fetch });

    expect(await admin.call(WHOAMI_ANSWER, (api) => api.whoami.$get())).toMatchObject({ ok: true, value: { token: { scope: "admin" } } });
    expect(await admin.call(LISTED_SITES, (api) => api.sites.$get())).toEqual({ ok: true, value: { sites: [] } });
    expect(await admin.call(SITE_ANSWER, (api) => api.sites[":site"].$get({ param: { site: "zzzzzzzzzzzz" } }))).toEqual({
      ok: false,
      failure: { kind: "refused", status: 404, code: "not_found", message: "there is no such thing here" },
    });
    expect(await nobody.call(WHOAMI_ANSWER, (api) => api.whoami.$get())).toMatchObject({ ok: false, failure: { kind: "refused", status: 401, code: "not_logged_in" } });
  });

  test.each<[string, Fetch, unknown]>([
    ["a fetch that throws", () => Promise.reject(new Error(`could not send Bearer ${TOKEN}`)), { kind: "unreachable", address: ORIGIN, left: true }],
    ["a fetch that throws something that is no error", () => Promise.reject(TOKEN), { kind: "unreachable", address: ORIGIN, left: true }],
    ["an answer that never comes", hangs, { kind: "timeout", seconds: 0 }],
    ["a body that breaks off", async () => new Response(new ReadableStream({ pull: (controller) => controller.error(new Error("reset")) })), { kind: "unreachable", address: ORIGIN, left: true }],
    ["JSON of another form under 200", async () => answer(200, { token: TOKEN }), { kind: "unexpected", status: 200 }],
    ["JSON that is no refusal under 500", async () => answer(500, { message: "oops" }), { kind: "unexpected", status: 500 }],
    ["a refusal under a status that is no error", async () => answer(201, { error: { code: "internal", message: "no" } }), { kind: "unexpected", status: 201 }],
  ])("%s is a failure of its own kind that never holds the token, and nothing throws", async (_name, fetch, failure) => {
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch, timeoutMs: 20 });

    const called = await client.call(WHOAMI_ANSWER, (api) => api.whoami.$get());

    expect(called).toEqual({ ok: false, failure } as never);
    expect(JSON.stringify(called)).not.toContain(TOKEN);
  });

  // Drift: a runtime writes a request onto a kept connection the far end has closed, and sends only a GET again by itself. Nothing but these rows says which requests the client sends once more, and that it does so once.
  test.each<[string, ("ended" | "reset")[], number, keyof typeof ASKS, { readonly requests: number; readonly told: number; readonly failure: unknown }]>([
    ["a read whose socket is ended", ["ended"], 404, "read", { requests: 2, told: 1, failure: NOT_THERE }],
    ["a read whose socket is reset", ["reset"], 404, "read", { requests: 2, told: 1, failure: NOT_THERE }],
    ["the begin of an upload whose socket is ended", ["ended"], 404, "begin", { requests: 2, told: 1, failure: NOT_THERE }],
    ["the begin of an upload whose socket is reset", ["reset"], 404, "begin", { requests: 2, told: 1, failure: NOT_THERE }],
    ["a download whose socket is reset", ["reset"], 404, "download", { requests: 2, told: 1, failure: NOT_THERE }],
    ["a read cut twice", ["reset", "ended"], 404, "read", { requests: 2, told: 1, failure: "unreachable" }],
    ["the begin of an upload cut twice", ["ended", "reset"], 404, "begin", { requests: 2, told: 1, failure: "unreachable" }],
    ["a change, which is no request to send twice", ["reset"], 404, "change", { requests: 1, told: 0, failure: "unreachable" }],
    ["a file, which its upload sends again by its own count", ["reset"], 404, "file", { requests: 1, told: 0, failure: "unreachable" }],
    ["a read answered 404", [], 404, "read", { requests: 1, told: 0, failure: NOT_THERE }],
    ["the begin of an upload answered 503", [], 503, "begin", { requests: 1, told: 0, failure: { ...NOT_THERE, status: 503 } }],
  ])("%s reaches the install as often as it may, and is told each time it is sent again", async (_name, cuts, status, ask, expected) => {
    const install = await openCutting(cuts, status);
    const told: string[] = [];
    const client = createClient({ server: install.origin, token: TOKEN, fetch, told: (line) => told.push(line), timeoutMs: 5000 });

    try {
      const called = await ASKS[ask](client);

      const failure = expected.failure === "unreachable" ? { kind: "unreachable", address: install.origin, left: true } : expected.failure;

      expect<unknown>({ requests: install.requests(), told, called }).toEqual({ requests: expected.requests, told: Array(expected.told).fill(SENT_AGAIN), called: { ok: false, failure } });
    } finally {
      await install.close();
    }
  });

  // Drift: what a failed request throws is each runtime's own: Bun names the code on the error, Node on its cause. The tests run in Bun alone, so these rows hold Node's shapes.
  test.each<[string, TypeError, { readonly ask: keyof typeof ASKS; readonly fails?: number }, { readonly sendings: (boolean | undefined)[]; readonly told: string[]; readonly paused?: number[]; readonly left?: boolean }]>([
    ["Bun's closed socket", thrownBy("bun", "ECONNRESET"), { ask: "begin" }, { sendings: [undefined, false], told: [SENT_AGAIN] }],
    ["Node's reset socket", thrownBy("node", "ECONNRESET"), { ask: "begin" }, { sendings: [undefined, false], told: [SENT_AGAIN] }],
    ["Node's socket the other side closed", thrownBy("node", "UND_ERR_SOCKET"), { ask: "begin" }, { sendings: [undefined, false], told: [SENT_AGAIN] }],
    ["Bun's closed socket, which a change may have left by", thrownBy("bun", "ECONNRESET"), { ask: "change" }, { sendings: [undefined], told: [], left: true }],
    ["Bun's refused connection", thrownBy("bun", "ConnectionRefused"), { ask: "change" }, { sendings: [undefined, false], told: [TRIED_AGAIN], paused: [1000] }],
    ["Node's refused connection", thrownBy("node", "ECONNREFUSED"), { ask: "change" }, { sendings: [undefined, false], told: [TRIED_AGAIN], paused: [1000] }],
    ["Bun's name no DNS knows", thrownBy("bun", "ENOTFOUND"), { ask: "change" }, { sendings: [undefined, false], told: [TRIED_AGAIN], paused: [1000] }],
    ["Node's name no DNS knows", thrownBy("node", "ENOTFOUND"), { ask: "change" }, { sendings: [undefined, false], told: [TRIED_AGAIN], paused: [1000] }],
    ["Node's name no DNS answers for now", thrownBy("node", "EAI_AGAIN"), { ask: "change" }, { sendings: [undefined, false], told: [TRIED_AGAIN], paused: [1000] }],
    ["Bun's name no DNS knows, at the begin of an upload", thrownBy("bun", "ENOTFOUND"), { ask: "begin" }, { sendings: [undefined, false], told: [TRIED_AGAIN], paused: [1000] }],
    ["Bun's name no DNS knows, twice", thrownBy("bun", "ENOTFOUND"), { ask: "change", fails: 2 }, { sendings: [undefined, false], told: [TRIED_AGAIN], paused: [1000], left: false }],
    ["Bun's name no DNS knows, at a file, which its upload sends again by its own count", thrownBy("bun", "ENOTFOUND"), { ask: "file" }, { sendings: [undefined], told: [], left: false }],
    ["Bun's TLS failure", thrownBy("bun", "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR"), { ask: "change" }, { sendings: [undefined], told: [], left: true }],
    ["Node's TLS failure", thrownBy("node", "ERR_SSL_WRONG_VERSION_NUMBER"), { ask: "begin" }, { sendings: [undefined], told: [], left: true }],
  ])("a call that meets %s is sent as often as it may, the second time on a connection that is not kept, after the pause it is told, and one that fails says whether it left", async (_name, error, { ask, fails = 1 }, expected) => {
    const kept: (boolean | undefined)[] = [];
    const told: string[] = [];
    const paused: number[] = [];
    const failing: Fetch = async (_input, init) => {
      kept.push(init.keepalive);
      if (kept.length <= fails) throw error;

      return answer(404, { error: { code: NOT_THERE.code, message: NOT_THERE.message } });
    };

    const called = await ASKS[ask](createClient({ server: ORIGIN, token: TOKEN, fetch: failing, told: (line) => told.push(line), pause: async (ms) => void paused.push(ms) }));

    expect<unknown>({ kept, told, paused, called }).toEqual({
      kept: expected.sendings,
      told: expected.told,
      paused: expected.paused ?? [],
      // A request that never left changed nothing, and its failure says so: a change is then worded as not made.
      called: { ok: false, failure: expected.left === undefined ? NOT_THERE : { kind: "unreachable", address: ORIGIN, left: expected.left } },
    });
  });

  // Drift: an install that cannot start answers every path, the API's too, with one sentence in plain text. A client that dropped it would leave the person with a status and a hint about the address, which is right.
  test.each<[string, string, string, unknown]>([
    [
      "the sentence of an install that cannot start",
      "text/plain; charset=utf-8",
      "This install's database is newer than its code: update poplin.\nmore",
      { kind: "not-json", address: ORIGIN, status: 503, said: "This install's database is newer than its code: update poplin." },
    ],
    ["a line with control characters, cut at 200", "TEXT/PLAIN", `\u001b[31m${"a".repeat(300)}\r\n`, { kind: "not-json", address: ORIGIN, status: 503, said: `[31m${"a".repeat(196)}` }],
    ["plain text that starts with an empty line", "text/plain", "\nlater", { kind: "not-json", address: ORIGIN, status: 503 }],
    ["a page", "text/html", "<html>This install cannot start.</html>", { kind: "not-json", address: ORIGIN, status: 503 }],
    ["text of another type", "text/plain+json", "other format", { kind: "not-json", address: ORIGIN, status: 503 }],
  ])("a call answered with %s keeps the first line of plain text and of nothing else", async (_name, type, body, failure) => {
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: async () => new Response(body, { status: 503, headers: { "Content-Type": type } }) });

    expect(await client.call(WHOAMI_ANSWER, (api) => api.whoami.$get())).toEqual({ ok: false, failure } as never);
  });

  test("a download hands back the real API's file as a stream with its length and its stored type, and a refusal as its code: without this a file route would be read as JSON and capped at 16 MB", async () => {
    const install = await openApi();
    const type = "text/x-notes; charset=utf-8";
    const begun = await answered(install.routes.uploads.$post({ json: { name: "notes", files: [{ path: "index.html", size: 5, content_type: type, sha256: createHash("sha256").update("hello").digest("base64") }] } }));
    const upload = (begun.body.upload as { id: string }).id;
    await install.routes.uploads[":upload"].file.$put({ param: { upload }, query: { path: "index.html" } }, bytes("hello"));
    const site = ((await answered(install.routes.uploads[":upload"].finish.$post({ param: { upload } }))).body.site as { id: string }).id;
    const client = createClient({ server: ORIGIN, token: install.tokens.admin, fetch: (input, init) => install.api.fetch(new Request(input, init)) });

    const file = await client.download({ site, version: 1, path: "index.html" });
    const absent = await client.download({ site, version: 1, path: "none.html" });

    expect(file).toMatchObject({ ok: true, value: { size: 5, contentType: type } });
    expect(file.ok && (await new Response(file.value.body).text())).toBe("hello");
    expect(absent).toMatchObject({ ok: false, failure: { kind: "refused", status: 404, code: "not_found", about: "path" } });
  });

  // Drift: a server may send a file with no `Content-Length`, as the local preview does. A client that asked for the header would refuse every file of an export.
  test("a download with no length is taken with its stored type and read to its end", async () => {
    const streamed = new Response(new Blob(["first ", "second"]).stream(), { headers: { "Poplin-Content-Type": "text%2Fplain" } });
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: async () => streamed });

    const file = await client.download({ site: "k3f9x2ab71qz", version: 1, path: "index.html" });

    expect([streamed.headers.has("Content-Length"), file.ok && [file.value.size, file.value.contentType, await new Response(file.value.body).text()]]).toEqual([false, [undefined, "text/plain", "first second"]]);
  });

  test.each<[string, Response, unknown]>([
    ["a length that is no count", new Response("hello", { headers: { "Content-Length": "-5", "Poplin-Content-Type": "text%2Fplain" } }), { kind: "unexpected", status: 200 }],
    ["no stored type", new Response("hello", { headers: { "Content-Length": "5" } }), { kind: "unexpected", status: 200 }],
    ["a stored type that is not percent-encoded text", new Response("hello", { headers: { "Content-Length": "5", "Poplin-Content-Type": "%E0%A4%A" } }), { kind: "unexpected", status: 200 }],
    ["JSON under a status that is no refusal", answer(201, { ok: true }), { kind: "unexpected", status: 201 }],
    ["a page that is no JSON", answer(502, "<html>bad gateway</html>"), { kind: "not-json", address: ORIGIN, status: 502 }],
  ])("a download answered with %s is a failure and no file: without this a proxy's page could be written into a backup as a site's file", async (_name, response, failure) => {
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: async () => response });

    expect(await client.download({ site: "k3f9x2ab71qz", version: 1, path: "index.html" })).toEqual({ ok: false, failure } as never);
  });

  // Drift: `Retry-After` is set by whatever answers, the install or the zone in front of it, and HTTP lets it be a date; only whole seconds are a wait a caller can count.
  test.each<[string, Response, unknown]>([
    ["a zone's page that names whole seconds", new Response("<html>too many</html>", { status: 429, headers: { "Retry-After": "10" } }), { kind: "not-json", address: ORIGIN, status: 429, retryAfter: 10 }],
    [
      "the install's refusal that names whole seconds",
      new Response(JSON.stringify({ error: { code: "too_many_requests", message: "no" } }), { status: 429, headers: { "Retry-After": "30" } }),
      { kind: "refused", status: 429, code: "too_many_requests", message: "no", retryAfter: 30 },
    ],
    ["a page that names a date", new Response("<html>too many</html>", { status: 429, headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" } }), { kind: "not-json", address: ORIGIN, status: 429 }],
  ])("a call answered with %s keeps the wait with the failure, or none", async (_name, response, failure) => {
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: async () => response });

    expect(await client.send(TICKET, new Uint8Array(6))).toEqual({ ok: false, failure } as never);
  });

  // Drift: a ticket may name any address. A token sent along to a place that is not the install would hand the login to whoever a ticket points at.
  test.each([
    ["a path of the install", "/api/uploads/0123456789abcdef/file?path=index.html", `Bearer ${TOKEN}`],
    ["the install's own origin, written whole", `${ORIGIN}/api/uploads/0123456789abcdef/file?path=index.html`, `Bearer ${TOKEN}`],
    ["the install's origin spelled with its port and in capitals", `${ORIGIN.replace("poplin", "POPLIN")}:443/api/uploads/0123456789abcdef/file?path=index.html`, `Bearer ${TOKEN}`],
    ["another host", "https://files.example.net/sites/abc/v1/index.html?signature=1", undefined],
    ["another host, named without its scheme", "//files.example.net/sites/abc/v1/index.html", undefined],
    ["a host that only starts as the install's does", `${ORIGIN}.example.net/api/uploads/0123456789abcdef/file`, undefined],
    ["the install's host over plain HTTP", `${ORIGIN.replace("https", "http")}/api/uploads/0123456789abcdef/file`, undefined],
    ["the install's host on another port", `${ORIGIN}:8443/api/uploads/0123456789abcdef/file`, undefined],
  ])("a file sent to %s goes by the ticket's method, with the ticket's headers and no other, and the token only to the install", async (_where, url, authorization) => {
    const seen: { method: string; url: string; headers: Record<string, string>; body: string; redirect: unknown }[] = [];
    const record: Fetch = async (input, init) => {
      seen.push({ method: String(init.method), url: new URL(input).href, headers: Object.fromEntries(new Headers(init.headers)), body: await new Response(init.body).text(), redirect: init.redirect });

      return new Response(null, { status: 200 });
    };
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: record });
    const headers = { "Content-Length": "6", "Content-Type": "text/css", "X-Signed": "abc" };

    const sent = await client.send({ ...TICKET, url, headers }, new Blob(["body{}"]).stream());

    expect<unknown>([sent, seen]).toEqual([
      { ok: true, value: undefined },
      [{ method: "PUT", url: new URL(url, ORIGIN).href, headers: { "content-length": "6", "content-type": "text/css", "x-signed": "abc", ...(authorization === undefined ? {} : { authorization }) }, body: "body{}", redirect: "manual" }],
    ]);
  });
});
