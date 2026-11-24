// Scope: the pages an agent reads under `skills/poplin/` name only tools, refusal codes, commands, and flags that exist, and the skill's own files agree with each other.
// The plugin and the add-on under `skills/poplin-mcp/` start the MCP server one way, ship the skill, and follow the package. What the prose says is out of scope.

import { describe, expect, test } from "bun:test";
import { join, posix } from "node:path";

import { COMMANDS, type CommandSpec } from "../packages/cli/src/commands/command-table";
import { parseCommand } from "../packages/cli/src/commands/line/parse-command";
import { problem } from "../packages/cli/src/commands/problems";
import { words } from "../packages/cli/tests/commands/support/command-line";
import { TOOL_INPUTS } from "../packages/core/src/actions/tool-inputs";
import { INSTALL_FLAGS, INSTALL_WORDS, providerRefusal } from "./support/install-words";
import { type Page, readPage } from "./support/markdown-page";
import { plantedRepository, repositoryFiles } from "./support/repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The folder the skill sits in, as the start of the path of a file in it. */
const SKILL_PLACE = "skills/poplin/";

/** The folder of the add-on that starts the MCP server in Claude Code, written the same way. */
const ADD_ON_PLACE = "skills/poplin-mcp/";

/** The file the add-on and the plugin both start the server from. */
const SERVER_FILE = `${ADD_ON_PLACE}.mcp.json`;

/** The file that lists the plugin. */
const MARKETPLACE = ".claude-plugin/marketplace.json";

/** How Claude Code has that file open every path it writes: it reads no other path as one inside the plugin. */
const FROM_ITS_FOLDER = "./";

/** The manifest of the package the server is started from. */
const PACKAGE = "packages/cli/package.json";

/** A page, by the ending of its name. */
const PAGE_ENDING = ".md";

/** The MCP tools, as the server lists them. */
const TOOLS: readonly string[] = Object.keys(TOOL_INPUTS);

/** The day the pages' command lines are read on: before every date they give `--expires`, whatever day the test runs. */
const READ_ON = Date.UTC(2026, 0, 1);

/** Every input a tool takes, as its schema names it. */
const INPUTS: readonly string[] = Object.values(TOOL_INPUTS).flatMap((input) => Object.keys(input.entries));

/** The words in code font that are no tool, input, or code: what an answer and `whoami` name, the three values of `access`, the two words of the server's entry, a folder that is never uploaded, and the keys of the value an install and a repair print. */
const OTHER_WORDS: readonly string[] = ["url", "code", "install", "role", "token", "expires", "private", "unlisted", "public", "poplin", "npx", "node_modules", "ok", "ready", "answers", "address", "found", "steps", "problem", "changes", "next", "command"];

/** One lowercase word, or several joined by underscores: the way tools, their inputs, and refusal codes are written. */
const WORD = /^[a-z]+(?:_[a-z]+)*$/;

/** The page that holds the table of refusals. */
const REFUSALS_PAGE = "references/refusals.md";

/** What a cell of that table holds beside its codes when it holds codes alone: the commas between them. */
const BETWEEN_CODES = /^[\s,]*$/;

