import { afterEach, describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";

import type { Installer } from "../../../../core/src/install/installer";
import { COMMANDS } from "../../../src/commands/command-table";
import { fullHelp } from "../../../src/commands/line/full-help";
import { helpText } from "../../../src/commands/line/help";
import { parseCommand } from "../../../src/commands/line/parse-command";
import { installHelp } from "../../../src/install/first/help";
import { uninstallHelp } from "../../../src/install/remove/help";
import { repairHelp } from "../../../src/install/repair/report";
import { pasted } from "../../../src/local/invoked";
import { foldedText } from "../../../src/local/screen";
import { emptyAccount, standIn } from "../../install/support/stand-in";
import { cleanUp, openBench } from "../support/harness";

/** The look where no terminal is. */
const PLAIN = { width: 80, colour: false };

/** What parts two helps of the page: a rule between two empty lines. */
const RULE = `\n\n${"-".repeat(80)}\n\n`;

/** The one made-up provider. */
const PROVIDER = standIn(emptyAccount()) as Installer<unknown, unknown>;

afterEach(cleanUp);

describe("fullHelp", () => {
  test("the page is the overview and then every command's own help as its --help prints it, a provider's among them: a help the page words anew would drift from the command's", () => {
    const pages = fullHelp([PROVIDER], PLAIN).split(RULE);
    const own = [...COMMANDS.map((spec) => helpText(spec.name)), ...[installHelp, uninstallHelp].flatMap((help) => [help([PROVIDER]), help([PROVIDER], PROVIDER)]), repairHelp([PROVIDER])];

    const listed = (helpText().split("\n\nOptions:")[0] ?? "").split("\n").flatMap((line) => /^ {2}([a-z-]+)(?: |$)/.exec(line)?.[1] ?? []);
    const named = pages.slice(1).map((page) => page.split("\n")[0]?.split(" ")[2]?.replace("<path>", "publish"));

    expect([pages[0], pages.length, own.filter((help) => !pages.includes(help))]).toEqual([helpText(), own.length + 1, []]);
    expect([...new Set(named)]).toEqual(listed);
  });

  test.each([60, 80, 120, 200])("at %i wide the painted page, with its sequences taken off, is the plain page, and no line is wider", (width) => {
    const shown = (colour: boolean): string => foldedText(pasted(fullHelp([PROVIDER], { width, colour }), "npx poplin"), width);

    expect([stripVTControlCharacters(shown(true)) === shown(false), shown(true) === shown(false), shown(false).split("\n").filter((line) => line.length > width)]).toEqual([true, false, []]);
  });

  test("--full-help is read with no command alone, listed in the overview, printed on stdout with exit 0, and refused on a command: a flag taken and nowhere shown is found by nobody", async () => {
    const bench = await openBench();
    const ran = await bench.run("--full-help");
    const refused = parseCommand(["set", "report", "--full-help"]);

    expect<unknown>(parseCommand(["--full-help"])).toEqual({ kind: "help", asked: true, full: true });
    expect(helpText()).toContain("\n  --full-help               Show the help of every command\n");
    expect([ran.code, ran.err, ran.out.length, ran.out[0]?.split(RULE)[0], ran.out[0]?.split(RULE).length]).toEqual([0, [], 1, helpText(), fullHelp([], PLAIN).split(RULE).length]);
    expect(refused.kind === "usage-error" ? refused.message : refused.kind).toBe('unknown flag "--full-help"');
  });
});
