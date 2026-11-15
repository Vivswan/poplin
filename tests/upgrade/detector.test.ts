// The upgrade check's own test. Drift: a check that finds nothing proves nothing until it is seen to find a break, and a check that finds something proves nothing until it is seen to pass where nothing broke.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fault } from "./support/command";
import { differences } from "./support/findings";
import { moduleFaults } from "./support/module-names";
import { checkOut, HERE, type Tree } from "./support/trees";
import { upgradeFindings } from "./support/upgrade";

/** A commit of main from before the first release, when the first step was still edited in place: after it `versions` and `declared_files` got columns and the settings a key, with no step of their own. */
const EDITED_IN_PLACE = "b17e7e60b511ca6e01dc2a0ada765d058c9492b9";

/** How long one upgrade may take, in milliseconds: two installs, and some eighty runs of the command. */
const UPGRADE_MS = 120_000;

/** The address the install of the hand-written answers below answered at. */
const ADDRESS = "http://127.0.0.1:4400";

/** A module with two inputs and three resources. */
const MODULE_BEFORE = 'variable "kept" {}\nvariable "gone" {}\nresource "thing" "kept" {}\nresource "thing" "renamed" {}\nresource "thing" "gone" {}\n';

/** The same module one input and one resource short, with the third resource moved to a new address. */
const MODULE_AFTER = 'variable "kept" {}\nresource "thing" "kept" {}\nresource "thing" "named" {}\nmoved {\n  from = thing.renamed\n  to   = thing.named\n}\n';

/** A tree that holds nothing but a module of one file; it is removed when the caller's scope ends. */
function moduleTree(text: string): Tree & Disposable {
  const folder = mkdtempDisposableSync(join(tmpdir(), "module-tree-"));
  mkdirSync(join(folder.path, "packages/cloudflare/tofu"), { recursive: true });
  writeFileSync(join(folder.path, "packages/cloudflare/tofu/main.tf"), text);

  return { root: folder.path, name: "a planted tree", [Symbol.dispose]: () => folder.remove() };
}

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
    using before = moduleTree(MODULE_BEFORE);
    using after = moduleTree(MODULE_AFTER);
    const answer = { sites: [{ id: "a1", url: `${ADDRESS}/served/a1/`, versions: [1, 2] }], limit: 5 };
    const refusal = (hint: string): unknown => ({ error: { code: "bad_argument", hint } });

    expect({
      module: moduleFaults(before, after),
      sameModule: moduleFaults(before, before),
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
      module: [
        "the module's input `gone` is gone: a variables file that sets it no longer plans",
        "the module's resource `thing.gone` is gone with no `moved` or `removed` block: a plan destroys it",
      ],
      sameModule: [],
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
