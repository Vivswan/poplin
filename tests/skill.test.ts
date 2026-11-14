// Scope: the pages an agent reads under `skills/poplin/` name only tools, refusal codes, commands, and flags that exist, and the skill's own files agree with each other. What the prose says is out of scope.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { COMMANDS, type CommandSpec } from "../packages/cli/src/commands/command-table";
import { parseCommand } from "../packages/cli/src/commands/parse-command";
import { problem } from "../packages/cli/src/commands/problems";
import { words } from "../packages/cli/tests/commands/support/command-line";
import { TOOL_INPUTS } from "../packages/core/src/actions/tool-inputs";
import { plantedRepository, repositoryFiles } from "./support/repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The folder the skill sits in, as the start of the path of a file in it. */
const SKILL_PLACE = "skills/poplin/";

/** A page, by the ending of its name. */
const PAGE_ENDING = ".md";

/** The MCP tools, as the server lists them. */
const TOOLS: readonly string[] = Object.keys(TOOL_INPUTS);

/** The day the pages' command lines are read on: before every date they give `--expires`, whatever day the test runs. */
const READ_ON = Date.UTC(2026, 0, 1);

/** Every input a tool takes, as its schema names it. */
const INPUTS: readonly string[] = Object.values(TOOL_INPUTS).flatMap((input) => Object.keys(input.entries));

/** The words in code font that are no tool, input, or code: what an answer and `whoami` name, the three values of `access`, the two words of the server's entry, and a folder that is never uploaded. */
const OTHER_WORDS: readonly string[] = ["url", "code", "install", "role", "token", "expires", "private", "unlisted", "public", "poplin", "npx", "node_modules"];

/** One lowercase word, or several joined by underscores: the way tools, their inputs, and refusal codes are written. */
const WORD = /^[a-z]+(?:_[a-z]+)*$/;

/** The page that holds the table of refusals. */
const REFUSALS_PAGE = "references/refusals.md";

/** The first cell of a row of that table: one code span, or several with commas between. */
const CODE_CELL = /^\| *(`[a-z_]+`(?:, *`[a-z_]+`)*) *\|/gm;

/** One code span of such a cell. */
const CODE_SPAN = /`([a-z_]+)`/g;

