// The command line is typed by people and assembled by scripts and agents: the parser must refuse, never throw, and never turn a mistyped word into a request.

import { expect } from "bun:test";
import fc from "fast-check";

import { COMMANDS } from "../../packages/cli/src/commands/command-table";
import { parseCommand } from "../../packages/cli/src/commands/parse-command";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const COMMAND_NAMES: readonly string[] = COMMANDS.map((spec) => spec.name);
const FLAG_NAMES = [...new Set(COMMANDS.flatMap((spec) => spec.flags.map((flag): string => flag.name)))];
const DECLARED_KINDS = new Set([...COMMAND_NAMES, "version", "usage-error"]);
const PUBLISHED_PATH_RULE = /^[./~]|\//;
const VALUES = [
  "report--k3f9x2ab71qz",
  "k3f9x2ab71qz",
  "report",
  "docs",
  "./report",
  ".",
  "report.html",
  "on",
  "off",
  "7d",
  "never",
  "2026-12-01",
  "4",
  "versions_kept",
  "10",
  "Q3 sales",
  "",
];

const property = fuzzTarget(import.meta.file);

const flags = fc.constantFrom(...FLAG_NAMES);
const values = fc.constantFrom(...VALUES);
const joined = fc.tuple(flags, values).map(([flag, value]) => `${flag}=${value}`);
const words = fc.oneof(
  { arbitrary: fc.constantFrom(...COMMAND_NAMES), weight: 3 },
  { arbitrary: flags, weight: 4 },
  { arbitrary: values, weight: 4 },
  { arbitrary: joined, weight: 1 },
  { arbitrary: fc.constantFrom("--", "-", "-h", "--no-json", "--__proto__", "--constructor=x"), weight: 1 },
  { arbitrary: hostile(fc.constantFrom(...COMMAND_NAMES, ...FLAG_NAMES, ...VALUES)), weight: 3 },
);
const lines = fc.array(words, { maxLength: 12 });
const plainWords = hostile(fc.constantFrom(...COMMAND_NAMES, ...VALUES)).filter((word) => !word.startsWith("-"));

property(
  "any command line is answered with one of the declared kinds and nothing throws",
  fc.property(lines, (line) => {
    expect(DECLARED_KINDS.has(parseCommand(line).kind)).toBe(true);
  }),
);

property(
  "a first word that is neither a command nor a path by the published rule is refused whatever follows it, so a typo is never a publish or any other request",
  fc.property(plainWords, fc.array(fc.oneof(values, plainWords), { maxLength: 4 }), (first, rest) => {
    fc.pre(!COMMAND_NAMES.includes(first) && !PUBLISHED_PATH_RULE.test(first));

    expect(parseCommand([first, ...rest.filter((word) => !word.startsWith("-"))]).kind).toBe("usage-error");
  }),
);

property(
  "a request is only ever built from flags its command lists, so a mistyped flag is never dropped and the rest of the line run",
  fc.property(lines, (line) => {
    const parsed = parseCommand(line);
    if (parsed.kind === "usage-error" || parsed.kind === "help" || parsed.kind === "version") return;

    const end = line.indexOf("--");
    const typed = line.slice(0, end === -1 ? line.length : end).filter((word) => word.startsWith("-") && word !== "-");
    const listed: readonly string[] = COMMANDS.find((spec) => spec.name === parsed.kind)?.flags.map((flag) => flag.name) ?? [];

    expect(typed.filter((word) => !listed.includes(word.split("=")[0] ?? ""))).toEqual([]);
  }),
);