/** A command line of the CLI as the pages write it, from `poplin` up to the end of its line, its code span, a pipe, or the JSON string that holds it. */
const COMMAND_LINE = /npx (poplin [^`|\n"]*)/g;

/** A flag, wherever it is written. A site's label holds two dashes too, after a letter. */
const FLAG = /(?<![\w-])--[a-z][a-z-]*/g;

/** The language of the fenced block that holds the JSON a file-configured agent is given. */
const JSON_BLOCK = "json";

/** The frontmatter of a skill: the YAML between the two rules the file opens with. */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/** How a sentence of a description opens when it names the requests that load its skill. */
const TRIGGER = /^Use when /;

/** The space between two sentences of a description. */
const BETWEEN_SENTENCES = /(?<=\.)\s+/;

/** The folder of the skill's sub-pages, as the start of a link to one. */
const REFERENCES = "references/";

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

/** What the frontmatter of a skill's main page holds, by its keys. */
type Frontmatter = Readonly<Record<string, unknown>>;

/** What the package's manifest says of the package. */
interface Package {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly homepage: string;
  readonly license: string;
  readonly repository: { readonly url: string };
  readonly bin: Readonly<Record<string, string>>;
}

/** The plugin, as the marketplace file lists it: its paths are counted from `source`. */
interface Listed {
  readonly source: string;
  readonly version: string;
  readonly description: string;
  readonly homepage: string;
  readonly license: string;
  readonly repository: string;
  readonly skills: readonly string[];
  readonly mcpServers: string;
}

/** What the add-on's own manifest says of it. */
interface AddOn {
  readonly version: string;
  readonly mcpServers?: unknown;
}

async function read(root: string, name: string): Promise<string> {
  return Bun.file(join(root, SKILL_PLACE, name)).text();
}

/** What the frontmatter of a skill's main page holds, read as YAML. It throws on text that is no YAML, which the skills CLI passes over with its skill. */
function frontmatterOf(page: string): Frontmatter {
  return Bun.YAML.parse(FRONTMATTER.exec(page)?.[1] ?? "") as Frontmatter;
}

/** The sentences of a skill's description, or none where its frontmatter gives no text for one. */
function sentences({ description }: Frontmatter): string[] {
  return typeof description === "string" ? description.split(BETWEEN_SENTENCES) : [];
}

/** Every page of a repository's skill, as a path from the skill's folder. */
function pagesOf(root: string): string[] {
  const pages = repositoryFiles(root).filter((path) => path.startsWith(SKILL_PLACE) && path.endsWith(PAGE_ENDING));

  return pages.map((path) => path.slice(SKILL_PLACE.length));
}

/** Every page of a repository's skill, as Bun's Markdown parser reads it. */
async function readAll(root: string): Promise<Page[]> {
  return Promise.all(pagesOf(root).map(async (page) => readPage(await read(root, page))));
}

function matches(text: string, pattern: RegExp, group = 0): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[group] ?? ""))].sort();
}

/** The sub-pages a page of the skill links, as paths from the skill's folder. */
async function linkedReferences(root: string, name: string): Promise<string[]> {
  const { links } = readPage(await read(root, name));

  return [...new Set(links.map((link) => posix.normalize(link)).filter((link) => link.startsWith(REFERENCES)))].sort();
}

/** The pages a repository's skill holds under `references/`, and the ones its main page links. */
async function references(root: string): Promise<{ held: string[]; linked: string[] }> {
  return { held: pagesOf(root).filter((page) => page.startsWith(REFERENCES)), linked: await linkedReferences(root, "SKILL.md") };
}

/** Every code the first cells of a repository's table of refusals hold. */
async function refusalCodes(root: string): Promise<string[]> {
  const { rows } = readPage(await read(root, REFUSALS_PAGE));

  return rows.flatMap(({ cells: [first] }) => (first !== undefined && BETWEEN_CODES.test(first.rest) ? first.spans : []));
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

  const refused = parsed.kind === "provider" ? providerRefusal(parsed.command, parsed.words) : undefined;
  if (refused !== undefined) return `${line.trim()}: ${refused}`;

  return parsed.kind === "usage-error" ? `${line.trim()}: ${parsed.message}` : undefined;
}

describe("the agent skill", () => {
  test("the frontmatter names the skill and says when to use it: an agent's loader reads those two keys, and without them it skips the file or never picks it", async () => {
    expect(frontmatterOf(await read(ROOT, "SKILL.md"))).toEqual({ name: "poplin", description: expect.stringMatching(TRIGGER) });
  });

  test("the pages cover every tool, and every other word in code font is an input of a tool or a code: without this a renamed tool or input, of one word or several, stays in a page an agent follows", async () => {
    const words = (await readAll(ROOT)).flatMap((page) => page.spans).filter((span) => WORD.test(span));
    const named = [...new Set(words)].filter((word) => !OTHER_WORDS.includes(word) && !INPUTS.includes(word) && !isCode(word) && !INSTALL_WORDS.includes(word));

    expect(named.sort()).toEqual([...TOOLS].sort());
  });

  test("every code in the table of refusals is one the CLI answers with: without this a renamed code, of one word or several, stays in the table an agent looks a refusal up in", async () => {
    const codes = await refusalCodes(ROOT);

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => !isCode(code) && !INSTALL_WORDS.includes(code))).toEqual([]);
    expect(["constructor", "no_such_code"].filter(isCode)).toEqual([]);
  });

  // Drift: a row read as raw text was passed over when its code held a digit or a dash, so a code the CLI never answers with stayed in the table.
  test("a code is read out of the first cell of a row however the row is written, and a cell of words or of backticks that open no code is none", async () => {
    const table = ["| Code | Means |", "| --- | --- |", "|`not_found`| no site |", "| `no_2fa`, `usage-error` | two more |", "| every other | see `timeout` |", "| \\`no_code\\` | plain text |"];
    using tree = plantedRepository({ [`${SKILL_PLACE}${REFUSALS_PAGE}`]: `# Refusals\n\n${table.join("\n")}\n` });

    expect(await refusalCodes(tree.path)).toEqual(["not_found", "no_2fa", "usage-error"]);
  });

  test("every command and flag in the pages is one the CLI takes: without this a renamed command or flag stays in a page an agent runs", async () => {
    const pages = await readAll(ROOT);
    const written = pages.flatMap((page) => [...page.prose, ...page.blocks.map((block) => block.text)]);
    const lines = [...new Set(written.flatMap((text) => matches(text, COMMAND_LINE, 1)))].sort();
    const flags = new Set<string>([...COMMANDS.flatMap((spec: CommandSpec) => spec.flags.map((flag) => flag.name)), ...INSTALL_FLAGS]);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map(refusalOf).filter((refusal) => refusal !== undefined)).toEqual([]);
    expect(written.flatMap((text) => matches(text, FLAG)).filter((flag) => !flags.has(flag))).toEqual([]);
  });

  test("the JSON entry for a file-configured agent starts the CLI's MCP server: without this the entry runs a command the CLI refuses, and the server exits at once", async () => {
    const { blocks } = readPage(await read(ROOT, "references/mcp-server.md"));
    const entry: ServerEntry = JSON.parse(blocks.find((block) => block.language === JSON_BLOCK)?.text ?? "{}");
    const { command, args = [] } = entry.mcpServers?.poplin ?? {};

    expect([command, args[0]]).toEqual(["npx", "poplin"]);
    expect(parseCommand(args.slice(1), READ_ON).kind).toBe("mcp");
  });

  test("the main page links every page under references/, and every such link leads to a page: without this a sub-page is never opened, or a link sends an agent nowhere", async () => {
    const { held, linked } = await references(ROOT);

    expect(held.length).toBeGreaterThan(0);
    expect(linked).toEqual(held);
    expect((await linkedReferences(ROOT, "README.md")).filter((link) => !held.includes(link))).toEqual([]);
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
    expect((await readAll(tree.path)).map((page) => page.headings.map((heading) => heading.text))).toEqual([["Poplin"], ["Added"], ["Setup"]]);
  });

  // Drift: a link read as raw text counted inside a fenced example and was missed when it opened with `./`, so a sub-page no agent is sent to read as linked.
  test("a link to a sub-page counts however its path is written, and one inside a fenced example does not", async () => {
    using tree = plantedRepository({
      "skills/poplin/SKILL.md": "# Poplin\n\nRead [the setup](./references/setup.md).\n\n```md\nSee [the rest](references/rest.md).\n```\n",
      "skills/poplin/references/setup.md": "# Setup\n",
      "skills/poplin/references/rest.md": "# Rest\n",
    });

    expect(await references(tree.path)).toEqual({ held: ["references/rest.md", "references/setup.md"], linked: ["references/setup.md"] });
  });

  test("the two Codex files show the skill under one name, one line, and one colour, the main page's title: without this Codex lists the skill under two faces", async () => {
    const sidecar: Shown = Bun.YAML.parse(await read(ROOT, "agents/openai.yaml")) as Shown;
    const manifest: Shown = await Bun.file(join(ROOT, SKILL_PLACE, ".codex-plugin", "plugin.json")).json();
    const title = readPage(await read(ROOT, "SKILL.md")).headings.find((heading) => heading.level === 1)?.text;

    expect([sidecar.interface?.display_name, sidecar.interface?.short_description, sidecar.interface?.brand_color]).toEqual([
      title,
      manifest.interface?.shortDescription,
      manifest.interface?.brandColor,
    ]);
    expect(manifest.interface?.displayName).toBe(title);
  });
});

