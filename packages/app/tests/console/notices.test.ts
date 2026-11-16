import { expect, test } from "bun:test";

import { refusalSentence } from "../../src/console/notices";

test("a refusal names what it is about only when that is a plain name; anything else from an address is left out", () => {
  const cases = [
    ["search_engines", "The value of search_engines is not one it takes."],
    ["expires", "Pick a day that is still ahead."],
    ["max_sites", "Use a whole number, 1 or more, or leave it empty for no limit."],
    [undefined, "The value of a field is not one it takes."],
    ["<script>", "The value of a field is not one it takes."],
    ["Call 555 now", "The value of a field is not one it takes."],
    ["a".repeat(41), "The value of a field is not one it takes."],
  ] as const;

  expect(cases.map(([about]) => refusalSentence("bad_argument", about))).toEqual(cases.map(([, sentence]) => sentence));
});

// Drift: an action and the dashboard's own check of a request share the code `too_large`, and an upload and a site share `not_found`; told apart by the code alone, a copy that fits no limit reads as a request that was too large.
test("a refusal that names a limit or an upload says so: the limit a copy does not fit, and a copy that is gone; the same code about nothing keeps its own sentence", () => {
  const cases = [
    ["too_large", undefined, "The request was too large, so nothing was changed."],
    ["too_large", "max_total_size", "The copy does not fit under max_total_size, which bounds all sites together, the trash and unfinished copies included. No copy was made."],
    ["too_large", "max_site_size", "The copy does not fit under max_site_size: the site is larger than one site may be now. No copy was made."],
    ["too_large", "max_pending_uploads", "Too many copies and uploads are unfinished at once. Finish or cancel one; an unfinished one is removed about a day after it began. No copy was made."],
    ["too_large", "max_manifest_size", "The copy does not fit a limit of the install: max_manifest_size. No copy was made."],
    ["too_large", "<script>", "The request was too large, so nothing was changed."],
    ["not_found", undefined, "No site is at this address. It may have been deleted, or the link is an old one."],
    ["not_found", "upload", "The copy stopped. If the site is not under All sites, duplicate it again."],
  ] as const;

  expect(cases.map(([code, about]) => refusalSentence(code, about))).toEqual(cases.map(([, , sentence]) => sentence));
});
