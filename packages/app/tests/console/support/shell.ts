// The console's one page as a test reads it: by a parser, as a browser does, never by a pattern over its text.

import { DomUtils, parseDocument } from "htmlparser2";

/** The address a link's own is read against. Only its scheme matters: a link that names none takes it. */
const PAGE = "https://example.com/";

/** The schemes of a link that loads a page and runs nothing. */
const LOADS: readonly string[] = ["http:", "https:"];

/** What the page holds. */
interface Shell {
  /** The start values the page hands its client, or `null` for a page that carries none. */
  readonly boot: unknown;

  /** The address of every script the page loads. */
  readonly scripts: readonly string[];

  /** The address of every stylesheet the page links. */
  readonly styles: readonly string[];

  /** How many things the page holds that a browser would run and that are no file of its own: a script written into the page, or a link that does anything but load a page. */
  readonly runs: number;
}

/** Whether a link does anything but load a page: its address has another scheme than a page's, or is none that parses. */
function loadsNoPage(href: string): boolean {
  const address = URL.parse(href, PAGE);

  return address === null || !LOADS.includes(address.protocol);
}

/**
 * Read a page of the console.
 *
 * @param page - the page's whole text
 * @throws {SyntaxError} the page's start values are no JSON
 */
export function readShell(page: string): Shell {
  const document = parseDocument(page);
  const scripts = DomUtils.getElementsByTagName("script", document);
  const links = DomUtils.getElementsByTagName("link", document);
  const anchors = DomUtils.getElementsByTagName("a", document);
  const boot = scripts.filter((script) => script.attribs.id === "boot").map((script) => DomUtils.textContent(script)).join("");
  const written = scripts.filter((script) => script.attribs.src === undefined && script.attribs.type !== "application/json");
  const running = anchors.filter((anchor) => loadsNoPage(anchor.attribs.href ?? ""));

  return {
    boot: boot === "" ? null : JSON.parse(boot),
    scripts: scripts.flatMap((script) => (script.attribs.src === undefined ? [] : [script.attribs.src])),
    styles: links.filter((link) => link.attribs.rel === "stylesheet").map((link) => link.attribs.href ?? ""),
    runs: written.length + running.length,
  };
}
