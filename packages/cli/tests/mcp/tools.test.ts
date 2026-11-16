import { describe, expect, test } from "bun:test";

import { SITE_ACTIONS } from "../../../core/src/actions";
import { TOOL_INPUTS } from "../../../core/src/actions/tool-inputs";
import { COMMANDS, type CommandSpec } from "../../src/commands/command-table";
import { TOOLS } from "../../src/mcp/tools";

/** The commands with no tool, each with the reason. */
const CLI_ONLY_COMMANDS: Readonly<Record<string, string>> = {
  login: "a person authorizes a machine; an agent is handed the login",
  logout: "a person forgets a machine's token",
  whoami: "about the login, not about a site",
  config: "the install's settings are an admin's to change",
  doctor: "a report on the install, for the person who runs it",
  update: "a new version of the install is the admin's to start; no agent replaces the code it runs on",
  export: "a backup of the install, for the person who runs it",
  import: "a backup put back, by the person who runs the install",
  mcp: "it is the server the tools are called through",
  help: "a tool is explained by its listing",
};

/** The flags with no tool argument, each with the reason. */
const CLI_ONLY_FLAGS: Readonly<Record<string, string>> = {
  "--json": "a tool always answers the structured object",
  "--server": "the server calls the one install its login is for",
  "--help": "a tool is explained by its listing",
  "--version": "the server names its version when it connects",
  "--dry-run": "a listing for a person to read before a publish; a tool call publishes",
};

/** The words of a command each tool argument stands for: an argument by its name, a flag with its dashes. */
const CLI_WORDS: Readonly<Record<string, readonly string[]>> = {
  path: ["path"],
  site: ["site", "--site"],
  name: ["--name"],
  public_name: ["--public-name"],
  access: ["--private", "--unlisted", "--public"],
  title: ["--title"],
  search_engines: ["--search-engines"],
  embeddable: ["--embeddable"],
  expires: ["--expires"],
  version: ["--to"],
  no_trash: ["--no-trash"],
  trash: ["--trash"],
};

/** The command table, read as plain specs. */
const SPECS: readonly CommandSpec[] = COMMANDS;

function wordsOf(command: string): string[] {
  const spec = SPECS.find((one) => one.name === command);
  const words = [...(spec?.arguments ?? []), ...(spec?.flags ?? [])].map((word) => word.name);

  return words.filter((word) => !Object.hasOwn(CLI_ONLY_FLAGS, word));
}

describe("the MCP tools", () => {
  test("every command about a site has its tool and every tool its command: an action reachable from one face alone is a rule the other face lacks", () => {
    const siteCommands = SPECS.map((spec) => spec.name).filter((name) => !Object.hasOwn(CLI_ONLY_COMMANDS, name));

    expect(siteCommands.sort()).toEqual(SITE_ACTIONS.map((one) => one.action).sort());
    expect(Object.keys(TOOLS).sort()).toEqual(SITE_ACTIONS.map((one) => one.tool).sort());
  });

  test.each(SITE_ACTIONS.map((one) => [one.action, one.tool] as const))(
    "poplin %s and %s take the same things: a flag without an argument, or an argument without a flag, is a setting one face cannot reach",
    (action, tool) => {
      const words = wordsOf(action);
      const properties = Object.keys(TOOL_INPUTS[tool].entries);
      const reachable = properties.flatMap((property) => CLI_WORDS[property] ?? []);

      expect({
        "words no argument stands for": words.filter((word) => !reachable.includes(word)),
        "arguments no word stands for": properties.filter((property) => !(CLI_WORDS[property] ?? []).some((word) => words.includes(word))),
      }).toEqual({ "words no argument stands for": [], "arguments no word stands for": [] });
    },
  );
});
