import { expect, test } from "bun:test";

import { isSameOrigin } from "../../../src/dashboard/security/same-origin";

const URL_ASKED = "https://admin.example.com/settings/save";

test("only a request whose Origin is the origin it was sent to, and that no browser marks as coming from elsewhere, counts as the dashboard's own", () => {
  const cases = [
    [{ Origin: "https://admin.example.com" }, true],
    [{ Origin: "https://admin.example.com", "Sec-Fetch-Site": "same-origin" }, true],
    [{}, false],
    [{ "Sec-Fetch-Site": "same-origin" }, false],
    [{ Origin: "null" }, false],
    [{ Origin: "" }, false],
    [{ Origin: "http://admin.example.com" }, false],
    [{ Origin: "https://admin.example.com:8443" }, false],
    [{ Origin: "https://admin.example.com/" }, false],
    [{ Origin: "https://ADMIN.example.com" }, false],
    [{ Origin: "https://admin.example.com.evil.example" }, false],
    [{ Origin: "https://shop-page.example.com" }, false],
    [{ Origin: "https://example.com" }, false],
    [{ Origin: "https://admin.example.com", "Sec-Fetch-Site": "same-site" }, false],
    [{ Origin: "https://admin.example.com", "Sec-Fetch-Site": "cross-site" }, false],
    [{ Origin: "https://admin.example.com", "Sec-Fetch-Site": "none" }, false],
    [{ Origin: "https://admin.example.com", "Sec-Fetch-Site": "" }, false],
  ] as const;

  for (const [headers, same] of cases) {
    expect([headers, isSameOrigin({ url: URL_ASKED, headers: new Headers(headers) })]).toEqual([headers, same]);
  }
});
