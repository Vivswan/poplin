// Scope: the pages a person reads name only commands, flags, tools, tool inputs, refusal codes, and settings that exist, and install the skill from this repository;
// every link into the guide leads to a page and a heading of it; the guide's folders are ranked. Not the prose.

import { describe, expect, test } from "bun:test";
import { dirname, join, normalize } from "node:path";

import { COMMANDS, type CommandSpec } from "../packages/cli/src/commands/command-table";
import { SKILL_COMMAND } from "../packages/cli/src/commands/install/publish-ways";
import { SETTING_SAMPLES } from "../packages/cli/src/commands/install/install-settings";
import { parseCommand } from "../packages/cli/src/commands/line/parse-command";
import { problem } from "../packages/cli/src/commands/problems";
import { TOOLS } from "../packages/cli/src/mcp/tools";
import { PROBLEM_KINDS } from "../packages/core/src/records/problem";
import { words } from "../packages/cli/tests/commands/support/command-line";
import { INSTALL_FLAGS, INSTALL_WORDS, PROVIDER_COMMAND_NAMES, providerRefusal } from "./support/install-words";
import { readPage } from "./support/markdown-page";
import { repositoryFiles } from "./support/repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The folder of the guide, from the root. */
const GUIDE_PLACE = "docs/";

/** The pages of the guide, as paths from the root: a new page is read without being added here. */
const GUIDE_PAGES: readonly string[] = [...new Bun.Glob(`${GUIDE_PLACE}**/*.md`).scanSync({ cwd: ROOT })].sort();

/** The pages a person reads, as paths from the root. */
const PAGES: readonly string[] = ["README.md", ...GUIDE_PAGES, "packages/cli/README.md"];

/** The pages outside the guide that link into it. */
const LINKING_PAGES: readonly string[] = ["README.md", "packages/providers/cloudflare/README.md", "skills/poplin/references/setup.md"];

/** The skill's own page for a person, which gives the line that installs the skill as the pages above do. */
const SKILL_PAGE = "skills/poplin/README.md";

/** The package whose manifest names the repository it is published from. */
const PACKAGE = "packages/cli/package.json";

/** How a page that is read outside the repository writes the address of a guide page: the page on GitHub. */
const GUIDE_ON_GITHUB = "https://github.com/Vivswan/poplin/blob/main/";

/** The folders of the guide in the order a reader meets them, each with the rank its own page carries. */
const FOLDER_RANKS: readonly (readonly [folder: string, order: number])[] = [
  ["start", 1],
  ["sites", 2],
  ["dashboard", 3],
  ["upkeep", 4],
  ["fix", 5],
  ["about", 6],
];

/** The front matter of a page: the YAML between the two rules the file opens with. */
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;

/** The page that lists every tool. */
const TOOLS_PAGE = "docs/sites/agent-tools.md";

/** The page that lists every refusal. */
const REFUSALS_PAGE = "docs/fix/poplin-refuses.md";

/** The heading the tables of refusals follow on that page. */
const REFUSALS_HEADING = "When poplin refuses";

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

/** A line a command prints that opens with the product's name and a version, such as `poplin 0.1.0 is installed.`: it is no command line. */
const VERSION_LINE = /^\s*poplin \d+\.\d+\.\d+ /;

/** The prompt a line of a fenced block may open with, which is no part of what a person copies. */
const PROMPT = /^\$\s+/;

/** A word written the way tools, their inputs, codes, and settings are: lowercase words joined by underscores. */
const SNAKE_WORD = /^[a-z]+(?:_[a-z]+)+$/;

/** A span that opens with a flag: the flag is its first word. */
const FLAG = /^(--\S+)/;

/** A line that installs the skill with the skills CLI, after a prompt when one is there; the repository it names is the first group, empty when it names none. */
const SKILL_INSTALL = /^\s*(?:\$\s+)?npx\s+skills\s+add\b\s*(\S*)/;

/** The host of a repository the skills CLI takes by its owner and name alone. */
const GITHUB = "github.com";

