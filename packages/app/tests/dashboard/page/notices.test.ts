import { expect, test } from "bun:test";

import { noticeIn, refusalSentence, withNotice } from "../../../src/dashboard/page/notices";

const ORIGIN = "https://poplin.example.com";

test("a refusal names what it is about only when that is a plain name; anything else from an address is left out", () => {
  const cases = [
    ["expires", "The value of expires is not one it takes."],
    ["max_total_size", "The value of max_total_size is not one it takes."],
    [undefined, "The value of a field is not one it takes."],
    ["<script>", "The value of a field is not one it takes."],
    ["Call 555 now", "The value of a field is not one it takes."],
    ["a".repeat(41), "The value of a field is not one it takes."],
  ] as const;

  expect(cases.map(([about]) => refusalSentence("bad_argument", about))).toEqual(cases.map(([, sentence]) => sentence));
});

test("a result written into a path is read back as its sentence; an address shows no sentence that is not in the table", () => {
  const cases = [
    [withNotice("/settings", { done: "saved" }), "/settings?done=saved", { kind: "done", text: "Saved." }],
    [withNotice("/?view=trash", { done: "deleted" }), "/?view=trash&done=deleted", { kind: "done", text: "Deleted forever." }],
    [withNotice("/sites/a--b", { refused: "in_trash" }), "/sites/a--b?refused=in_trash", { kind: "refused", text: "The site sits in the trash. Restore it first." }],
    [withNotice("/x", { refused: "bad_argument", about: "title" }), "/x?refused=bad_argument&about=title", { kind: "refused", text: "The value of title is not one it takes." }],
    ["/x?done=Pay+now", "/x?done=Pay+now", undefined],
    ["/x?done=constructor", "/x?done=constructor", undefined],
    ["/x?refused=constructor", "/x?refused=constructor", { kind: "refused", text: "The request was refused." }],
    ["/x", "/x", undefined],
  ] as const;

  for (const [written, path, notice] of cases) {
    expect(written).toBe(path);
    expect(noticeIn(new URL(`${ORIGIN}${path}`))).toEqual(notice);
  }
});