/** A command line of the CLI as the pages write it, from `poplin` up to the end of its line, its code span, or its table cell. */
const COMMAND_LINE = /npx (poplin [^`|\n]*)/g;

/** A flag, wherever it is written. A site's label holds two dashes too, after a letter. */
const FLAG = /(?<![\w-])--[a-z][a-z-]*/g;

/** The JSON a file-configured agent is given, in its fenced block. */
const JSON_BLOCK = /```json\n([\s\S]*?)\n```/;

/** The frontmatter of a skill: the YAML between the two rules the file opens with. */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/** A link to anything under `references/`, as the main page and the README write it. */
const REFERENCE_LINK = /\]\((references\/[^)\s]*)\)/g;

/** The first heading of a page. */
const TITLE = /^# (.+)$/m;

/** A code of the CLI's table of problems. */
type Code = Parameters<typeof problem>[0];

/** The entry a file-configured agent starts the MCP server from. */
interface ServerEntry {
  readonly mcpServers?: Readonly<Record<string, { readonly command?: string; readonly args?: readonly string[] }>>;
}

/** What the two Codex files say of how the skill is shown. */
interface Shown {
  readonly interface?: Readonly<Record<string, unknown>>;
}

async function read(root: string, name: string): Promise<string> {
  return Bun.file(join(root, SKILL_PLACE, name)).text();
}

/** Every page of a repository's skill, as a path from the skill's folder. */
function pagesOf(root: string): string[] {
  const pages = repositoryFiles(root).filter((path) => path.startsWith(SKILL_PLACE) && path.endsWith(PAGE_ENDING));

  return pages.map((path) => path.slice(SKILL_PLACE.length));
}

/** The text of every page of a repository's skill. */
async function readAll(root: string): Promise<string[]> {
  return Promise.all(pagesOf(root).map((page) => read(root, page)));
}

/** The text of every code span of a page, as Bun's Markdown parser reads it: table cells included, fenced blocks left out. */
function codeSpans(text: string): string[] {
  const spans: string[] = [];

  Bun.markdown.render(
    text,
    {
      codespan: (span) => {
        spans.push(span);

        return "";
      },
    },
    { tables: true },
  );

  return spans;
}

function matches(text: string, pattern: RegExp, group = 0): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[group] ?? ""))].sort();
}

/** The pages a repository's skill holds under `references/`, and the ones its main page links. */
async function references(root: string): Promise<{ held: string[]; linked: string[] }> {
  return { held: pagesOf(root).filter((page) => page.startsWith("references/")), linked: matches(await read(root, "SKILL.md"), REFERENCE_LINK, 1) };
}

/** Whether the CLI's table holds the code: the table is not exported, and a code it lacks has no sentence, or throws. */
function isCode(word: string): boolean {
  try {
    return typeof problem(word as Code).message === "string";
  } catch {
    return false;
  }
}

/** What the CLI's parser refuses of a command line that starts with `poplin`, or nothing when it reads it. */
function refusalOf(line: string): string | undefined {
  const parsed = parseCommand(words(line), READ_ON);

  return parsed.kind === "usage-error" ? `${line.trim()}: ${parsed.message}` : undefined;
}

describe("the agent skill", () => {
  test("the frontmatter names the skill and says when to use it: an agent's loader reads those two keys, and without them it skips the file or never picks it", async () => {
    const frontmatter: unknown = Bun.YAML.parse(FRONTMATTER.exec(await read(ROOT, "SKILL.md"))?.[1] ?? "");

    expect(frontmatter).toEqual({ name: "poplin", description: expect.stringMatching(/^Use when /) });
  });

  test("the pages cover every tool, and every other word in code font is an input of a tool or a code: without this a renamed tool or input, of one word or several, stays in a page an agent follows", async () => {
    const words = (await readAll(ROOT)).flatMap(codeSpans).filter((span) => WORD.test(span));
    const named = [...new Set(words)].filter((word) => !OTHER_WORDS.includes(word) && !INPUTS.includes(word) && !isCode(word));

    expect(named.sort()).toEqual([...TOOLS].sort());
  });

  test("every code in the table of refusals is one the CLI answers with: without this a renamed code, of one word or several, stays in the table an agent looks a refusal up in", async () => {
    const codes = matches(await read(ROOT, REFUSALS_PAGE), CODE_CELL, 1).flatMap((cell) => matches(cell, CODE_SPAN, 1));

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => !isCode(code))).toEqual([]);
    expect(["constructor", "no_such_code"].filter(isCode)).toEqual([]);
  });

  test("every command and flag in the pages is one the CLI takes: without this a renamed command or flag stays in a page an agent runs", async () => {
    const text = (await readAll(ROOT)).join("\n");
    const lines = matches(text, COMMAND_LINE, 1);
    const flags = new Set<string>(COMMANDS.flatMap((spec: CommandSpec) => spec.flags.map((flag) => flag.name)));

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map(refusalOf).filter((refusal) => refusal !== undefined)).toEqual([]);
    expect(matches(text, FLAG).filter((flag) => !flags.has(flag))).toEqual([]);
  });

  test("the JSON entry for a file-configured agent starts the CLI's MCP server: without this the entry runs a command the CLI refuses, and the server exits at once", async () => {
    const entry: ServerEntry = JSON.parse(JSON_BLOCK.exec(await read(ROOT, "references/mcp-server.md"))?.[1] ?? "{}");
    const { command, args = [] } = entry.mcpServers?.poplin ?? {};

    expect([command, args[0]]).toEqual(["npx", "poplin"]);
    expect(parseCommand(args.slice(1), READ_ON).kind).toBe("mcp");
  });

  test("the main page links every page under references/, and every such link leads to a page: without this a sub-page is never opened, or a link sends an agent nowhere", async () => {
    const { held, linked } = await references(ROOT);

    expect(held.length).toBeGreaterThan(0);
    expect(linked).toEqual(held);
    expect(matches(await read(ROOT, "README.md"), REFERENCE_LINK, 1).filter((link) => !held.includes(link))).toEqual([]);
  });

  // Drift: a guard that lists the disk reads what is no part of the repository, and fails in the one checkout that holds it.
  test("a new page not yet added counts as a page of the skill, and a page the repository is told to leave out or one in a build folder does not", async () => {
    using tree = plantedRepository(
      {
        "skills/poplin/SKILL.md": "# Poplin\n\nRead [the setup](references/setup.md).\n",
        "skills/poplin/references/setup.md": "# Setup\n",
        "skills/poplin/references/added.md": "# Added\n",
        "skills/poplin/references/scratch.md": "# Scratch\n",
        "skills/poplin/references/built/page.md": "# Built\n",
      },
      { excluded: ["scratch.md"], ignored: ["built/"] },
    );

    expect(await references(tree.path)).toEqual({ held: ["references/added.md", "references/setup.md"], linked: ["references/setup.md"] });
    expect(await readAll(tree.path)).toEqual(["# Poplin\n\nRead [the setup](references/setup.md).\n", "# Added\n", "# Setup\n"]);
  });

  test("the two Codex files show the skill under one name, one line, and one colour, the main page's title: without this Codex lists the skill under two faces", async () => {
    const sidecar: Shown = Bun.YAML.parse(await read(ROOT, "agents/openai.yaml")) as Shown;
    const manifest: Shown = await Bun.file(join(ROOT, SKILL_PLACE, ".codex-plugin", "plugin.json")).json();
    const title = TITLE.exec(await read(ROOT, "SKILL.md"))?.[1];

    expect([sidecar.interface?.display_name, sidecar.interface?.short_description, sidecar.interface?.brand_color]).toEqual([
      title,
      manifest.interface?.shortDescription,
      manifest.interface?.brandColor,
    ]);
    expect(manifest.interface?.displayName).toBe(title);
  });
});
