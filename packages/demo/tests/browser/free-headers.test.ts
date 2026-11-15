import { expect, test } from "bun:test";

import { freeClasses } from "../../src/browser/free-headers";

/** The header names a browser takes off a request a script builds. */
const HIDDEN_FROM_REQUESTS = ["Origin", "Cookie", "Content-Length"];

/** A request class that drops those headers, as a browser's does. */
class StrictRequest extends Request {
  override get headers(): Headers {
    const headers = new Headers(super.headers);
    for (const name of HIDDEN_FROM_REQUESTS) headers.delete(name);

    return headers;
  }
}

/** A response class that drops `Set-Cookie`, as a browser's does. */
class StrictResponse extends Response {
  override get headers(): Headers {
    const headers = new Headers(super.headers);
    headers.delete("Set-Cookie");

    return headers;
  }
}

const FREE = freeClasses({ Request: StrictRequest, Response: StrictResponse });

test("over classes that drop them, a request keeps `Origin`, `Cookie`, and `Content-Length` and a response keeps `Set-Cookie`: without this the product's form check and the dashboard's choice of scheme read nothing inside a browser", async () => {
  const sent = { Origin: "https://example.com", Cookie: "theme=dark", "Content-Length": "3", Accept: "text/html" };
  const strict = new StrictRequest("https://example.com/settings", { method: "POST", headers: sent, body: "a=1" });
  const free = new FREE.Request("https://example.com/settings", { method: "POST", headers: sent, body: "a=1" });
  const copied = new FREE.Request(free.clone());
  const answer = new FREE.Response("done", { status: 303, headers: { Location: "/", "Set-Cookie": "theme=dark; Path=/" } });
  answer.headers.append("Set-Cookie", "seen=1");

  expect(Object.keys(sent).filter((name) => strict.headers.has(name))).toEqual(["Accept"]);
  expect(
    [free, free.clone(), copied, new FREE.Request(free.clone(), { headers: { Accept: "*/*" } })].map((request) => Object.fromEntries(request.headers)),
  ).toEqual([
    { origin: sent.Origin, cookie: sent.Cookie, "content-length": "3", accept: "text/html" },
    { origin: sent.Origin, cookie: sent.Cookie, "content-length": "3", accept: "text/html" },
    { origin: sent.Origin, cookie: sent.Cookie, "content-length": "3", accept: "text/html" },
    { accept: "*/*" },
  ]);
  expect([await free.clone().text(), copied.method, copied.url]).toEqual(["a=1", "POST", "https://example.com/settings"]);
  expect(new StrictResponse("done", { headers: { "Set-Cookie": "seen=1" } }).headers.getSetCookie()).toEqual([]);
  expect([answer.headers.getSetCookie(), answer.clone().headers.getSetCookie()]).toEqual([
    ["theme=dark; Path=/", "seen=1"],
    ["theme=dark; Path=/", "seen=1"],
  ]);
  expect([answer.status, answer.headers.get("Location"), await answer.clone().text()]).toEqual([303, "/", "done"]);
});
