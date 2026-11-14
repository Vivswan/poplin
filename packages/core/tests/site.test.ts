import { describe, expect, test } from "bun:test";

import { secretName, type SiteName } from "../src/names/names";
import { checkRecord } from "../src/records/kind";
import { SITE } from "../src/records/site";

const TOKEN_ID = "00000000000000aa";
const NOW = 1_700_000_000_000;
const LIVE_PRIVATE = {
  shape: 1,
  revision: 1,
  name: "report",
  title: null,
  access: "private",
  search_engines: false,
  expires: "never",
  embed_from: [],
  live_version: 1,
  versions: [{ number: 1, published: NOW, published_by: TOKEN_ID }],
  owner: TOKEN_ID,
  state: "live",
};
const SECRET = "7f3k9x2mq4ab";

/** The field an invalid record is refused for: the part of the first issue before its colon. */
function refusedField(value: unknown): string | undefined {
  const checked = checkRecord(SITE, value);
  if (checked.ok) return undefined;

  return checked.issues[0]?.split(":")[0];
}

describe("SITE", () => {
  // Drift: these are the records the product writes; one the schema stopped accepting would be refused at the doorway on every read.
  test.each([
    ["a new private site", LIVE_PRIVATE],
    ["an unlisted site with its secret", { ...LIVE_PRIVATE, access: "unlisted", secret: SECRET }],
    ["a public site open to search engines", { ...LIVE_PRIVATE, access: "public", search_engines: true }],
    ["a site in the trash", { ...LIVE_PRIVATE, state: "trash", gone_on: NOW }],
    ["an unlisted site in the trash, which keeps its secret for a restore", { ...LIVE_PRIVATE, access: "unlisted", secret: SECRET, state: "trash", gone_on: NOW }],
    ["a title and an expiry", { ...LIVE_PRIVATE, title: "Q3 sales", expires: NOW }],
    ["an upload through the dashboard, owned by an admin's email", { ...LIVE_PRIVATE, owner: "ada@example.com", versions: [{ number: 1, published: NOW, published_by: "ada@example.com" }] }],
    ["a site shown inside two others", { ...LIVE_PRIVATE, embed_from: ["dashboard", "home"] }],
    [
      "a rolled back site: three versions kept, the second live",
      { ...LIVE_PRIVATE, revision: 9, live_version: 5, versions: [4, 5, 6].map((number) => ({ number, published: NOW + number, published_by: TOKEN_ID })) },
    ],
  ])("accepts %s", (_, record) => {
    expect<unknown>(checkRecord(SITE, record)).toEqual({ ok: true, record });
  });

  // Drift: each row is a state the product must never store; a schema that let one through would hand it to every reader as a valid site.
  test.each([
    ["a secret exists only while unlisted: private", { ...LIVE_PRIVATE, secret: SECRET }, "secret"],
    ["a secret exists only while unlisted: public", { ...LIVE_PRIVATE, access: "public", secret: SECRET }, "secret"],
    ["an unlisted site always has its secret", { ...LIVE_PRIVATE, access: "unlisted" }, "secret"],
    ["a secret is 12 base36 characters", { ...LIVE_PRIVATE, access: "unlisted", secret: "7F3K9X2MQ4AB" }, "secret"],
    ["the day it is gone exists only in the trash", { ...LIVE_PRIVATE, gone_on: NOW }, "gone_on"],
    ["a site in the trash always has the day it is gone", { ...LIVE_PRIVATE, state: "trash" }, "gone_on"],
    ["access is one of three words", { ...LIVE_PRIVATE, access: "hidden" }, "access"],
    ["state is live or trash", { ...LIVE_PRIVATE, state: "deleted" }, "state"],
    ["the stamp is this shape's number", { ...LIVE_PRIVATE, shape: 2 }, "shape"],
    ["the revision counts from 1", { ...LIVE_PRIVATE, revision: 0 }, "revision"],
    ["a name follows the site-name rules", { ...LIVE_PRIVATE, name: "Report" }, "name"],
    ["a title is text or null, never empty", { ...LIVE_PRIVATE, title: "" }, "title"],
    ["search_engines is a switch", { ...LIVE_PRIVATE, search_engines: "on" }, "search_engines"],
    ["expires is never or a moment, not the text typed", { ...LIVE_PRIVATE, expires: "7d" }, "expires"],
    ["embed_from holds site names", { ...LIVE_PRIVATE, embed_from: ["Dash board"] }, "embed_from.0"],
    ["a site has at least one version", { ...LIVE_PRIVATE, versions: [] }, "versions"],
    ["the live version is a kept version", { ...LIVE_PRIVATE, live_version: 2 }, "site"],
    [
      "versions ascend, each number once",
      { ...LIVE_PRIVATE, versions: [1, 1].map((number) => ({ number, published: NOW, published_by: TOKEN_ID })) },
      "site",
    ],
    ["a version says who published it", { ...LIVE_PRIVATE, versions: [{ number: 1, published: NOW }] }, "versions.0.published_by"],
    ["the owner is a token id or an email", { ...LIVE_PRIVATE, owner: "somebody" }, "owner"],
    ["no field beyond the shape", { ...LIVE_PRIVATE, alias: "q3" }, "alias"],
  ])("refuses a record that breaks: %s", (_, record, field) => {
    expect(refusedField(record)).toBe(field);
  });

  test("drift: the secret rule lives in the names module; a secret it mints must be one the record accepts", () => {
    const [, secret] = secretName("report" as SiteName).split("--");

    expect(checkRecord(SITE, { ...LIVE_PRIVATE, access: "unlisted", secret }).ok).toBe(true);
  });
});
