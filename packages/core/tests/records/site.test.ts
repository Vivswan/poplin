import { describe, expect, test } from "bun:test";

import { problemDetail } from "../../src/records/problem-detail";
import { mintSiteFolder, type Site, siteFromRow, siteToRow } from "../../src/records/site";
import { mintSiteId } from "../../src/sites/ids";

/** A made-up token id, which owns the site and published its version. */
const TOKEN_ID = "00000000000000aa";

/** A moment, in milliseconds since the epoch. */
const NOW = 1_700_000_000_000;

/** A site id that holds no digit and no run of hex letters, so the cleaner of a problem's detail reads it as a plain word. */
const LETTERS_ID = "kqzmxpwtlrvn";

/** A stored row of a private site under the id of letters alone. */
const LETTERS_ROW = {
  id: LETTERS_ID,
  name: "report",
  folder: "kqzmxpwtlrvnkqzm",
  access: "private",
  public_name: null,
  title: null,
  page_title: null,
  search_engines: 0,
  embeddable: 1,
  expires_at: null,
  live_version: 1,
  owner: TOKEN_ID,
  created_at: NOW,
  updated_at: NOW,
  trashed_at: null,
  versions: JSON.stringify([{ number: 1, published_at: NOW, published_by: TOKEN_ID, bytes: 1000, files: 4 }]),
} as const;

/** What the Problems list keeps of what a call throws. */
function keptOf(call: () => unknown): string | null {
  try {
    call();
  } catch (error) {
    return problemDetail(error).message;
  }

  return "the call did not throw";
}

describe("mintSiteFolder", () => {
  test("drift: the folder's form is written in the record and its characters are drawn by the ids module; what is minted must be a folder a row may hold", () => {
    const folder = mintSiteFolder();
    const row = {
      id: mintSiteId(),
      name: "report",
      folder,
      access: "private",
      public_name: null,
      title: null,
      page_title: null,
      search_engines: 0,
      embeddable: 1,
      expires_at: null,
      live_version: 1,
      owner: TOKEN_ID,
      created_at: NOW,
      updated_at: NOW,
      trashed_at: null,
      versions: JSON.stringify([{ number: 1, published_at: NOW, published_by: TOKEN_ID, bytes: 1000, files: 4 }]),
    };

    expect(folder).toMatch(/^[0-9a-z]{16}$/);
    expect(siteFromRow(row).folder).toBe(folder);
  });
});

describe("a stored site that breaks its rule", () => {
  // Drift: the failure is kept in the Problems list and copied into a bug report, and an unlisted site's id is its link. About 1 id in 50 holds no digit, so the cleaner keeps it as a plain word: the message itself must never name the site.
  test.each<readonly [what: string, call: () => unknown, kept: string]>([
    ["private with a public name", () => siteFromRow({ ...LETTERS_ROW, public_name: "report" }), "a stored site is private with a public name"],
    ["public without a public name", () => siteFromRow({ ...LETTERS_ROW, access: "public" }), "a stored site is public without a public name"],
    ["live at a version that is not kept", () => siteFromRow({ ...LETTERS_ROW, live_version: 2 }), "a stored site is live at a version that is not kept"],
    ["in the trash since no moment", () => siteToRow({ ...siteFromRow(LETTERS_ROW), state: "trash", trashed_at: null } as unknown as Site), "a site is in the trash since no moment"],
  ])("%s: the kept detail names the fault and never the id", (_what, call, kept) => {
    // Control: the cleaner alone keeps this id, so only a message without it keeps it out.
    expect([keptOf(call), problemDetail(`site ${LETTERS_ID} failed`).message]).toEqual([kept, `site ${LETTERS_ID} failed`]);
  });
});