/** A span that holds the input of a tool as JSON. */
const JSON_SPAN = /^\{.*\}$/;

/** What a table cell holds beside its codes when it holds codes alone: the commas between them. */
const BETWEEN_CODES = /^[\s,]*$/;

/** For each command that works at a provider, a line it reads, then two it refuses. */
const PROVIDER_SAMPLES: readonly (readonly string[])[] = [
  ["poplin install cloudflare --no-domain --dry-run", "poplin install cloudflare --no-such-flag", "poplin install no-such-provider"],
  ["poplin uninstall cloudflare --no-domain --dry-run", "poplin uninstall cloudflare --no-domain --yes", "poplin uninstall cloudflare --force"],
  ["poplin doctor --repair --no-domain --add-user you@example.com", "poplin doctor --repair --server https://poplin.example.com", "poplin doctor --add-user you@example.com"],
];

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

/** What a page's text holds of code. */
function pageOf(text: string): Page {
  const { spans, blocks } = readPage(text);

  return { spans, blocks: blocks.map((block) => block.text) };
}

async function parse(root: string, path: string): Promise<Page> {
  return pageOf(await read(root, path));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Every line a page writes as code: each line of its fenced blocks, and each code span. */
function codeLines(page: Pick<Page, "spans" | "blocks">): string[] {
  return [...page.blocks.flatMap((block) => block.split("\n")), ...page.spans];
}

/** The repository each line that installs the skill names: an empty word for a line that names none, and nothing for any other line. */
function skillSources(lines: readonly string[]): string[] {
  return lines.flatMap((line) => SKILL_INSTALL.exec(line)?.[1] ?? []);
}

/** The owner and the name of the repository at the address a package manifest gives, or nothing for one that is not on GitHub. */
function ownerAndName(address: string): string | undefined {
  const { hostname, pathname } = new URL(address);

  return hostname === GITHUB ? pathname.slice(1).replace(/\.git$/, "") : undefined;
}

/** The lines that install the skill and do not start as the line a finished install prints: that line, with options after it at most. Each is given whole, without its prompt. */
function notAsPrinted(lines: readonly string[]): string[] {
  const installs = lines.filter((line) => SKILL_INSTALL.test(line)).map((line) => line.trim().replace(PROMPT, ""));

  return installs.filter((line) => line !== SKILL_COMMAND && !line.startsWith(`${SKILL_COMMAND} -`));
}

/** Every command line of a page: the ones in its fenced blocks, and the ones a code span holds. */
function commandLines(page: Pick<Page, "spans" | "blocks">): string[] {
  const lines = codeLines(page).filter((line) => !VERSION_LINE.test(line));

  return unique(lines.flatMap((line) => COMMAND_LINE.exec(line)?.[1]?.replace(AFTER_COMMAND, "") ?? []));
}

/** Whether a line is the name of a command of the CLI's table and nothing else. A sentence names a command that way, and the parser would refuse some of them for an argument they lack. */
function namesCommand(line: string): boolean {
  const name = COMMAND_ALONE.exec(line)?.[1];

  return COMMANDS.some((spec: CommandSpec) => spec.name === name);
}

/** What the CLI refuses of a command line, or nothing when it reads it. The words of a command that works at a provider are read by that command's own parser. */
function refusalOf(line: string): string | undefined {
  const parsed = parseCommand(words(line), NOW);
  if (parsed.kind === "provider") return providerRefusal(parsed.command, parsed.words);

  return parsed.kind === "usage-error" ? parsed.message : undefined;
}

/** The command a line runs: a word of the CLI's table, or of a command that works at a provider, where `repair` is `doctor` with `--repair`. */
function commandOf(line: string): string {
  const parsed = parseCommand(words(line), NOW);

  return parsed.kind === "provider" ? parsed.command : parsed.kind;
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

/** The rank a folder's own page carries in its front matter; nothing for a folder with no page, or a page with no rank. */
async function folderRank(root: string, folder: string): Promise<unknown> {
  const file = Bun.file(join(root, GUIDE_PLACE, folder, "README.md"));
  if (!(await file.exists())) return undefined;

  const front: unknown = Bun.YAML.parse(FRONT_MATTER.exec(await file.text())?.[1] ?? "");

  return typeof front === "object" && front !== null && "order" in front ? front.order : undefined;
}

describe("the pages a person reads", () => {
  test("every command line in the pages is one the CLI takes: without this a renamed command or flag stays in an example a person copies", async () => {
    const refusals: string[] = [];

    let read = 0;

    for (const path of PAGES) {
      const lines = commandLines(await parse(ROOT, path));
      read += lines.length;

      for (const line of lines.filter((written) => !namesCommand(written))) {
        const refused = refusalOf(line);
        if (refused !== undefined) refusals.push(`${path}: ${line}: ${refused}`);
      }
    }

    expect(read).toBeGreaterThan(0);
    expect(refusals).toEqual([]);
    expect(["poplin new-link", "poplin no-such-command", "poplin new-link --no-such-flag"].filter(namesCommand)).toEqual(["poplin new-link"]);
    for (const lines of PROVIDER_SAMPLES) expect(lines.map(refusalOf)).toEqual([undefined, expect.any(String), expect.any(String)]);
    expect(commandLines({ spans: ["poplin list --trash", "poplin.example.com"], blocks: ["$ npx poplin ./report --site report   # new content\npoplin 0.1.0 is installed.\n"] })).toEqual([
      "poplin ./report --site report",
      "poplin list --trash",
    ]);
  });

  test("the guide runs every command of the CLI in an example, the ones that work at a provider and a repair among them: without this a new command is never shown to the person who would run it", async () => {
    const lines = (await Promise.all(GUIDE_PAGES.map((path) => parse(ROOT, path)))).flatMap(commandLines);
    const run = new Set<string>(lines.map(commandOf));
    const commands: readonly string[] = [...COMMANDS.map((spec: CommandSpec) => spec.name), ...PROVIDER_COMMAND_NAMES];

    expect(commands.filter((name) => !run.has(name))).toEqual([]);
    expect(["poplin doctor", "poplin doctor --repair --no-domain", "poplin uninstall cloudflare --dry-run"].map(commandOf)).toEqual(["doctor", "repair", "uninstall"]);
  });

  test("every flag a page names on its own is one a command takes: without this a removed flag stays in a sentence", async () => {
    const flags = new Set<string>([...COMMANDS.flatMap((spec: CommandSpec) => spec.flags.map((flag) => flag.name)), ...INSTALL_FLAGS]);
    const named = (await Promise.all(PAGES.map((path) => parse(ROOT, path)))).flatMap((page) => page.spans).flatMap((span) => FLAG.exec(span)?.[1] ?? []);

    expect(named.length).toBeGreaterThan(0);
    expect(unique(named).filter((flag) => !flags.has(flag))).toEqual([]);
  });

  test("every line that installs the skill names the repository the package is published from: without this a repository that moved leaves its old name in the line a person copies", async () => {
    const manifest: { readonly repository: { readonly url: string } } = await Bun.file(join(ROOT, PACKAGE)).json();
    const pages = await Promise.all([...PAGES, SKILL_PAGE].map((path) => parse(ROOT, path)));
    const named = skillSources(pages.flatMap(codeLines));

    expect(named.length).toBeGreaterThan(0);
    expect<readonly (string | undefined)[]>(unique(named)).toEqual([ownerAndName(manifest.repository.url)]);
    expect(skillSources(["$ npx skills  add  example-user/moved -g", "npx skills add", "npx skills list", "npx poplin ./report"])).toEqual(["example-user/moved", ""]);
    expect(["git+https://github.com/example-user/site.git", "https://notgithub.com/example-user/site.git"].map(ownerAndName)).toEqual(["example-user/site", undefined]);
  });

  test("every Markdown page that installs the skill, the skill's own among them, gives the line a finished install prints, with options after it at most: without this the command and a page start the tool two ways", async () => {
    const pages = repositoryFiles(ROOT).filter((path) => path.endsWith(".md"));
    const shown = await Promise.all(pages.map(async (path) => ({ path, lines: codeLines(await parse(ROOT, path)) })));
    const planted = [`Run \`${SKILL_COMMAND}\` or \`${SKILL_COMMAND} -g -y\`, never \`${SKILL_COMMAND}s\`.`, "<!-- `npx skills add example/hidden` -->", "```text", `$ ${SKILL_COMMAND}`, "$ npx skills add example/other", "```"].join("\n");

    expect(shown.flatMap(({ lines }) => skillSources(lines)).length).toBeGreaterThan(0);
    expect(shown.flatMap(({ path, lines }) => notAsPrinted(lines).map((line) => `${path}: ${line}`))).toEqual([]);
    // Drift: a guard that reads the raw text counts a line no reader sees, and one that reads a part of a line passes a repository whose name starts the same. The planted page is read and judged as the real ones are.
    expect(notAsPrinted(codeLines(pageOf(planted)))).toEqual(["npx skills add example/other", `${SKILL_COMMAND}s`]);
  });

  test("every word written like a tool, a code, a setting, or a kind of problem is one: without this a renamed one stays in a page", async () => {
    const inputs = Object.values(TOOLS).flatMap((tool) => Object.keys(tool.parameters));
    const known = new Set<string>([...Object.keys(TOOLS), ...inputs, ...Object.keys(SETTING_SAMPLES), ...PROBLEM_KINDS, ...INSTALL_WORDS, ...OTHER_WORDS]);
    const unknown: string[] = [];

    for (const path of PAGES) {
      const named = (await parse(ROOT, path)).spans.filter((span) => SNAKE_WORD.test(span));
      unknown.push(...unique(named).flatMap((word) => (known.has(word) || isCode(word) ? [] : `${path}: ${word}`)));
    }

    expect(unknown).toEqual([]);
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
    expect(codes.filter((code) => code !== USAGE_CODE && !isCode(code) && !INSTALL_WORDS.includes(code))).toEqual([]);
    expect(["constructor", "no_such_code"].filter(isCode)).toEqual([]);
  });

  test("every link of the guide, and every link into it, leads to a file, and its anchor to a heading of that page: without this a page moved to another folder leaves a link that opens nothing", async () => {
    const dead: string[] = [];

    for (const path of [...GUIDE_PAGES, ...LINKING_PAGES]) {
      for (const link of readPage(await read(ROOT, path)).links) dead.push(...(await deadLink(ROOT, path, link)).map((why) => `${path}: ${link}: ${why}`));
    }

    expect(dead).toEqual([]);
    expect(await deadLink(ROOT, "docs/README.md", "start/install.md#what-you-need")).toEqual([]);
    expect(await deadLink(ROOT, "docs/README.md", "start/install.md#no-such-heading")).toEqual(["no heading no-such-heading"]);
    expect(await deadLink(ROOT, "docs/start/install.md", "by-hand.md")).toEqual(["no file docs/start/by-hand.md"]);
    expect(await deadLink(ROOT, "skills/poplin/references/setup.md", `${GUIDE_ON_GITHUB}docs/install.md`)).toEqual(["no file docs/install.md"]);
    expect(await deadLink(ROOT, "docs/README.md", "https://example.com/docs/install.md")).toEqual([]);
  });

  test("every folder of the guide carries its rank, Start, Sites, Dashboard, Upkeep, Fix, About: without this a new folder lands in the sidebar by its letter, ahead of the page a reader starts on", async () => {
    const folders = unique(GUIDE_PAGES.flatMap((path) => path.slice(GUIDE_PLACE.length).split("/").slice(0, -1).slice(0, 1)));
    const ranks = await Promise.all(folders.map(async (folder) => [folder, await folderRank(ROOT, folder)] as const));

    expect(ranks.sort(([, a], [, b]) => Number(a) - Number(b))).toEqual([...FOLDER_RANKS]);
    expect(await folderRank(ROOT, "no-such-folder")).toBeUndefined();
  });
});
