import { afterEach, describe, expect, test } from "bun:test";

import { serveSite } from "../../../app/src/sites/serve";
import { ADDRESSES } from "../../../app/tests/sites/support/layout";
import type { SiteObject } from "../../../core/src/actions/sites/site-object";
import type { Login } from "../../../core/src/auth/logins";
import { defaultSettings } from "../../../core/src/records/settings";
import { columns, GAP, OLD_ADDRESS } from "../../src/commands/text";
import { type Bench, cleanUp, folderOf, jsonOf, openBench } from "./support/harness";

/** A file name of three letters that each take two cells of a terminal. */
const WIDE_NAME = "\u8cc7\u6599\u96c6.txt";

/** What the one page of the test's site holds. */
const HOME = "<title>Report</title>";

/** Each kind of change: the access the site is published with, the command (`SITE` is the site's label, `FOLDER` a folder to publish), and each old-address row with the statuses the install then answers there, a redirect's target included. */
const CHANGES: readonly (readonly [why: string, flag: string, change: string, rows: readonly (readonly [...Claim, ...statuses: number[]])[]])[] = [
  ["a rename", "--private", "set SITE --name notes", [["serves", "site", 200]]],
  ["a rename of an unlisted site", "--unlisted", "set SITE --name notes", [["serves", "site", 200]]],
  ["private to unlisted", "--private", "set SITE --unlisted", [["redirects", "site", 302, 200]]],
  ["unlisted to private", "--unlisted", "set SITE --private", [["redirects", "site", 302, 200]]],
  ["a rename with private to unlisted", "--private", "set SITE --name notes --unlisted", [["redirects", "site", 302, 200]]],
  ["unlisted to public", "--unlisted", "set SITE --public", []],
  ["another public name", "--public", "set SITE --public --public-name docs", [["revoked", "public", 404]]],
  ["public to unlisted", "--public", "set SITE --unlisted", [["revoked", "public", 404]]],
  [
    "public to private",
    "--public",
    "set SITE --private",
    [
      ["redirects", "site", 302, 200],
      ["revoked", "public", 404],
    ],
  ],
  ["a new link", "--unlisted", "new-link SITE", [["revoked", "site", 302, 404]]],
  ["a new link of a private site", "--private", "new-link SITE", [["revoked", "site", 404]]],
  ["new content", "--unlisted", "FOLDER --site SITE", []],
  ["new content under another name", "--unlisted", "FOLDER --site SITE --name notes", [["serves", "site", 200]]],
];

/** What a row says an old address does, and which of the site's two old addresses it names. */
type Claim = readonly [says: keyof typeof OLD_ADDRESS, of: keyof SiteObject["addresses"]];

/** Ask the bench's install for an address as a logged-in visitor, and for the address a redirect names. */
async function visit(bench: Bench, address: string): Promise<number[]> {
  const { database, store, clock } = bench.install;
  const serving = { database, store, settings: defaultSettings({ installer: "ada@example.com" as Login }), addresses: ADDRESSES, identify: async () => ({ ok: true }), now: () => clock.now };
  const response = await serveSite(new Request(`${address}/`), serving);
  const next = response.headers.get("Location");

  return next === null ? [response.status] : [response.status, ...(await visit(bench, next.replace(/\/$/, "")))];
}

afterEach(cleanUp);

describe("columns", () => {
  // Drift: a cell measured by its count of letters puts the next column of a row with a wide name, such as a file named in Chinese, to the right of where every other row has it.
  test("a column is as wide as the cells of a terminal its widest cell takes, so a wide name moves no column", () => {
    const lines = columns([
      [WIDE_NAME, "12 B", "text/plain"],
      ["a.txt", "3 B", "text/plain"],
      ["notes", "", ""],
    ]);

    expect(lines).toEqual([`${WIDE_NAME}  12 B  text/plain`, "a.txt       3 B   text/plain", "notes"]);
  });
});

describe("oldAddressRows", () => {
  // Drift: a row would say an old address redirects where the install serves the site there, or name no address that stopped working: the row is a promise about a link somebody holds.
  test.each(CHANGES)("after %s each old address does what its row says", async (_why, flag, change, rows) => {
    const bench = await openBench();
    const before = jsonOf(await bench.run(`${folderOf("report", { "index.html": HOME })} ${flag} --json`)).site as SiteObject;
    const ran = await bench.run(change.replace("SITE", before.label).replace("FOLDER", folderOf("second", { "index.html": HOME })));
    const said = ran.out.map((line) => line.split(GAP).flatMap((cell) => (cell.trim() === "" ? [] : [cell.trim()])));
    const words = new Map<string, string>(Object.entries(OLD_ADDRESS).map(([says, word]) => [word.apply, says]));
    const claims = said.flatMap(([done = "", ...rest]) => (words.has(done) ? [[words.get(done) ?? "", (rest.at(-1) ?? "").replace(/^from /, "")]] : []));

    expect({ code: ran.code, claims }).toEqual({ code: 0, claims: rows.map(([says, of]) => [says, before.addresses[of] ?? ""]) });
    expect(await Promise.all(claims.map(([, address = ""]) => visit(bench, address)))).toEqual(rows.map(([, , ...statuses]) => statuses));
  });

  // Drift: a dry run would say in the words of a run what an address does, as if the change were made.
  test("a dry run says what each old address would do", async () => {
    const bench = await openBench();
    const { label, addresses } = jsonOf(await bench.run(`${folderOf("report", { "index.html": HOME })} --public --json`)).site as SiteObject;

    expect((await bench.run(`set ${label} --name notes --dry-run`)).out[2]).toBe(`would still serve  ${addresses.site}`);
    expect((await bench.run(`set ${label} --private --dry-run`)).out.slice(1, 3)).toEqual([`would redirect  from ${addresses.site}`, `would revoke    ${addresses.public}`]);
  });
});
