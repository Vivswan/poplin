import { describe, expect, test } from "bun:test";

import { toHttps } from "../../src/transport/to-https";

/** What a request over http is sent to, by the address it asked. */
const moved: readonly (readonly [asked: string, to: string])[] = [
  ["http://report--k3f9x2ab71qz-p-poplin.example.com/a/b.html?c=d#e", "https://report--k3f9x2ab71qz-p-poplin.example.com/a/b.html?c=d#e"],
  ["http://poplin.example.com/", "https://poplin.example.com/"],
  ["http://poplin.example.com:80/login", "https://poplin.example.com/login"],
  ["http://poplin.example.com:8080/login", "https://poplin.example.com:8080/login"],
  ["HTTP://POPLIN.EXAMPLE.COM/Sites", "https://poplin.example.com/Sites"],
  ["http://localhost.example.com/", "https://localhost.example.com/"],
  ["http://127.0.0.1.example.com/", "https://127.0.0.1.example.com/"],
  ["http://127.0.0.2/", "https://127.0.0.2/"],
];

/** The requests the program answers itself: the ones over https, and the ones to this machine. */
const served: readonly string[] = ["https://poplin.example.com/", "https://127.0.0.1/", "http://127.0.0.1:4400/sites", "http://localhost:4400/", "http://[::1]:4400/"];

describe("a request over plain http", () => {
  // Drift: a redirect that dropped the path or the query, or that changed the method, would send a form or a link somewhere else than it was meant for.
  test.each(moved)("%s is sent to %s, for every method, with no body and no cookie", async (asked, to) => {
    const answers = ["GET", "HEAD", "POST", "DELETE"].map((method) => toHttps(new Request(asked, { method, headers: { Cookie: "session=x" } })));
    const shown = await Promise.all(answers.map(async (answer) => [answer?.status, [...(answer?.headers ?? [])], await answer?.text()]));

    expect(shown).toEqual(Array.from({ length: 4 }, () => [308, [["location", to]], ""]));
  });

  // Drift: the preview runs on this machine over http; a redirect there would leave it with no page at all.
  test.each(served)("%s is left for the program to answer", (asked) => {
    expect(toHttps(new Request(asked, { method: "POST" }))).toBeUndefined();
  });
});
