// The console's one page as a test reads it: by a parser, as a browser does, never by a pattern over its text.

import { Parser } from "htmlparser2";

/** What the page holds. */
interface Shell {
  /** The start values the page hands its client, or `null` for a page that carries none. */
  readonly boot: unknown;

  /** The address of every script the page loads. */
  readonly scripts: readonly string[];

  /** The address of every stylesheet the page links. */
  readonly styles: readonly string[];

  /** How many things the page holds that a browser would run and that are no file of its own: a script written into the page, or a link that runs script. */
  readonly runs: number;
}

/** Whether a tag is something a browser runs from the page's own text. */
function runsHere(name: string, attributes: Readonly<Record<string, string>>): boolean {
  if (name === "script") return attributes.src === undefined && attributes.type !== "application/json";

  return name === "a" && (attributes.href ?? "").trim().toLowerCase().startsWith("javascript:");
}

/**
 * Read a page of the console.
 *
 * @param page - the page's whole text
 * @throws {SyntaxError} the page's start values are no JSON
 */
export function readShell(page: string): Shell {
  const [scripts, styles]: [string[], string[]] = [[], []];
  let [boot, runs, inBoot] = ["", 0, false];
  const parser = new Parser({
    onopentag: (name, attributes) => {
      inBoot = name === "script" && attributes.id === "boot";
      if (name === "script" && attributes.src !== undefined) scripts.push(attributes.src);

      if (name === "link" && attributes.rel === "stylesheet") styles.push(attributes.href ?? "");

      if (runsHere(name, attributes)) runs += 1;
    },
    ontext: (text) => {
      if (inBoot) boot += text;
    },
    onclosetag: () => {
      inBoot = false;
    },
  });
  parser.end(page);

  return { boot: boot === "" ? null : JSON.parse(boot), scripts, styles, runs };
}
