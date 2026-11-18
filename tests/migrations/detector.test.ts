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

  test("a comparison reads every kind of value the same way, release after release: without this a list, a null, a missing key, or a value of another type is passed, or told in other words", () => {
    const site = `${ADDRESS}/served/a1/`;
    const table: readonly (readonly [what: string, before: unknown, after: unknown, lines: string[]])[] = [
      ["a leaf of a nested object changed", { a: { b: { c: 1, d: 2 } } }, { a: { b: { c: 1, d: 3 } } }, ["it.a.b.d was 2 and is 3"]],
      ["a nested object gone whole", { a: { b: { c: 1 } }, e: 1 }, { e: 1 }, ['it.a was {"b":{"c":1}} and is undefined']],
      ["a nested object added", { e: 1 }, { e: 1, a: { b: 1 } }, []],
      ["a value of a list changed in place", { list: [1, { a: 2 }, 3] }, { list: [1, { a: 4 }, 5] }, ["it.list.1.a was 2 and is 4", "it.list.2 was 3 and is 5"]],
      ["a shorter list, its values changed too", { list: [1, 2, 3], z: 1 }, { list: [9, 8], z: 2 }, ["it.list held 3 and holds 2", "it.z was 1 and is 2"]],
      ["a longer list, its values changed too", { list: [{ a: 1 }], z: 1 }, { list: [{ a: 2 }, { a: 3 }], z: 2 }, ["it.list held 1 and holds 2", "it.z was 1 and is 2"]],
      ["a list in a list, both of another length", [[1, 2], [3]], [[1], [3], [4]], ["it held 2 and holds 3"]],
      ["a list in a list of the same length", [[1, 2], [3]], [[1], [4]], ["it.0 held 2 and holds 1", "it.1.0 was 3 and is 4"]],
      ["a list become an object", { list: [1, 2] }, { list: { 0: 1, 1: 2 } }, ["it.list held 2 and holds no list"]],
      ["a list become null", { list: [1, 2] }, { list: null }, ["it.list was [1,2] and is null"]],
      ["a list become text", { list: [1, 2] }, { list: "1,2" }, ['it.list was [1,2] and is "1,2"']],
      ["an empty list become an empty object", { list: [] }, { list: {} }, ["it.list held 0 and holds no list"]],
      ["an object become a list", { a: { x: 1, 0: "k" } }, { a: ["k"] }, ["it.a.x was 1 and is undefined"]],
      ["an empty object become a list", { a: {} }, { a: [1] }, []],
      ["an object of a list's own names become a list", JSON.parse('{"__proto__":[],"length":1,"at":2}'), [7], ["it.at was 2 and is undefined"]],
      ["null become a value", { a: null }, { a: 0 }, ["it.a was null and is 0"]],
      ["values become null", { a: 0, b: { c: 1 } }, { a: null, b: null }, ["it.a was 0 and is null", 'it.b was {"c":1} and is null']],
      ["null kept", { a: null }, { a: null }, []],
      ["null gone", { a: null }, {}, ["it.a was null and is undefined"]],
      ["undefined gone", { a: undefined }, {}, []],
      ["a value become undefined", { a: 1 }, { a: undefined }, ["it.a was 1 and is undefined"]],
      ["a value gone", { a: 1 }, {}, ["it.a was 1 and is undefined"]],
      ["undefined become a value", { a: undefined }, { a: 1 }, ["it.a was undefined and is 1"]],
      ["undefined added", {}, { a: undefined }, []],
      ["a number become text", { a: 1 }, { a: "1" }, ['it.a was 1 and is "1"']],
      ["an object become text", { a: { b: 1 } }, { a: "b" }, ['it.a was {"b":1} and is "b"']],
      ["text become an object", { a: "b" }, { a: { b: 1 } }, ['it.a was "b" and is {"b":1}']],
      ["a truth become a number", { a: true }, { a: 1 }, ["it.a was true and is 1"]],
      ["zero become minus zero", { a: 0 }, { a: -0 }, ["it.a was 0 and is 0"]],
      ["not-a-number kept", { a: Number.NaN }, { a: Number.NaN }, []],
      [
        "addresses in a list, one moved to its site's own host",
        { urls: [site, `${ADDRESS}/served/b2/`] },
        { urls: ["https://a1.example.com/", "https://c3.example.com/"] },
        ['it.urls.1 was "http://127.0.0.1:4400/served/b2/" and is "https://c3.example.com/"'],
      ],
      ["an address become an object", { url: site }, { url: { href: site } }, ['it.url was "http://127.0.0.1:4400/served/a1/" and is {"href":"http://127.0.0.1:4400/served/a1/"}']],
      ["the address of the install, moved", { server: ADDRESS }, { server: "https://poplin.example.com" }, []],
      ["a bare value changed", 1, 2, ["it was 1 and is 2"]],
      ["a bare value kept", "a", "a", []],
      ["a bare list of another length", [1], [], ["it held 1 and holds 0"]],
      ["nothing become an object", undefined, {}, ["it was undefined and is {}"]],
      ["an object become nothing", { a: 1 }, undefined, ['it was {"a":1} and is undefined']],
    ];

    expect(table.map(([what, before, after]) => [what, differences(before, after, ADDRESS, "it")])).toEqual(table.map(([what, , , lines]) => [what, lines]));
  });
});
