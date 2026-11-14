// Scope: the pages a person reads name only commands, flags, tools, tool inputs, refusal codes, settings, and module inputs that exist, and every link between them leads somewhere. What the prose says is out of scope.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { COMMANDS, type CommandSpec } from "../packages/cli/src/commands/command-table";
import { SETTING_SAMPLES } from "../packages/cli/src/commands/install-settings";
import { parseCommand } from "../packages/cli/src/commands/parse-command";
import { problem } from "../packages/cli/src/commands/problems";
import { TOOLS } from "../packages/cli/src/mcp/tools";
import { words } from "../packages/cli/tests/commands/support/command-line";
import { plantedRepository, repositoryFiles } from "./support/repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The pages a person reads, as paths from the root. */
const PAGES: readonly string[] = ["README.md", "docs/README.md", "docs/using.md", "docs/install.md", "docs/security.md", "packages/cli/README.md"];

/** Every Markdown page of the repository, the ones a person reads among them. */
const MARKDOWN = new Bun.Glob("**/*.md");

/** The sources of the website, whose pages link into the rendered `docs/`. */
const WEBSITE = new Bun.Glob("website/src/**/*.astro");

/** A file in a folder whose name starts with a dot: a tool's own pages, which link from where the tool reads them. */
const HIDDEN = /(?:^|\/)\.[^/]+\//;

/** A link of the website into the rendered docs, with the path under the site as the first group. */
const SITE_LINK = /sitePath\("(docs\/[^"]*)"\)/g;

/** The ending the site gives a rendered page, where a link ends or its anchor starts. A folder's README is served as the folder alone, so its name never matches. */
const RENDERED_PAGE = /(?<!\/README)\.html(?=#|$)/;

/** The end of a link to a folder, where the link ends or its anchor starts. */
const FOLDER_END = /\/(?=#|$)/;

/** The page the site serves for a folder of the docs. */
const FOLDER_PAGE = "README.md";

/** The page that lists every command, tool, and refusal. */
const USING_PAGE = "docs/using.md";

/** The heading the tables of refusals follow on that page. */
const REFUSALS_HEADING = "## When poplin refuses";

/** The files of the OpenTofu module that declare its inputs and outputs. */
const MODULE_FILES: readonly string[] = ["packages/cloudflare/tofu/variables.tf", "packages/cloudflare/tofu/outputs.tf"];

/** The pages that name the module's inputs and outputs. On every other page a word spelled like one must be a tool, an input of a tool, a setting, or a code. */
const MODULE_PAGES: readonly string[] = ["docs/install.md"];

/** The words written with an underscore that are none of the above: a folder that is never uploaded. */
const OTHER_WORDS: readonly string[] = ["node_modules"];

/** The code of a command line the CLI could not read, which it answers outside its table of problems. */
const USAGE_CODE = "usage-error";

/** A moment before every day an example names, so `--expires 2026-12-01` is read the same on any day the test runs. */
const NOW = Date.UTC(2026, 0, 1);

/** A code span, with its text as the first group. */
const SPAN = /`([^`\n]+)`/g;

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

/** The first cell of a table row that holds code spans alone: one, or several with commas between. */
const CODE_CELL = /^\| *(`[a-z_-]+`(?:, *`[a-z_-]+`)*) *\|/gm;

/** An input or an output of the module, with its name as the first group. */
const MODULE_NAME = /^(?:variable|output) "([a-z_]+)"/gm;

/** An input of the module, with its name as the first group. */
const MODULE_INPUT = /^variable "([a-z_]+)"/gm;

/** A link that leaves the repository. */
const OUTSIDE_LINK = /^[a-z]+:/;

/** A code of the CLI's table of problems. */
type Code = Parameters<typeof problem>[0];

/** What a page holds, as Bun's Markdown parser reads it. */
interface Page {
  /** The text of every code span, table cells included. */
  readonly spans: string[];

  /** The text of every fenced block. */
  readonly blocks: string[];

  /** Where every link leads. */
  readonly links: string[];

  /** The anchor of every heading. */
  readonly anchors: string[];
}

async function read(root: string, path: string): Promise<string> {
  return Bun.file(join(root, path)).text();
}

async function parse(root: string, path: string): Promise<Page> {
  const page: Page = { spans: [], blocks: [], links: [], anchors: [] };

  Bun.markdown.render(
    await read(root, path),
    {
      codespan: (text) => {
        page.spans.push(text);

        return "";
      },
      code: (text) => {
        page.blocks.push(text);

        return "";
      },
      link: (text, meta) => {
        page.links.push(meta.href);

        return text;
      },
      heading: (text, meta) => {
        page.anchors.push(meta.id ?? "");

        return text;
      },
    },
    { tables: true, headings: { ids: true } },
  );

  return page;
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

/** The inputs a tool's example passes that the tool does not take. */
function unknownInputs(tool: string, example: string): string[] {
  const taken: readonly string[] = Object.hasOwn(TOOLS, tool) ? Object.keys(TOOLS[tool as keyof typeof TOOLS].parameters) : [];

  return Object.keys(JSON.parse(example)).filter((input) => !taken.includes(input));
}

/** The Markdown page a link of the website leads to: the site serves `docs/using.md` as `docs/using.html`, and a folder as its README. */
function sitePage(link: string): string {
  return link.replace(RENDERED_PAGE, ".md").replace(FOLDER_END, `/${FOLDER_PAGE}`);
}

/** The repository's own files a pattern takes, as paths from the root. */
function paths(root: string, glob: Bun.Glob): string[] {
  return repositoryFiles(root).filter((path) => glob.match(path) && !HIDDEN.test(path));
}

/** What is wrong with one link of a file, or nothing when it leads to a file, and to a heading of it when it names one. The link is read from the file's folder unless another is given. */
async function brokenLink(root: string, from: string, href: string, folder: string = dirname(from)): Promise<string | undefined> {
  const [path = "", anchor] = href.split("#");
  const target = path === "" ? from : join(folder, path).replaceAll("\\", "/");
  if (!existsSync(join(root, target))) return `${from}: ${path} does not exist`;

  if (anchor === undefined || (await parse(root, target)).anchors.includes(anchor)) return undefined;

  return `${from}: ${target} has no heading #${anchor}`;
}

