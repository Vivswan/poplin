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
});
