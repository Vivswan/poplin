import { describe, expect, test } from "bun:test";

import type { TokenId } from "../src/auth/tokens";
import type { SiteName } from "../src/names/names";
import { RECORD_PREFIXES, settingsKey, siteKey, tokenKey } from "../src/records/keys";

describe("record keys", () => {
  test("drift: a key that changes strands every record already stored, since a bucket's layout cannot be moved one record at a time", () => {
    expect<unknown>([settingsKey(), siteKey("report" as SiteName), tokenKey("00000000000000aa" as TokenId), RECORD_PREFIXES]).toEqual([
      ".settings",
      ".sites/report",
      ".tokens/00000000000000aa",
      { settings: ".settings", site: ".sites/", token: ".tokens/" },
    ]);
  });
});
