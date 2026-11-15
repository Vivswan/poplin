// Scope: the pages a person reads name only commands, flags, tools, tool inputs, refusal codes, settings, and module inputs that exist, and every link into the guide leads to a page and a heading of it. What the prose says is out of scope.

import { describe, expect, test } from "bun:test";
import { dirname, join, normalize } from "node:path";

import { COMMANDS, type CommandSpec } from "../packages/cli/src/commands/command-table";
import { SETTING_SAMPLES } from "../packages/cli/src/commands/install-settings";
import { parseCommand } from "../packages/cli/src/commands/parse-command";
import { problem } from "../packages/cli/src/commands/problems";
import { TOOLS } from "../packages/cli/src/mcp/tools";
import { words } from "../packages/cli/tests/commands/support/command-line";
import { readPage } from "./support/markdown-page";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The folder of the guide, from the root. */
const GUIDE_PLACE = "docs/";

/** The pages of the guide, as paths from the root: a new page is read without being added here. */
const GUIDE_PAGES: readonly string[] = [...new Bun.Glob(`${GUIDE_PLACE}**/*.md`).scanSync({ cwd: ROOT })].sort();

/** The pages a person reads, as paths from the root. */
const PAGES: readonly string[] = ["README.md", ...GUIDE_PAGES, "packages/cli/README.md"];

/** The pages outside the guide that link into it. */
const LINKING_PAGES: readonly string[] = ["README.md", "packages/cloudflare/README.md", "packages/cloudflare/tofu/README.md", "skills/poplin/references/setup.md"];

/** How a page that is read outside the repository writes the address of a guide page: the page on GitHub. */
const GUIDE_ON_GITHUB = "https://github.com/Vivswan/poplin/blob/main/";

/** The page that lists every tool. */
const TOOLS_PAGE = "docs/use/agent-tools.md";

/** The page that lists every refusal. */
const REFUSALS_PAGE = "docs/use/when-poplin-refuses.md";

/** The heading the tables of refusals follow on that page. */
const REFUSALS_HEADING = "When poplin refuses";

/** The files of the OpenTofu module that declare its inputs and outputs. */
const MODULE_FILES: readonly string[] = ["packages/cloudflare/tofu/variables.tf", "packages/cloudflare/tofu/outputs.tf"];

/** The pages that name the module's inputs and outputs. On every other page a word spelled like one must be a tool, an input of a tool, a setting, or a code. */
const MODULE_PAGES: readonly string[] = ["docs/run/limits-and-cost.md", "docs/run/with-opentofu.md"];

/** The words written with an underscore that are none of the above: a folder that is never uploaded. */
const OTHER_WORDS: readonly string[] = ["node_modules"];

/** The code of a command line the CLI could not read, which it answers outside its table of problems. */
const USAGE_CODE = "usage-error";

/** A moment before every day an example names, so `--expires 2026-12-01` is read the same on any day the test runs. */
const NOW = Date.UTC(2026, 0, 1);

/** A command line of the CLI at the start of a line or a span, after a prompt and `npx` when they are there; the command is the first group. */
const COMMAND_LINE = /^\s*(?:\$ )?(?:npx )?(poplin [^\n]*)$/;

/** A command line that is a command's name and nothing else, the way a sentence names a command; the name is the first group. */
const COMMAND_ALONE = /^poplin ([a-z-]+)$/;

