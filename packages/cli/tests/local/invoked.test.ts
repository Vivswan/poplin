import { describe, expect, test } from "bun:test";

import { pasted, runnerOf } from "../../src/local/invoked";

describe("runnerOf", () => {
  // Drift: npm sets `npm_command` to `exec` under npx, an external fact; a line that says `poplin login` to a person who ran `npx poplin install` names a command their shell does not have.
  test.each([
    ["under npx", { npm_command: "exec" }, "npx poplin"],
    ["installed, on the path", {}, "poplin"],
    ["inside a script npm runs", { npm_command: "run-script" }, "poplin"],
  ] as const)("%s a pasted line starts as the command was started", (_name, env, runner) => {
    expect(runnerOf(env)).toBe(runner);
  });
});

describe("pasted", () => {
  // Drift: the hints, the next steps, and the help were written with `npx` by one family of commands and without by the other; one rule at the screen keeps a new line from bringing the split back.
  test.each([
    ["a hint", "poplin list shows every site", "npx poplin list shows every site", "poplin list shows every site"],
    ["a next step", "To log in: npx poplin login --server https://poplin.example.com", "To log in: npx poplin login --server https://poplin.example.com", "To log in: poplin login --server https://poplin.example.com"],
    ["a publish in a help text", "  poplin ./report --site report", "  npx poplin ./report --site report", "  poplin ./report --site report"],
    ["a usage line", "usage: poplin <path> [flags]", "usage: npx poplin <path> [flags]", "usage: poplin <path> [flags]"],
    ["the folder a person stands in", "to publish the current folder: poplin .", "to publish the current folder: npx poplin .", "to publish the current folder: poplin ."],
    ["a word that only starts as a command does", "poplin login-history is no command", "poplin login-history is no command", "poplin login-history is no command"],
    ["the newest poplin, named on purpose", "npx poplin@latest doctor --repair", "npx poplin@latest doctor --repair", "npx poplin@latest doctor --repair"],
    ["the product's name in a sentence", "install 7.8.9, this poplin 0.0.0", "install 7.8.9, this poplin 0.0.0", "install 7.8.9, this poplin 0.0.0"],
    ["an object named after the product", "made      Access policy         poplin logins", "made      Access policy         poplin logins", "made      Access policy         poplin logins"],
  ])("%s names its command as this process was started, and nothing else changes", (_name, text, underNpx, installed) => {
    expect([pasted(text, "npx poplin"), pasted(text, "poplin")]).toEqual([underNpx, installed]);
  });

  // Drift: the install and a provider word a way on for the dashboard, where Repair and Check are buttons; a terminal has neither, so the row would name a step nobody can take there.
  test.each([
    ["To switch this on, add this permission to the account token and press Repair", "To switch this on, add this permission to the account token and run poplin doctor --repair"],
    ["A piece of the domain is missing or changed. Open Domain and press Repair.", "A piece of the domain is missing or changed. Run poplin doctor --repair."],
    ["open Domain on the dashboard and press Repair: it makes a key with the permission", "run poplin doctor --repair: it makes a key with the permission"],
    ["The last check of the install is over 30 days old. Open Domain and press Check.", "The last check of the install is over 30 days old. Run poplin doctor --repair --dry-run."],
  ])("a button of the dashboard is named as the command that does the same: %s", (text, worded) => {
    expect(pasted(text, "poplin")).toBe(worded);
  });
});
