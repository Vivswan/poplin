import { describe, expect, test } from "bun:test";
import { safeReturnPath } from "../../src/login/return-path";

const KEPT: readonly string[] = ["/", "/sites", "/sites/report--k3f9x2ab71qz", "/settings?tab=zone", "/tokens#new", "/a/b.c_d-e~f", "/search?q=a%20b&next=%2Fsites", "/sites?see=https://example.com/"];

const REFUSED: readonly (string | null | undefined)[] = [
  undefined,
  null,
  "",
  "sites",
  "./sites",
  "?tab=zone",
  "#top",
  "https://evil.example",
  "http://evil.example/",
  "HTTPS://evil.example",
  "//evil.example",
  "///evil.example",
  "////evil.example/%2f..",
  "/\\evil.example",
  "\\\\evil.example",
  "\\/evil.example",
  "/\\/evil.example",
  "/sites\\..\\..\\evil.example",
  "/.//evil.example",
  "/..//evil.example",
  "/sites/..//evil.example",
  "/./\\evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "/\r/evil.example",
  "\t//evil.example",
  " //evil.example",
  " /sites",
  "/sites\r\nSet-Cookie: a=b",
  "/sites\u0000",
  "/sites\u007f",
  "/sites and more",
  "/\u00e9",
  "/\u2215evil.example",
  "/\uff0fevil.example",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "mailto:owner@example.com",
  "evil.example",
  "@evil.example",
  "https:evil.example",
  "https:/evil.example",
  "http:\\\\evil.example",
  `/${"a".repeat(2048)}`,
];

describe("the place to go back to after the login", () => {
  // Drift: a path of the dashboard would be thrown away, and every login would land on the root.
  test.each(KEPT)("%p is a dashboard path and is kept", (target) => {
    expect(safeReturnPath(target)).toBe(target);
  });

  // Drift: the login would become an open redirect, sending the owner to another origin right after they signed in.
  test.each(REFUSED)("%p goes to the dashboard root", (target) => {
    expect(safeReturnPath(target)).toBe("/");
  });

  // Drift: a kept path would stop being a path of this origin once a browser resolved it against the dashboard.
  test.each([...KEPT, ...REFUSED])("%p resolves on the dashboard's own origin", (target) => {
    const resolved = new URL(safeReturnPath(target), "https://admin.example.com");

    expect(resolved.origin).toBe("https://admin.example.com");
  });
});
