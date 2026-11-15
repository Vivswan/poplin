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
  expect(document).toMatch(new RegExp(`<p class="brand"><svg.*?</svg>${ESCAPED.replaceAll("(", "\\(").replaceAll(")", "\\)")}</p>`));
  expect(document).toContain(`<style nonce="${ESCAPED}">`);
  expect(document).toContain(`<p class="notice refused" role="status">${ESCAPED}</p>`);
  expect(document.match(/<script[^>]*>/g)).toEqual(['<script src="/copy.js" defer>']);
  expect(document).not.toContain("<img");
});

// Drift: the side holds four sections for six pages; a page that marked no section, or two pages as the current one, would leave a reader lost.
test("the frame marks exactly one link as the current page, the page's own, and the section it sits under", async () => {
  const frames = [
    ["sites", "Sites", "Sites"],
    ["tokens", "Access", "Access"],
    ["settings", "Settings", "Settings"],
    ["activity", "Activity", "Activity"],
    ["usage", "Usage", "Activity"],
    ["domain", "Domain", "Settings"],
  ] as const;

  for (const [tab, label, section] of frames) {
    const document = String(await framePage({ tab, heading: "Heading", body: html`` }, { title: "Title", nonce: "n", tabs: "domain" })).replace(/<svg.*?<\/svg>/g, "");

    expect(document.match(/aria-current="page">[^<]*/g)).toEqual([`aria-current="page">${label}`]);
    expect(document.match(/aria-current="(?:page|true)">[^<]*/g)?.[0]).toMatch(new RegExp(`>${section}$`));
  }
});

// Drift: only a demo's host hands the frame this part. On a real install a "Demo" line would tell an owner that their sites reset.
test("the frame shows the demo's line and its Reset above the title when it is handed the part, and nothing of it otherwise", async () => {
  const page = { tab: "sites", heading: "Heading", body: html`` } as const;
  const real = String(await framePage(page, { title: "Title", nonce: "n" }));
  const demo = String(await framePage(page, { title: "Title", nonce: "n", demo: { reset: HOSTILE } }));
  const line = `<div class="demo"><b>Demo</b><span>sample data, resets</span><form method="post" action="${ESCAPED}"><button type="submit" class="txt">Reset</button></form></div>`;

  expect(demo).toContain(`<main id="content">\n${line}\n<div class="title"><h1>Heading</h1></div>`);
  expect([real.includes('class="demo"'), real.includes("Reset"), real.includes('<main id="content">\n<div class="title">')]).toEqual([false, false, true]);
});

test("a refused page says the table's sentence and never the code's own text, and the token field escapes its value", async () => {
  const page = refusedPage({ tab: "sites", heading: "Site", status: 404 }, { code: "<b>not_a_code</b>", about: HOSTILE });
  const field = csrfField({ csrf: HOSTILE } as Visit);

  expect([page.status, String(await page.body)]).toEqual([404, '<p class="notice refused" role="status">The request was refused.</p>']);
  expect(String(await field)).toBe(`<input type="hidden" name="csrf" value="${ESCAPED}">`);
});
