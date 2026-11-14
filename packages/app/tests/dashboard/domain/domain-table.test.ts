import { expect, test } from "bun:test";

import { domainBody } from "../../../src/dashboard/domain/domain-table";

const HOSTILE = `"><script>alert(1)</script>`;
const ESCAPED = "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;";

test("a row, a step, a right, and the form's token reach the page escaped, in text and inside an attribute", async () => {
  const reading = { ok: true, rows: [{ object: HOSTILE, state: "missing", detail: HOSTILE }], steps: [{ text: HOSTILE, address: HOSTILE }] } as const;
  const body = String(await domainBody({ csrf: HOSTILE, tokenLabel: HOSTILE, tokenRights: [HOSTILE], path: "/domain", ran: { run: "check", reading } }));

  expect(body).toContain(`<td>${ESCAPED}</td>`);
  expect(body).toContain(`<td class="wrap">${ESCAPED}</td>`);
  expect(body).toContain(`<li>${ESCAPED} <a href="${ESCAPED}" rel="noreferrer">${ESCAPED}</a></li>`);
  expect(body).toContain(`name="csrf" value="${ESCAPED}"`);
  expect(body).toContain(`<label for="token">${ESCAPED}</label>`);
  expect(body).toContain(`<ul class="hint"><li>${ESCAPED}</li></ul>`);
  expect(body).not.toContain("<script>");
});