describe("the plugin, and the add-on that starts the MCP server in Claude Code", () => {
  // Claude Code keeps the add-on out of every request by its switch. An agent that reads descriptions alone decides by the sentences, so none of them may name a request.
  test("the add-on's frontmatter is YAML that names its folder, and no request loads it: without this the skills CLI passes the folder over, or a request to publish loads two skills", async () => {
    const addOn = frontmatterOf(await Bun.file(join(ROOT, ADD_ON_PLACE, "SKILL.md")).text());
    const skill = sentences(frontmatterOf(await read(ROOT, "SKILL.md")));

    expect(addOn).toEqual({ name: posix.basename(ADD_ON_PLACE), description: expect.stringMatching(/\p{L}/u), "disable-model-invocation": true });
    expect(sentences(addOn).filter((sentence) => TRIGGER.test(sentence) || skill.includes(sentence))).toEqual([]);
  });

  // The package is named with its tag: in a checkout of this repository a bare `npx poplin` finds the workspace's unbuilt package, and the shell answers `poplin: command not found`.
  // `-y` answers npx's own question, which nobody sees on a server's stdio.
  test("the server starts as the released package, named in full, with no question asked: without this it does not start in a checkout of this repository, or it waits on a question nobody sees", async () => {
    const cli: Package = await Bun.file(join(ROOT, PACKAGE)).json();
    const entry: ServerEntry = await Bun.file(join(ROOT, SERVER_FILE)).json();
    const { command, args = [] } = entry.mcpServers?.poplin ?? {};

    expect([command, ...args.slice(0, 3)]).toEqual(["npx", "-y", `--package=${cli.name}@latest`, ...Object.keys(cli.bin)]);
    expect(parseCommand(args.slice(3), READ_ON).kind).toBe("mcp");
  });

  test("the plugin ships the skill by its folder, and starts the server from the add-on's own file: without this a moved skill leaves a plugin with no instructions, or the two commands drift apart and Claude Code shows every tool twice", async () => {
    const { plugins }: { readonly plugins: readonly Listed[] } = await Bun.file(join(ROOT, MARKETPLACE)).json();
    const addOn: AddOn = await Bun.file(join(ROOT, ADD_ON_PLACE, ".claude-plugin", "plugin.json")).json();
    const written = plugins.flatMap(({ source, skills, mcpServers }) => [source, ...skills, mcpServers]);
    const shipped = plugins.map(({ source, skills, mcpServers }) => ({ skills: skills.map((skill) => `${posix.join(source, skill)}/`), server: posix.join(source, mcpServers) }));

    expect(written.filter((path) => !path.startsWith(FROM_ITS_FOLDER))).toEqual([]);
    expect(shipped).toEqual([{ skills: [SKILL_PLACE], server: SERVER_FILE }]);
    expect(addOn.mcpServers).toBeUndefined();
  });

  test("the plugin and the add-on carry the package's version, and the plugin its description, home page, license, and repository: without this a release leaves a manifest behind, or the listing says what the package no longer does", async () => {
    const cli: Package = await Bun.file(join(ROOT, PACKAGE)).json();
    const { plugins }: { readonly plugins: readonly Listed[] } = await Bun.file(join(ROOT, MARKETPLACE)).json();
    const addOn: AddOn = await Bun.file(join(ROOT, ADD_ON_PLACE, ".claude-plugin", "plugin.json")).json();
    const { hostname, pathname } = new URL(cli.repository.url);
    const listed = plugins.map(({ version, description, homepage, license, repository }) => ({ version, description, homepage, license, repository }));

    expect(listed).toEqual([{ version: cli.version, description: cli.description, homepage: cli.homepage, license: cli.license, repository: `https://${hostname}${pathname.replace(/\.git$/, "")}` }]);
    expect(addOn.version).toBe(cli.version);
  });
});
