import { describe, expect, test } from "bun:test";

import manifest from "../../package.json" with { type: "json" };
import { problemLines, problemOf } from "../../src/commands/problems";
import { foldedText } from "../../src/local/screen";

describe("a hint that says to report it", () => {
  // Drift: the pages link the place of a report, and a terminal shows no link. A hint without the address sends a person to look for it, and one written by hand could name another place than the package does.
  test.each([
    ["version_refused", undefined],
    ["release_refused", "digest_differs"],
    ["release_refused", "other_version"],
  ] as const)("%s, about %s, ends in the address the package names for reports, and folds inside 80 columns", (code, about) => {
    const [, hint = ""] = problemLines(problemOf({ kind: "refused", status: 409, code, message: "refused", about }));

    expect([hint.endsWith(`report it at ${manifest.bugs.url}`), foldedText(hint).split("\n").filter((row) => row.length > 80)]).toEqual([true, []]);
  });
});
