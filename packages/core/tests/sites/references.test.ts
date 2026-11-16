import { describe, expect, test } from "bun:test";

import * as v from "valibot";

import { ADDRESS_LAYOUT } from "../../src/sites/address-layout";
import { mayBeOfInstall, readSiteReference, settleSite } from "../../src/sites/references";

const ID = "k3f9x2ab71qz";
const LABEL = `report--${ID}`;
const SITE = { kind: "site", name: "report", id: ID };
const SERVER = "https://poplin.example.com";
const NO_ADDRESS = { ok: false, refusal: "no-site-address" };
const NO_URL = { ok: false, refusal: "no-site-url" };
const PAGE = { kind: "hostname", public_word: "page" } as const;
const SITE_WORD = { kind: "hostname", public_word: "site" } as const;
const PATHS = { kind: "path", sites_host: "sites.example.net", private_host: "private.example.net:8443" } as const;

describe("readSiteReference", () => {
  // Drift: a person pastes whatever the browser, the dashboard, or an agent showed; each form must name the one site its label names, and say where an address sits.
  test.each([
    [LABEL, SITE],
    [ID, { kind: "id", id: ID }],
    ["docs", { kind: "public-name", name: "docs" }],
    [`https://${LABEL}-p-poplin.example.com`, { ...SITE, under: "example.com" }],
    [`https://${LABEL}-u-poplin.example.com/`, { ...SITE, under: "example.com" }],
    [`https://${LABEL}-p-poplin.example.com/any/path?x=1#y`, { ...SITE, under: "example.com" }],
    [`http://${LABEL}-p-poplin.example.com/`, { ...SITE, under: "example.com" }],
    [`${LABEL}-u-poplin.example.com/`, { ...SITE, under: "example.com" }],
    [`${LABEL}-u-poplin.example.com`, { ...SITE, under: "example.com" }],
    [`${LABEL}-u-poplin.example.com/?next=https://example.org/`, { ...SITE, under: "example.com" }],
    [`${LABEL}-u-poplin.example.com:8443/a`, { ...SITE, under: "example.com:8443" }],
    [`${LABEL}-poplin.example.com`, { ...SITE, under: "example.com" }],
    ["HTTPS://Report--K3F9X2AB71QZ-P-Poplin.Example.COM/Page", { ...SITE, under: "example.com" }],
    [`https://${LABEL}-p-poplin.example.com./`, { ...SITE, under: "example.com" }],
    [`https://${LABEL}-p-poplin.sites.example.com:8443/`, { ...SITE, under: "sites.example.com:8443" }],
    [`https://${LABEL}-p-poplin.example.com:443/`, { ...SITE, under: "example.com" }],
    [`https://old-name--${ID}-p-poplin.example.com/`, { kind: "site", name: "old-name", id: ID, under: "example.com" }],
    [`https://${ID}-u-poplin.example.com/`, { kind: "id", id: ID, under: "example.com" }],
    [`${LABEL}-p-poplin`, SITE],
    [`${LABEL}-u-poplin`, SITE],
    [`${LABEL}-poplin`, SITE],
    ["https://docs-page.example.com/", { kind: "address", label: "docs-page", under: "example.com" }],
    ["docs-page.example.com", { kind: "address", label: "docs-page", under: "example.com" }],
    ["https://q3-docs-site.example.com/guide", { kind: "address", label: "q3-docs-site", under: "example.com", segment: { kind: "public-name", name: "guide" } }],
    [`https://${LABEL}-p-poplin.example.com/docs/`, { ...SITE, under: "example.com" }],
    ["https://docs-poplin.example.com/", { kind: "address", label: "docs-poplin", under: "example.com" }],
    [`  ${LABEL}\n`, SITE],
    [`"${LABEL}"`, SITE],
    [`'${ID}'`, { kind: "id", id: ID }],
    [`<https://${LABEL}-p-poplin.example.com/>`, { ...SITE, under: "example.com" }],
    [` "https://${LABEL}-p-poplin.example.com/" `, { ...SITE, under: "example.com" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("%j names the site", (typed, site) => {
    expect<unknown>(readSiteReference(typed)).toEqual({ ok: true, value: site });
  });

  // Drift: a word that held a meaning before addresses were read keeps it; `docs-page` is a public name, and only an install knows its own public word.
  test.each([
    ["docs-page", { kind: "public-name", name: "docs-page" }],
    ["docs-poplin", { kind: "public-name", name: "docs-poplin" }],
    [`${ID}-p-poplin`, { kind: "public-name", name: `${ID}-p-poplin` }],
    ["report-p-poplin", { kind: "public-name", name: "report-p-poplin" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("%j, a word without a dot, stays the public name it is", (typed, site) => {
    expect<unknown>(readSiteReference(typed)).toEqual({ ok: true, value: site });
  });

  // Drift: an address that is no site's must be refused as one, never read on as a name: a guess would change or delete some other site.
  test.each([
    ["https://example.com/", NO_URL],
    ["https://poplin.example.com/", NO_URL],
    [`https://sites.example.net/Report--${ID}/`, NO_URL],
    ["https://sites.example.net/report--short/", NO_URL],
    ["https://sites.example.net/a.html", NO_URL],
    ["https://sites.example.net//docs/", NO_URL],
    ["https://sites.example.net/?docs", NO_URL],
    ["https://localhost:4400/docs/", NO_URL],
    ["https://[::1]/docs/", NO_URL],
    ["docs/report", NO_ADDRESS],
    ["../docs", NO_ADDRESS],
    ["https://report-p-poplin.example.com/", NO_URL],
    ["https://report--short-p-poplin.example.com/", NO_URL],
    [`https://${LABEL}-x-poplin.example.com/`, NO_URL],
    [`https://xn--${ID}-p-poplin.example.com/`, NO_URL],
    ["https://\u00e9\u00e8-page.example.com/", NO_URL],
    [`https://user:secret@${LABEL}-p-poplin.example.com/`, NO_URL],
    [`https://user@${LABEL}-p-poplin.example.com/`, NO_URL],
    [`ftp://${LABEL}-p-poplin.example.com/`, NO_URL],
    [`https://https://${LABEL}-p-poplin.example.com/`, NO_URL],
    [`https://example.org/?next=${LABEL}-p-poplin.example.com`, NO_URL],
    [`${LABEL}-p-poplin.example.com://user:secret@other--w8t1c5n0ze4u-p-poplin.example.com/`, NO_URL],
    [`${LABEL}-p-poplin.example.com://other--w8t1c5n0ze4u-p-poplin.example.com/`, NO_URL],
    [`https://${LABEL}-p-poplin/`, NO_URL],
    [`https://${LABEL}-p-poplin.example.com:port/`, NO_ADDRESS],
    ["https://docs-page2.example.com/", NO_URL],
    ["https://127.0.0.1/", NO_URL],
    ["https://[::1]/", NO_URL],
    ["./report", NO_ADDRESS],
    ["report.html", NO_ADDRESS],
    [`${LABEL}/index.html`, NO_ADDRESS],
    ["https://", NO_ADDRESS],
    ["", { ok: false, refusal: "empty" }],
    ["   ", { ok: false, refusal: "empty" }],
    ['""', { ok: false, refusal: "empty" }],
    ["report--short-p-poplin", { ok: false, refusal: "bad-id" }],
    [`Report--${ID}`, { ok: false, refusal: "bad-character" }],
    [`<<${LABEL}>>`, { ok: false, refusal: "bad-character" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("%j reads as %j", (typed, outcome) => {
    expect<unknown>(readSiteReference(typed)).toEqual(outcome);
  });
});

describe("settleSite", () => {
  // Drift: the layout is the install's own, so one address is a site under one install and nothing under another; a guess would change or delete the site of another name, or of another install.
  test.each([
    ["https://docs-page.example.com/", SERVER, PAGE, { kind: "public-name", name: "docs", under: "example.com" }],
    ["https://docs-site.example.com/", SERVER, SITE_WORD, { kind: "public-name", name: "docs", under: "example.com" }],
    ["https://q3-docs-site.example.com:8443/guide", "https://poplin.example.com:8443", SITE_WORD, { kind: "public-name", name: "q3-docs", under: "example.com:8443" }],
    ["https://docs-poplin.example.com/", SERVER, { kind: "hostname", public_word: "poplin" }, { kind: "public-name", name: "docs", under: "example.com" }],
    ["https://notes-site.example.com/", SERVER, PAGE, undefined],
    ["https://docs-page.example.com/", SERVER, SITE_WORD, undefined],
    ["https://docs-poplin.example.com/", SERVER, PAGE, undefined],
    ["https://docs-page.example.org/guide", SERVER, PAGE, undefined],
    ["https://docs-page.example.com:8443/guide", SERVER, PAGE, undefined],
    ["https://docs-page.example.com/guide", "https://admin.example.com", PAGE, undefined],
    [`https://sites.example.net/${LABEL}/`, SERVER, PAGE, undefined],
    [`https://sites.example.net/${LABEL}/a?b#c`, SERVER, PATHS, SITE],
    [`https://private.example.net:8443/${LABEL}`, SERVER, PATHS, SITE],
    [`HTTPS://Sites.Example.NET./${LABEL}/Page`, SERVER, PATHS, SITE],
    [`sites.example.net/old-name--${ID}/`, SERVER, PATHS, { kind: "site", name: "old-name", id: ID }],
    [`https://private.example.net:8443/${ID}/`, SERVER, PATHS, { kind: "id", id: ID }],
    ["https://sites.example.net/docs/guide", SERVER, PATHS, { kind: "public-name", name: "docs" }],
    ["https://sites.example.net/docs-page/", SERVER, PATHS, { kind: "public-name", name: "docs-page" }],
    ["https://private.example.net:8443/docs/", SERVER, PATHS, undefined],
    [`https://private.example.net/${LABEL}/`, SERVER, PATHS, undefined],
    [`https://sites.example.net:8443/${LABEL}/`, SERVER, PATHS, undefined],
    [`https://sites.example.org/${LABEL}/`, SERVER, PATHS, undefined],
    [`https://evil.sites.example.net/${LABEL}/`, SERVER, PATHS, undefined],
    [`https://poplin.example.com/${LABEL}/`, SERVER, PATHS, undefined],
    ["https://docs-page.example.com/", SERVER, PATHS, undefined],
  ] as ReadonlyArray<readonly [string, string, v.InferInput<typeof ADDRESS_LAYOUT>, unknown]>)("%j, asked of %j laid out as %j, is %j", (typed, server, layout, site) => {
    const read = readSiteReference(typed);
    if (!read.ok) throw new Error(`fixture is no site: ${typed}`);

    expect<unknown>(settleSite(read.value, { server, layout: v.parse(ADDRESS_LAYOUT, layout) })).toEqual(site);
  });
});

describe("mayBeOfInstall", () => {
  // Drift: the install is asked by label alone, so this is the one place a label address of another install, or a look-alike of this one, is told apart.
  test.each([
    [LABEL, SERVER, true],
    [`https://${LABEL}-p-poplin.example.com/`, SERVER, true],
    ["docs-page.example.com", SERVER, true],
    [`https://${LABEL}-p-poplin.example.com:8443/`, "https://poplin.example.com:8443", true],
    [`https://${LABEL}-p-poplin.example.org/`, SERVER, false],
    [`https://${LABEL}-p-poplin.evil.example/`, SERVER, false],
    [`https://${LABEL}-p-poplin.example.com.evil.example/`, SERVER, false],
    [`https://${LABEL}-p-poplin.sub.example.com/`, SERVER, false],
    [`https://${LABEL}-p-poplin.example.com:8443/`, SERVER, false],
    [`https://${LABEL}-p-poplin.example.com/`, "https://poplin.example.com:8443", false],
    [`https://${LABEL}-p-poplin.example.com/`, "https://admin.example.com", false],
    [`https://${LABEL}-p-poplin.example.com/`, "http://127.0.0.1:4400", false],
    [`https://${LABEL}-p-poplin.example.com/`, "not an address", false],
  ] as const)("%j, asked of %j: %j", (typed, server, expected) => {
    const site = readSiteReference(typed);
    if (!site.ok) throw new Error(`fixture is no site: ${typed}`);

    expect(mayBeOfInstall(site.value, server)).toBe(expected);
  });
});
