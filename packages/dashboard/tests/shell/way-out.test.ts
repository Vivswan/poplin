// Where Log out leads: the address the page was handed, checked before it becomes a link.

import { describe, expect, test } from "bun:test";

import { wayOut } from "@/shell/way-out";

/** The origin an invented dashboard answers at. */
const ORIGIN = "https://poplin.example.com";

describe("the address Log out leads to", () => {
  // Drift: a start value that holds a script or another host would become the link's target, and a press would run it or leave for that host.
  test.each([
    ["a path of the dashboard's own origin", "/out?as=visitor#top", `${ORIGIN}/out?as=visitor#top`],
    ["a whole https address", "https://login.example.net/logout", "https://login.example.net/logout"],
    ["a script", "javascript:alert(1)", undefined],
    ["a script in other letters, after a space", " JavaScript:alert(1)", undefined],
    ["an address with no scheme that names another host", "//login.example.net/logout", undefined],
    ["a path whose backslash a browser reads as another host", "/\\login.example.net/logout", undefined],
    ["a whole address that is not https", "http://login.example.net/logout", undefined],
    ["data", "data:text/html,<p>out</p>", undefined],
    ["a blob made at the dashboard's own origin", `blob:${ORIGIN}/0f6a`, undefined],
  ])("%s", (_case, address, link) => {
    expect(wayOut(address, ORIGIN)).toBe(link);
  });
});
