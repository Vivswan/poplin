// The upgrade check's own test. Drift: a check that finds nothing proves nothing until it is seen to find a break, and a check that finds something proves nothing until it is seen to pass where nothing broke.

import { afterAll, describe, expect, test } from "bun:test";
import { fault } from "./support/command";
import { differences } from "./support/findings";
import { checkOut, HERE } from "./support/trees";
import { upgradeFindings } from "./support/upgrade";

/** A commit of main from before the first release, when the first step was still edited in place: after it `versions` and `declared_files` got columns and the settings a key, with no step of their own. */
const EDITED_IN_PLACE = "b17e7e60b511ca6e01dc2a0ada765d058c9492b9";

/** How long one upgrade may take, in milliseconds: two installs, and some eighty runs of the command. */
const UPGRADE_MS = 120_000;

/** The address the install of the hand-written answers below answered at. */
const ADDRESS = "http://127.0.0.1:4400";

describe("the upgrade check", () => {
  // The older commit's tree is removed while the tests after it run, and the file's end waits for it.
  let removed: Promise<void> = Promise.resolve();
  afterAll(() => removed, UPGRADE_MS);

  test(
    "an install made before the first step was last edited in place is found unreadable by this code, and its backup refused with its settings: without this the break that left an install with unreadable settings passes the check",
    async () => {
      const tree = checkOut(HERE.root, EDITED_IN_PLACE);

      try {
        const findings = await upgradeFindings(tree);
        const shapes = new Set(findings.map(({ shape }) => shape));

        expect([shapes.has("database"), shapes.has("settings"), shapes.has("backup")]).toEqual([true, true, true]);
      } finally {
        removed = Promise.resolve(tree[Symbol.asyncDispose]());
      }
    },
    UPGRADE_MS,
  );

  test(
    "an install this code made and filled upgrades to this code with no finding: without this a finding of the check could be the check's own fault",
    async () => {
      expect(await upgradeFindings(HERE)).toEqual([]);
    },
    UPGRADE_MS,
  );

  test("each comparison names what is gone or changed and passes what is kept, moved, or added: without this a row that can find nothing reads as an upgrade that works", () => {
    const answer = { sites: [{ id: "a1", url: `${ADDRESS}/served/a1/`, versions: [1, 2] }], limit: 5 };
    const refusal = (hint: string): unknown => ({ error: { code: "bad_argument", hint } });

    expect({
      reads: differences(answer, { sites: [{ id: "a1", url: "https://a1.example.com/", versions: [1] }], more: true }, ADDRESS, "`poplin list`"),
      sameReads: differences(answer, { ...answer, more: true }, ADDRESS),
      otherSite: differences({ url: `${ADDRESS}/served/a1/` }, { url: "https://b2.example.com/a1" }, ADDRESS, "the site"),
      noAddress: differences({ url: `${ADDRESS}/served/a1/` }, {}, ADDRESS, "the site"),
      commands: [
        fault({ line: "poplin list", exit: 0, answer: answer, said: "" }),
        fault({ line: "poplin list", exit: 1, answer: refusal("the install may be of another version than this poplin"), said: "" }),
        fault({ line: "poplin list", exit: 1, answer: refusal("poplin show <site> lists the versions"), said: "" }),
        fault({ line: "poplin list", exit: 1, answer: undefined, said: "TypeError: not a function\n    at run" }),
      ],
    }).toEqual({
      reads: ["`poplin list`.sites.0.versions held 2 and holds 1", "`poplin list`.limit was 5 and is undefined"],
      sameReads: [],
      otherSite: ['the site.url was "http://127.0.0.1:4400/served/a1/" and is "https://b2.example.com/a1"'],
      noAddress: ['the site.url was "http://127.0.0.1:4400/served/a1/" and is undefined'],
      commands: [
        undefined,
        undefined,
        "`poplin list` was refused with `bad_argument`, which tells nobody to update",
        "`poplin list` ended with exit 1 and no error object: TypeError: not a function",
      ],
    });
  });
});
