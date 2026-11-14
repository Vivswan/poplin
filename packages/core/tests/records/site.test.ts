import { describe, expect, test } from "bun:test";

import { mintSiteFolder, siteFromRow } from "../../src/records/site";
import { mintSiteId } from "../../src/sites/ids";

const TOKEN_ID = "00000000000000aa";
const NOW = 1_700_000_000_000;

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
