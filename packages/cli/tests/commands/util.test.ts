import { describe, expect, test } from "bun:test";

import { looksLikePath } from "../../src/commands/util";

describe("looksLikePath", () => {
  // Drift: a shell hands a path over in its own system's form, so a form left out here publishes on one system and is an unknown command on another.
  const forms: ReadonlyArray<readonly [word: string, isPath: boolean]> = [
    [".", true],
    ["..", true],
    ["./report", true],
    ["../x", true],
    ["/srv/site", true],
    ["~/site", true],
    ["sites/report", true],
    ["report/", true],
    ["C:\\work\\report", true],
    ["c:/work/report", true],
    [".\\report", true],
    ["..\\x", true],
    ["report\\", true],
    ["sites\\report", true],
    ["\\work\\report", true],
    ["\\\\server\\share\\report", true],
    ["C:report", true],
    ["C:", true],
    ["report", false],
    ["report.html", false],
    ["report--k3f9x2ab71qz", false],
    ["7d", false],
    ["", false],
  ];

  test.each(forms)("%j is a path: %p, whichever system the command runs on", (word, isPath) => {
    expect(looksLikePath(word)).toBe(isPath);
  });
});
