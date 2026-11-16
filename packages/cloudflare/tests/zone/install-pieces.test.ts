// The list of an install's objects against the OpenTofu module's own files.
// Without this the setup page could gain an object the module never declares, or the module one that no row of the list accounts for, and the two ways of installing would drift apart unnoticed.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INSTALL_PIECES } from "../../src/zone/install-pieces";

/** The folder of the OpenTofu module. */
const MODULE = join(import.meta.dir, "..", "..", "tofu");

/** The first line of a block that declares a resource or reads one: its kind, its type, and its name. */
const BLOCK = /^(resource|data) "([a-z0-9_]+)" "([a-z0-9_]+)" \{$/gm;

/** Every address the module's files declare, sorted. */
function declared(): string[] {
  const files = readdirSync(MODULE).filter((name) => name.endsWith(".tf"));
  const blocks = files.flatMap((name) => [...readFileSync(join(MODULE, name), "utf8").matchAll(BLOCK)]);

  return blocks.map(([, kind, type, name]) => (kind === "data" ? `data.${type}.${name}` : `${type}.${name}`)).sort();
}

/** Every address the list names, each once, sorted. */
function listed(): string[] {
  const addresses = Object.values(INSTALL_PIECES).flatMap((pieces) => Object.values<readonly string[]>(pieces).flat());

  return [...new Set(addresses)].sort();
}

test("the module declares every object of the list and no other: a piece added to one way of installing must be decided for the other", () => {
  expect(declared().length).toBeGreaterThan(0);
  expect(declared()).toEqual(listed());
});

// Drift: a piece of both ways with its addresses forgotten would pass the list above as one the module need not declare.
// The module makes an install with a domain alone, so an object of an install without one has no address either, and the module's page has no row for it.
test("only an object the repair alone makes, or one of an install without a domain, has no address in the module, and the module's page says of each the repair makes alone that the module does not make it", () => {
  const bare = Object.entries(INSTALL_PIECES).flatMap(([who, pieces]) => Object.entries<readonly string[]>(pieces).flatMap(([piece, addresses]) => (addresses.length === 0 ? [[who, piece]] : [])));
  const page = readFileSync(join(MODULE, "README.md"), "utf8");
  const alone = Object.keys(INSTALL_PIECES.repairAlone).map((piece) => ["repairAlone", piece]);

  expect(bare).toEqual([...alone, ...Object.keys(INSTALL_PIECES.noDomain).map((piece) => ["noDomain", piece])]);
  expect(alone.filter(([, piece]) => !new RegExp(`^\\| ${piece} \\| Repair, with the right [^|]+ \\| not made: `, "m").test(page))).toEqual([]);
});
