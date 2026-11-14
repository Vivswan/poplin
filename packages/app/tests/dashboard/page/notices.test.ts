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

// Drift: an action and the dashboard's own form check share the code `too_large`, and an upload and a site share `not_found`; told apart by the code alone, a copy that fits no limit reads as a form that was too large.
test("a refusal that names a limit or an upload says so: the limit a copy does not fit, and a copy that is gone; the same code about nothing keeps its own sentence", () => {
  const cases = [
    ["too_large", undefined, "The form was too large, so nothing was changed."],
    ["too_large", "max_total_size", "The copy does not fit under max_total_size, which bounds all sites together, the trash and unfinished copies included. No copy was made."],
    ["too_large", "max_site_size", "The copy does not fit under max_site_size: the site is larger than one site may be now. No copy was made."],
    ["too_large", "max_pending_uploads", "Too many copies and uploads are unfinished at once. Finish or cancel one; an unfinished one is removed about a day after it began. No copy was made."],
    ["too_large", "max_manifest_size", "The copy does not fit a limit of the install: max_manifest_size. No copy was made."],
    ["too_large", "<script>", "The form was too large, so nothing was changed."],
    ["not_found", undefined, "No site with that id or public name."],
    ["not_found", "upload", "That copy can no longer be gone on with: it was cancelled, or its day to finish ran out. Unless the list of sites shows it, duplicate the site again."],
  ] as const;

  expect(cases.map(([code, about]) => refusalSentence(code, about))).toEqual(cases.map(([, , sentence]) => sentence));
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