/** Every link between the Markdown pages of a repository: what is wrong with it, or nothing. */
async function pageLinks(root: string): Promise<(string | undefined)[]> {
  const checked: (string | undefined)[] = [];

  for (const path of paths(root, MARKDOWN)) {
    for (const href of (await parse(root, path)).links.filter((link) => !OUTSIDE_LINK.test(link))) checked.push(await brokenLink(root, path, href));
  }

  return checked;
}

/** Every link of a repository's website into its docs: what is wrong with it, or nothing. */
async function siteLinks(root: string): Promise<(string | undefined)[]> {
  const checked: (string | undefined)[] = [];

  for (const path of paths(root, WEBSITE)) {
    for (const link of groups(await read(root, path), SITE_LINK)) checked.push(await brokenLink(root, path, sitePage(link), ""));
  }

  return checked;
}

describe("the pages a person reads", () => {
  test("every command line in the pages is one the CLI takes: without this a renamed command or flag stays in an example a person copies", async () => {
    const refusals: string[] = [];

    for (const path of PAGES) {
      const lines = commandLines(await parse(ROOT, path));
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines.filter((written) => !namesCommand(written))) {
        const parsed = parseCommand(words(line), NOW);
        if (parsed.kind === "usage-error") refusals.push(`${path}: ${line}: ${parsed.message}`);
      }
    }

    expect(refusals).toEqual([]);
    expect(["poplin new-link", "poplin no-such-command", "poplin new-link --no-such-flag"].filter(namesCommand)).toEqual(["poplin new-link"]);
    expect(commandLines({ spans: ["poplin list --trash", "poplin.example.com"], blocks: ["$ npx poplin ./report --site report   # new content\n"] })).toEqual([
      "poplin ./report --site report",
      "poplin list --trash",
    ]);
  });

  test("the using page runs every command of the CLI in an example: without this a new command is never shown to the person who would run it", async () => {
    const run = new Set<string>(commandLines(await parse(ROOT, USING_PAGE)).map((line) => parseCommand(words(line), NOW).kind));

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

  test("the using page names every tool, and each example passes only inputs its tool takes: without this a new tool is never shown, and a renamed input stays in an example", async () => {
    const { spans } = await parse(ROOT, USING_PAGE);
    const examples = spans.flatMap((span, at) => (JSON_SPAN.test(span) ? [{ tool: spans[at - 1] ?? "", input: span }] : []));

    expect(Object.keys(TOOLS).filter((tool) => !spans.includes(tool))).toEqual([]);
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.flatMap(({ tool, input }) => unknownInputs(tool, input).map((unknown) => `${tool}: ${unknown}`))).toEqual([]);
    expect(unknownInputs("get_site", '{ "site": "report", "path": "./report" }')).toEqual(["path"]);
  });

  test("every code in the tables of refusals is one the CLI answers with: without this a renamed code stays in the table a person looks a refusal up in", async () => {
    const [, tables = ""] = (await read(ROOT, USING_PAGE)).split(REFUSALS_HEADING);
    const codes = groups(tables, CODE_CELL).flatMap((cell) => groups(cell, SPAN));

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => code !== USAGE_CODE && !isCode(code))).toEqual([]);
    expect(["constructor", "no_such_code"].filter(isCode)).toEqual([]);
  });

  test("every link of every Markdown page leads to a file, and to a heading when it names one: without this a moved page or a reworded heading leaves a dead link", async () => {
    const pages = paths(ROOT, MARKDOWN);
    const broken = await pageLinks(ROOT);

    expect(PAGES.filter((path) => !pages.includes(path))).toEqual([]);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.filter((found) => found !== undefined)).toEqual([]);
    expect(await brokenLink(ROOT, "README.md", "docs/using.md#no-such-heading")).toBe("README.md: docs/using.md has no heading #no-such-heading");
  });

  test("every link of the website into the docs leads to a page, and to a heading when it names one: without this a section removed from the docs breaks the published site", async () => {
    const broken = await siteLinks(ROOT);

    expect(broken.length).toBeGreaterThan(0);
    expect(broken.filter((found) => found !== undefined)).toEqual([]);
    expect(["docs/", "docs/security.html#hardening", "docs/#install"].map(sitePage)).toEqual(["docs/README.md", "docs/security.md#hardening", "docs/README.md#install"]);
    expect(await brokenLink(ROOT, "website/src/pages/index.astro", sitePage("docs/security.html#no-such-heading"), "")).toBe("website/src/pages/index.astro: docs/security.md has no heading #no-such-heading");
    expect(await brokenLink(ROOT, "website/src/pages/index.astro", sitePage("docs/README.html"), "")).toBe("website/src/pages/index.astro: docs/README.html does not exist");
  });

  // Drift: a guard that lists the disk reads what is no part of the repository, and fails in the one checkout that holds it.
  test("a dead link is named in a new page not yet added, and not in a page the repository is told to leave out or in a build folder", async () => {
    const dead = "[the page that is gone](docs/gone.md)\n";
    const deadOnSite = 'const href = sitePath("docs/gone.html");\n';
    using tree = plantedRepository(
      {
        "README.md": `[using it](docs/using.md)\n${dead}`,
        "docs/using.md": "# Using it\n",
        "NOTES.md": dead,
        "built/page.md": dead,
        "website/src/pages/index.astro": deadOnSite,
        "website/src/pages/scratch.astro": deadOnSite,
        "website/src/built/page.astro": deadOnSite,
      },
      { excluded: ["/NOTES.md", "scratch.astro"], ignored: ["built/"] },
    );

    expect(await pageLinks(tree.path)).toEqual([undefined, "README.md: docs/gone.md does not exist"]);
    expect(await siteLinks(tree.path)).toEqual(["website/src/pages/index.astro: docs/gone.md does not exist"]);
  });
});
