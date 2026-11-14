import { describe, expect, test } from "bun:test";

import { ORIGIN, openApi } from "../../../app/tests/api/support/install";
import { createClient, type Fetch } from "../../src/client/client";

/** A token in the form of one, which no install knows. */
const TOKEN = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

/** A `fetch` that never answers until the request is given up. */
const hangs: Fetch = (_input, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));

describe("client", () => {
  test("a call is built from core's route table: the method, the path, the bearer token, and the body with its type and its length", async () => {
    const seen: { method: string; url: string; headers: Record<string, string>; body: string }[] = [];
    const record: Fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body: await request.text() });

      return answer(404, { error: { code: "not_found", message: "there is no such thing here" } });
    };
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: record });

    await client.call("getSite", { site: "report--k3f9x2ab71qz" });
    await client.call("updateSite", { site: "docs" }, { title: "Q3 sales" });
    await client.call("uploadFile", { upload: "0123456789abcdef", path: "css/a b.css" }, new TextEncoder().encode("body{}"), 6);
    await client.call("listSites", { trash: true, limit: 5 });

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

    expect(await admin.call("whoami", undefined)).toMatchObject({ ok: true, value: { token: { scope: "admin" } } });
    expect(await admin.call("listSites", {})).toEqual({ ok: true, value: { sites: [] } });
    expect(await admin.call("getSite", { site: "zzzzzzzzzzzz" })).toEqual({
      ok: false,
      failure: { kind: "refused", status: 404, code: "not_found", message: "there is no such thing here" },
    });
    expect(await nobody.call("whoami", undefined)).toMatchObject({ ok: false, failure: { kind: "refused", status: 401, code: "not_logged_in" } });
  });

  test.each<[string, Fetch, unknown]>([
    ["a fetch that throws", () => Promise.reject(new Error(`could not send Bearer ${TOKEN}`)), { kind: "unreachable" }],
    ["a fetch that throws something that is no error", () => Promise.reject(TOKEN), { kind: "unreachable" }],
    ["an answer that never comes", hangs, { kind: "timeout", seconds: 0 }],
    ["a body that breaks off", async () => new Response(new ReadableStream({ pull: (controller) => controller.error(new Error("reset")) })), { kind: "unreachable" }],
    ["JSON of another form under 200", async () => answer(200, { token: TOKEN }), { kind: "unexpected", status: 200 }],
    ["JSON that is no refusal under 500", async () => answer(500, { message: "oops" }), { kind: "unexpected", status: 500 }],
    ["a refusal under a status that is no error", async () => answer(201, { error: { code: "internal", message: "no" } }), { kind: "unexpected", status: 201 }],
  ])("%s is a failure of its own kind that never holds the token, and nothing throws", async (_name, fetch, failure) => {
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch, timeoutMs: 20 });

    const called = await client.call("whoami", undefined);

    expect(called).toEqual({ ok: false, failure } as never);
    expect(JSON.stringify(called)).not.toContain(TOKEN);
  });

  test("a download hands back the real API's file as a stream with its length and its stored type, and a refusal as its code: without this a file route would be read as JSON and capped at 16 MB", async () => {
    const install = await openApi();
    const type = "text/x-notes; charset=utf-8";
    const begun = await install.call("beginPublish", undefined, { body: { name: "notes", files: [{ path: "index.html", size: 5, content_type: type }] } });
    const upload = (begun.body.upload as { id: string }).id;
    await install.call("uploadFile", { upload, path: "index.html" }, { body: "hello" });
    const site = ((await install.call("finishPublish", { upload })).body.site as { id: string }).id;
    const client = createClient({ server: ORIGIN, token: install.tokens.admin, fetch: (input, init) => install.api.fetch(new Request(input, init)) });

    const file = await client.download({ site, version: 1, path: "index.html" });
    const absent = await client.download({ site, version: 1, path: "none.html" });

    expect(file).toMatchObject({ ok: true, value: { size: 5, contentType: type } });
    expect(file.ok && (await new Response(file.value.body).text())).toBe("hello");
    expect(absent).toMatchObject({ ok: false, failure: { kind: "refused", status: 404, code: "not_found", about: "path" } });
  });

  test.each<[string, Response, unknown]>([
    ["no length", new Response("hello", { headers: { "Poplin-Content-Type": "text%2Fplain" } }), { kind: "unexpected", status: 200 }],
    ["a length that is no count", new Response("hello", { headers: { "Content-Length": "-5", "Poplin-Content-Type": "text%2Fplain" } }), { kind: "unexpected", status: 200 }],
    ["no stored type", new Response("hello", { headers: { "Content-Length": "5" } }), { kind: "unexpected", status: 200 }],
    ["a stored type that is not percent-encoded text", new Response("hello", { headers: { "Content-Length": "5", "Poplin-Content-Type": "%E0%A4%A" } }), { kind: "unexpected", status: 200 }],
    ["JSON under a status that is no refusal", answer(201, { ok: true }), { kind: "unexpected", status: 201 }],
    ["a page that is no JSON", answer(502, "<html>bad gateway</html>"), { kind: "not-json", status: 502 }],
  ])("a download answered with %s is a failure and no file: without this a proxy's page could be written into a backup as a site's file", async (_name, response, failure) => {
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: async () => response });

    expect(await client.download({ site: "k3f9x2ab71qz", version: 1, path: "index.html" })).toEqual({ ok: false, failure } as never);
  });

  // Drift: `Retry-After` is set by whatever answers, the install or the zone in front of it, and HTTP lets it be a date; only whole seconds are a wait a caller can count.
  test.each<[string, Response, unknown]>([
    ["a zone's page that names whole seconds", new Response("<html>too many</html>", { status: 429, headers: { "Retry-After": "10" } }), { kind: "not-json", status: 429, retryAfter: 10 }],
    [
      "the install's refusal that names whole seconds",
      new Response(JSON.stringify({ error: { code: "too_many_requests", message: "no" } }), { status: 429, headers: { "Retry-After": "30" } }),
      { kind: "refused", status: 429, code: "too_many_requests", message: "no", retryAfter: 30 },
    ],
    ["a page that names a date", new Response("<html>too many</html>", { status: 429, headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" } }), { kind: "not-json", status: 429 }],
  ])("a call answered with %s keeps the wait with the failure, or none", async (_name, response, failure) => {
    const client = createClient({ server: ORIGIN, token: TOKEN, fetch: async () => response });

    expect(await client.call("uploadFile", { upload: "0123456789abcdef", path: "index.html" }, new Uint8Array(1), 1)).toEqual({ ok: false, failure } as never);
  });
});