/** What ends a command on its line: a comment, or an arrow to what it does. */
const AFTER_COMMAND = /\s+(?:#|->)\s.*$/;

/** A word written the way tools, codes, settings, and inputs are: lowercase words joined by underscores. */
const SNAKE_WORD = /^[a-z]+(?:_[a-z]+)+$/;

/** A span that opens with a flag: the flag is its first word. */
const FLAG = /^(--\S+)/;

/** A span that holds the input of a tool as JSON. */
const JSON_SPAN = /^\{.*\}$/;

/** The module block of an HCL example, with its body as the first group. */
const MODULE_BLOCK = /module "poplin" \{\n([\s\S]*?)\n\s*\}/;

/** A value set in that block, with its name as the first group. */
const MODULE_VALUE = /^\s*([a-z_]+)\s*=/gm;

/** What a module block sets that is no input of the module. */
const MODULE_SOURCE = "source";

/** What a table cell holds beside its codes when it holds codes alone: the commas between them. */
const BETWEEN_CODES = /^[\s,]*$/;

/** An input or an output of the module, with its name as the first group. */
const MODULE_NAME = /^(?:variable|output) "([a-z_]+)"/gm;

/** An input of the module, with its name as the first group. */
const MODULE_INPUT = /^variable "([a-z_]+)"/gm;

/** A code of the CLI's table of problems. */
type Code = Parameters<typeof problem>[0];

/** What a page holds of code, as Bun's Markdown parser reads it. */
interface Page {
  /** The text of every code span, table cells included. */
  readonly spans: readonly string[];

  /** The text of every fenced block. */
  readonly blocks: readonly string[];
}

async function read(root: string, path: string): Promise<string> {
  return Bun.file(join(root, path)).text();
}

async function parse(root: string, path: string): Promise<Page> {
  const { spans, blocks } = readPage(await read(root, path));

  return { spans, blocks: blocks.map((block) => block.text) };
}

function groups(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? "");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Every command line of a page: the ones in its fenced blocks, and the ones a code span holds. */
function commandLines(page: Pick<Page, "spans" | "blocks">): string[] {
  const fenced = page.blocks.flatMap((block) => block.split("\n"));

  return unique([...fenced, ...page.spans].flatMap((line) => COMMAND_LINE.exec(line)?.[1]?.replace(AFTER_COMMAND, "") ?? []));
}

/** Whether a line is the name of a command of the CLI's table and nothing else. A sentence names a command that way, and the parser would refuse some of them for an argument they lack. */
function namesCommand(line: string): boolean {
  const name = COMMAND_ALONE.exec(line)?.[1];

  return COMMANDS.some((spec: CommandSpec) => spec.name === name);
}

/** Whether the CLI's table holds the code: the table is not exported, and a code it lacks has no sentence, or throws. */
function isCode(word: string): boolean {
  try {
    return typeof problem(word as Code).message === "string";
  } catch {
    return false;
  }
}

/** The file a link of a page leads to, as a path from the root, with its anchor; nothing for a link that leaves the repository. */
function linkTarget(path: string, link: string): { file: string; anchor: string } | undefined {
  const [place = "", anchor = ""] = link.split("#");
  if (place.startsWith(GUIDE_ON_GITHUB)) return { file: place.slice(GUIDE_ON_GITHUB.length), anchor };
  if (/^[a-z]+:/.test(place)) return undefined;

  return { file: place === "" ? path : normalize(join(dirname(path), place)), anchor };
}

/** Why a link of a page leads nowhere: its file is missing, or the page it names has no such heading. Empty for a link that leads somewhere. */
async function deadLink(root: string, path: string, link: string): Promise<string[]> {
  const target = linkTarget(path, link);
  if (target === undefined) return [];

  const file = Bun.file(join(root, target.file));
  if (!(await file.exists())) return [`no file ${target.file}`];
  if (target.anchor === "" || !target.file.endsWith(".md")) return [];

  return readPage(await file.text()).headings.some((heading) => heading.anchor === target.anchor) ? [] : [`no heading ${target.anchor}`];
}

/** The inputs a tool's example passes that the tool does not take. */
function unknownInputs(tool: string, example: string): string[] {
  const taken: readonly string[] = Object.hasOwn(TOOLS, tool) ? Object.keys(TOOLS[tool as keyof typeof TOOLS].parameters) : [];

  return Object.keys(JSON.parse(example)).filter((input) => !taken.includes(input));
}

describe("the pages a person reads", () => {
  test("every command line in the pages is one the CLI takes: without this a renamed command or flag stays in an example a person copies", async () => {
    const refusals: string[] = [];

    let read = 0;

    for (const path of PAGES) {
      const lines = commandLines(await parse(ROOT, path));
      read += lines.length;

      for (const line of lines.filter((written) => !namesCommand(written))) {
        const parsed = parseCommand(words(line), NOW);
        if (parsed.kind === "usage-error") refusals.push(`${path}: ${line}: ${parsed.message}`);
      }
    }

    expect(read).toBeGreaterThan(0);
    expect(refusals).toEqual([]);
    expect(["poplin new-link", "poplin no-such-command", "poplin new-link --no-such-flag"].filter(namesCommand)).toEqual(["poplin new-link"]);
    expect(commandLines({ spans: ["poplin list --trash", "poplin.example.com"], blocks: ["$ npx poplin ./report --site report   # new content\n"] })).toEqual([
      "poplin ./report --site report",
      "poplin list --trash",
    ]);
  });

  test("the guide runs every command of the CLI in an example: without this a new command is never shown to the person who would run it", async () => {
    const lines = (await Promise.all(GUIDE_PAGES.map((path) => parse(ROOT, path)))).flatMap(commandLines);
    const run = new Set<string>(lines.map((line) => parseCommand(words(line), NOW).kind));

    expect(COMMANDS.map((spec: CommandSpec) => spec.name).filter((name) => !run.has(name))).toEqual([]);
  });

  test("every flag a page names on its own is one a command takes: without this a removed flag stays in a sentence", async () => {
    const flags = new Set<string>(COMMANDS.flatMap((spec: CommandSpec) => spec.flags.map((flag) => flag.name)));
    const named = (await Promise.all(PAGES.map((path) => parse(ROOT, path)))).flatMap((page) => page.spans).flatMap((span) => FLAG.exec(span)?.[1] ?? []);

    expect(named.length).toBeGreaterThan(0);
    expect(unique(named).filter((flag) => !flags.has(flag))).toEqual([]);
  });

  test("every word written like a tool, a code, a setting, or a module input is one: without this a renamed one stays in a page", async () => {
    const module = (await Promise.all(MODULE_FILES.map((path) => read(ROOT, path)))).flatMap((text) => groups(text, MODULE_NAME));
    const inputs = Object.values(TOOLS).flatMap((tool) => Object.keys(tool.parameters));
    const known = [...Object.keys(TOOLS), ...inputs, ...Object.keys(SETTING_SAMPLES), ...OTHER_WORDS];
    const unknown: string[] = [];

    for (const path of PAGES) {
      const here = new Set<string>(MODULE_PAGES.includes(path) ? [...known, ...module] : known);
      const named = (await parse(ROOT, path)).spans.filter((span) => SNAKE_WORD.test(span));
      unknown.push(...unique(named).flatMap((word) => (here.has(word) || isCode(word) ? [] : `${path}: ${word}`)));
    }

    expect(module.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  test("every value an example gives the module is an input the module declares: without this a removed input stays in the file a person copies", async () => {
    const inputs = (await Promise.all(MODULE_FILES.map((path) => read(ROOT, path)))).flatMap((text) => groups(text, MODULE_INPUT));
    const blocks = (await Promise.all(PAGES.map((path) => parse(ROOT, path)))).flatMap((page) => page.blocks);
    const set = blocks.flatMap((block) => groups(MODULE_BLOCK.exec(block)?.[1] ?? "", MODULE_VALUE)).filter((name) => name !== MODULE_SOURCE);

    expect(set.length).toBeGreaterThan(0);
    expect(unique(set).filter((name) => !inputs.includes(name))).toEqual([]);
  });

  test("the page of the agent tools names every tool, and each example passes only inputs its tool takes: without this a new tool is never shown, and a renamed input stays in an example", async () => {
    const { spans } = await parse(ROOT, TOOLS_PAGE);
    const examples = spans.flatMap((span, at) => (JSON_SPAN.test(span) ? [{ tool: spans[at - 1] ?? "", input: span }] : []));

    expect(Object.keys(TOOLS).filter((tool) => !spans.includes(tool))).toEqual([]);
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.flatMap(({ tool, input }) => unknownInputs(tool, input).map((unknown) => `${tool}: ${unknown}`))).toEqual([]);
    expect(unknownInputs("get_site", '{ "site": "report", "path": "./report" }')).toEqual(["path"]);
  });

  test("every code in the tables of refusals is one the CLI answers with: without this a renamed code stays in the table a person looks a refusal up in", async () => {
    const { headings, rows } = readPage(await read(ROOT, REFUSALS_PAGE));
    const above = 1 + headings.findIndex((heading) => heading.text === REFUSALS_HEADING);
    const cells = rows.flatMap((row) => (above > 0 && row.below >= above ? (row.cells[0] ?? []) : []));
    const codes = cells.flatMap((cell) => (BETWEEN_CODES.test(cell.rest) ? cell.spans : []));

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => code !== USAGE_CODE && !isCode(code))).toEqual([]);
    expect(["constructor", "no_such_code"].filter(isCode)).toEqual([]);
  });

  test("every link of the guide, and every link into it, leads to a file, and its anchor to a heading of that page: without this a page moved to another folder leaves a link that opens nothing", async () => {
    const dead: string[] = [];

    for (const path of [...GUIDE_PAGES, ...LINKING_PAGES]) {
      for (const link of readPage(await read(ROOT, path)).links) dead.push(...(await deadLink(ROOT, path, link)).map((why) => `${path}: ${link}: ${why}`));
    }

    expect(dead).toEqual([]);
    expect(await deadLink(ROOT, "docs/README.md", "start/by-hand.md#the-steps")).toEqual([]);
    expect(await deadLink(ROOT, "docs/README.md", "start/by-hand.md#no-such-heading")).toEqual(["no heading no-such-heading"]);
    expect(await deadLink(ROOT, "docs/start/by-hand.md", "install.md")).toEqual(["no file docs/start/install.md"]);
    expect(await deadLink(ROOT, "skills/poplin/references/setup.md", `${GUIDE_ON_GITHUB}docs/install.md`)).toEqual(["no file docs/install.md"]);
    expect(await deadLink(ROOT, "docs/README.md", "https://example.com/docs/install.md")).toEqual([]);
  });
});
