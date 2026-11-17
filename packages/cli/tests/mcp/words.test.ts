import { describe, expect, test } from "bun:test";

import { problem } from "../../src/commands/problems";
import { toolWords } from "../../src/mcp/words";

/** A command of the CLI that a tool stands for, as a hint would still name it had no pattern matched. */
const COMMAND_LEFT = /poplin (?:set|list|show|restore|duplicate)\b|--public-name/;

describe("toolWords", () => {
  // Drift: a hint is reworded in the problem table, its pattern here no longer matches, and an agent with no shell is told to type a command.
  test.each([
    ["name_taken", "Fix: update_site with access public and another public_name"],
    ["reserved_name", "Fix: use another public_name"],
    ["too_many_sites", "See: poplin config max_sites and list_sites with trash true (trashed sites count)"],
    ["not_found", "See: list_sites"],
    ["no_such_version", "See: get_site"],
    ["id_taken", "See: get_site"],
    ["in_trash", "Fix: restore_site"],
    ["copy_gone", "Fix: if list_sites lacks the site, run duplicate_site again"],
  ] as const)("the hint of %s names the tool in place of the command", (code, worded) => {
    const said = toolWords(problem(code).hint ?? "");

    expect([said, COMMAND_LEFT.test(said)]).toEqual([worded, false]);
  });

  test("a command no tool stands for stays, for the person at the machine", () => {
    expect(toolWords(problem("no_login").hint ?? "")).toBe("Fix: poplin login --server <url>");
  });
});
