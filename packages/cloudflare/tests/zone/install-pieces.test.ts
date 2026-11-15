// The list of an install's objects against the OpenTofu module's own files.
// Without this the setup page could gain an object the module never declares, or the module one that no row of the list accounts for, and the two ways of installing would drift apart unnoticed.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INSTALL_PIECES } from "../../src/zone/install-pieces";

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
