import { describe, expect, test } from "bun:test";

import { refusalResponse } from "../../src/limits/refusal";

describe("refusalResponse", () => {
  const cases: readonly { readonly which: "visitor" | "site" | "day" | "site-share"; readonly retryAfterSeconds: number; readonly seconds: string }[] = [
    { which: "visitor", retryAfterSeconds: 40, seconds: "40" },
    { which: "site", retryAfterSeconds: 0.2, seconds: "1" },
    { which: "day", retryAfterSeconds: 0, seconds: "1" },
    { which: "site-share", retryAfterSeconds: 43_200, seconds: "43200" },
  ];

  // Drift: browsers and crawlers wait by `Retry-After`; a body naming the limit would tell a visitor how busy other sites are.
  test.each(cases)("a $which refusal is a 429 that says only when to come back: $seconds seconds", async ({ which, retryAfterSeconds, seconds }) => {
    const response = refusalResponse({ ok: false, which, retryAfterSeconds });

    expect({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() }).toEqual({
      status: 429,
      headers: { "retry-after": seconds, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: `Too many requests. Try again in ${seconds} seconds.\n`,
    });
  });
});
