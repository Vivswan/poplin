import { expect, test } from "bun:test";
import { html } from "hono/html";

import { csrfField, framePage, refusedPage } from "../../../src/dashboard/page/frame";
import type { Visit } from "../../../src/dashboard/records";

const HOSTILE = `"><script>alert(1)</script><img src=x onerror='alert(2)'>&amp;`;
const ESCAPED = "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=&#39;alert(2)&#39;&gt;&amp;amp;";

test("a heading, a title, a notice, and a nonce reach the document escaped, in text and inside an attribute", async () => {
  const page = { tab: "sites", heading: HOSTILE, body: html`<p>body</p>` } as const;
  const document = String(await framePage(page, { title: HOSTILE, nonce: HOSTILE, notice: { kind: "refused", text: HOSTILE } }));

  expect(document).toContain(`<title>${ESCAPED} - ${ESCAPED}</title>`);
  expect(document).toContain(`<h1>${ESCAPED}</h1>`);
  expect(document).toContain(`<p class="brand">${ESCAPED}</p>`);
  expect(document).toContain(`<style nonce="${ESCAPED}">`);
  expect(document).toContain(`<p class="notice refused" role="status">${ESCAPED}</p>`);
  expect(document).not.toContain("<script>");
  expect(document).not.toContain("<img");
});

test("the frame marks exactly one tab as the current page: the page's own", async () => {
  const frames = [
    ["sites", "Sites"],
    ["settings", "Settings"],
    ["activity", "Activity"],
    ["usage", "Usage"],
  ] as const;

  for (const [tab, label] of frames) {
    const document = String(await framePage({ tab, heading: "Heading", body: html`` }, { title: "Title", nonce: "n" }));

    expect(document.match(/aria-current="page">[^<]*/g)).toEqual([`aria-current="page">${label}`]);
  }
});

test("a refused page says the table's sentence and never the code's own text, and the token field escapes its value", async () => {
  const page = refusedPage({ tab: "sites", heading: "Site", status: 404 }, { code: "<b>not_a_code</b>", about: HOSTILE });
  const field = csrfField({ csrf: HOSTILE } as Visit);

  expect([page.status, String(await page.body)]).toEqual([404, '<p class="notice refused" role="status">The request was refused.</p>']);
  expect(String(await field)).toBe(`<input type="hidden" name="csrf" value="${ESCAPED}">`);
});
