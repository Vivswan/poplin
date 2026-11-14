import { describe, expect, test } from "bun:test";
import { safeReturn } from "../../src/login/return-path";
import { hostnameAddresses } from "../../src/sites/hostname-addresses";
import { SUFFIXED } from "../layouts";

const ADDRESSES = hostnameAddresses(SUFFIXED);
const SITE = "report--k3f9x2ab71qz-page.example.com";

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

const SITES_KEPT: readonly string[] = [
  `https://${SITE}/`,
  `https://${SITE}/app.js`,
  `https://${SITE}/docs/page.html?x=1&next=%2Fa#top`,
  `https://${SITE}//evil.example`,
  "https://shop-page.example.com/",
  "https://gallery-page.example.com/",
];

const SITES_REFUSED: readonly (readonly [why: string, target: string])[] = [
  ["a site address with no path", `https://${SITE}`],
  ["another scheme", `http://${SITE}/`],
  ["a scheme that is no web address", `ftp://${SITE}/`],
  ["a script scheme around a site hostname", `javascript://${SITE}/%0aalert(1)`],
  ["no scheme", `//${SITE}/`],
  ["a scheme with one slash", `https:/${SITE}/`],
  ["a scheme with no slash", `https:${SITE}/`],
  ["a scheme in capitals", `HTTPS://${SITE}/`],
  ["a hostname in capitals", `https://${SITE.toUpperCase()}/`],
  ["a domain in mixed case", "https://report--k3f9x2ab71qz-page.Example.com/"],
  ["a site hostname as the user of another host", `https://${SITE}@evil.example/`],
  ["a user before a site hostname", `https://evil.example@${SITE}/`],
  ["a user and a password", `https://owner:secret@${SITE}/`],
  ["an empty user", `https://@${SITE}/`],
  ["a backslash before another host", `https://${SITE}\\@evil.example/`],
  ["a backslash after another host", `https://evil.example\\.${SITE}/`],
  ["backslashes for the scheme's slashes", `https:\\\\${SITE}/`],
  ["a backslash in the path", `https://${SITE}/\\evil.example`],
  ["the default port", `https://${SITE}:443/`],
  ["another port", `https://${SITE}:8443/`],
  ["an empty port", `https://${SITE}:/`],
  ["a host that goes on after the domain", `https://${SITE}.evil.example/`],
  ["a host that ends with the domain's letters", "https://report--k3f9x2ab71qz-pageexample.com/"],
  ["a host that ends with the domain and has no suffix", "https://evilexample.com/"],
  ["another domain with the suffix", "https://report--k3f9x2ab71qz-page.example.org/"],
  ["a hostname of the domain that is no site", "https://www.example.com/"],
  ["the domain itself", "https://example.com/"],
  ["the dashboard as an absolute address", "https://admin.example.com/sites"],
  ["a hostname that only ends like a site", "https://homepage.example.com/"],
  ["a label around no valid id", "https://report--short-page.example.com/"],
  ["a hostname below a site hostname", `https://evil.${SITE}/`],
  ["a trailing dot", `https://${SITE}./`],
  ["an encoded dot before another host", `https://${SITE}%2eevil.example/`],
  ["a host a parser reads as a number", "https://2130706433/"],
  ["a bracketed host", "https://[::1]/"],
  ["a space before the address", ` https://${SITE}/`],
  ["a space in the path", `https://${SITE}/a b`],
  ["a tab in the host", `https://report--k3f9x2ab71qz\t-page.example.com/`],
  ["a line break in the path", `https://${SITE}/\r\nSet-Cookie: a=b`],
  ["a path past the length limit", `https://${SITE}/${"a".repeat(2048)}`],
];

describe("the place to go back to after the login", () => {
  // Drift: a path of the dashboard would be thrown away, and every login would land on the root.
  test.each(KEPT)("%p is a dashboard path and is kept", (target) => {
    expect(safeReturn(target, ADDRESSES)).toBe(target);
  });

  // Drift: the login would become an open redirect, sending the owner to another origin right after they signed in.
  test.each(REFUSED)("%p goes to the dashboard root", (target) => {
    expect(safeReturn(target, ADDRESSES)).toBe("/");
  });

  // Drift: a kept path would stop being a path of this origin once a browser resolved it against the dashboard.
  test.each([...KEPT, ...REFUSED])("%p resolves on the dashboard's own origin", (target) => {
    const resolved = new URL(safeReturn(target, ADDRESSES), "https://admin.example.com");

    expect(resolved.origin).toBe("https://admin.example.com");
  });

  // Drift: a visitor sent to the login from a private site would land on the dashboard instead of the page they asked for.
  test.each(SITES_KEPT)("%p is an address of the install's own sites and is kept", (target) => {
    expect(safeReturn(target, ADDRESSES)).toBe(target);
  });

  // Drift: an address that only looks like a site of the install would pass, and the login would send the owner to a host the install does not answer.
  test.each(SITES_REFUSED)("%s goes to the dashboard root: %p", (_why, target) => {
    expect(safeReturn(target, ADDRESSES)).toBe("/");
  });

  // Drift: a kept address would lead somewhere else once a browser parsed it: off `https`, onto a port, or to a host that is no site of the install.
  test.each([...SITES_KEPT, ...SITES_REFUSED.map(([, target]) => target)])("%p resolves on the dashboard or on an address of the install", (target) => {
    const resolved = new URL(safeReturn(target, ADDRESSES), "https://admin.example.com");

    expect([resolved.protocol, resolved.port, resolved.username, resolved.hostname === "admin.example.com" || ADDRESSES.resolve(resolved).kind !== "none"]).toEqual(["https:", "", "", true]);
  });

  // Drift: dot segments in a site address would survive into the location, where a browser and a log would read two different paths.
  test("a site address comes back as a parser writes it, on the same host", () => {
    expect(safeReturn(`https://${SITE}/docs/../app.js`, ADDRESSES)).toBe(`https://${SITE}/app.js`);
  });
});
