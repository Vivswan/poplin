import { expect, test } from "bun:test";

import { isForm, readForm, requireFields } from "../../../src/dashboard/security/form";

test("only the URL-encoded type counts as a form, so a body a cross-origin page can send without a preflight in another type is refused", () => {
  const cases = [
    ["application/x-www-form-urlencoded", true],
    ["application/x-www-form-urlencoded; charset=UTF-8", true],
    ["Application/X-WWW-Form-Urlencoded", true],
    ["multipart/form-data; boundary=x", false],
    ["text/plain", false],
    ["application/json", false],
    ["application/x-www-form-urlencoded-not", false],
    ["text/plain; application/x-www-form-urlencoded", false],
    ["", false],
    [null, false],
  ] as const;

  for (const [type, form] of cases) {
    const headers = new Headers(type === null ? {} : { "Content-Type": type });

    expect([type, isForm({ headers })]).toEqual([type, form]);
  }
});

test("a form's fields are read by name as they were sent, the last of a repeated name; a missing field refuses the form and an unknown one is ignored", () => {
  const form = readForm("title=+Q3+sales+&access=private&access=public&extra=1&empty=&bad=%E0%A4%A");

  expect(Object.fromEntries(form)).toEqual({ title: " Q3 sales ", access: "public", extra: "1", empty: "", bad: "\ufffd%A" });
  expect(requireFields(form, ["title", "access", "empty"])).toEqual({ title: " Q3 sales ", access: "public", empty: "" });
  expect(requireFields(form, ["title", "missing"])).toBeUndefined();
  expect(requireFields(readForm(""), [])).toEqual({});
});
