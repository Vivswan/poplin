// The first link of a publish that starts at the root of its host, read on the publisher's machine. Under an address with a path, such a link leaves the site.

import { Parser } from "htmlparser2";
import { parseSrcset } from "srcset";

import type { PublishFile } from "./read";

const PAGE_FILE = /\.html?$/i;
const BASE = "base";
const HREF = "href";
const SRCSET = "srcset";
const ROOT = "/";
const OTHER_HOST = "//";
const SCHEME_AND_HOST = /^[a-z][a-z0-9+.-]*:\/\//i;
const PAGE_ADDRESS = "https://page.invalid/";
const EDGE_SPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

const SINGLE_LINK_ATTRIBUTES: ReadonlySet<string> = new Set([HREF, "src"]);
const BASELESS_ELEMENTS: ReadonlySet<string> = new Set(["template", "svg", "math"]);

/** A link that starts at the root of its host, and the file that holds it. */
interface RootLink {
  /** The path of the file in the site. */
  readonly file: string;

  /** The link as the file writes it, without the whitespace around it. */
  readonly link: string;
}

/** How far one page is read: `end` is set once its first root link is found, or once its base sent its links off the install, which leaves no link to name. `baseless` counts the open elements that hold no base of the page. */
interface Reading {
  baseSeen: boolean;
  baseless: number;
  end: { readonly link: string | undefined } | undefined;
}

function isRootLink(link: string): boolean {
  return link.startsWith(ROOT) && !link.startsWith(OTHER_HOST);
}

/** HTML takes off the ASCII whitespace around an address, and no other. */
function trimmed(value: string): string {
  return value.replace(EDGE_SPACE, "");
}

/** The host a link names as a browser reads it, in lowercase and without the port of its scheme; `undefined` for a link that names none. */
function hostOf(link: string): string | undefined {
  if (!link.startsWith(OTHER_HOST) && !SCHEME_AND_HOST.test(link)) return undefined;

  return URL.parse(link, PAGE_ADDRESS)?.host;
}

function linksOf(attribute: string, value: string): string[] {
  if (SINGLE_LINK_ATTRIBUTES.has(attribute)) return [trimmed(value)];

  if (attribute !== SRCSET) return [];

  return parseSrcset(value).map((candidate) => candidate.url);
}

/** Read a `<base>`. Only the first with an `href`, outside any template, drawing, or formula, is the page's base, as in a browser: another changes no link and is none itself. */
function readBase(href: string | undefined, hosts: readonly string[], reading: Reading): void {
  if (href === undefined || reading.baseSeen || reading.baseless > 0) return;

  reading.baseSeen = true;
  const link = trimmed(href);
  const host = hostOf(link);

  // A base on another host sends every root link of the page there, where this install has no say.
  if (host !== undefined && !hosts.includes(host)) {
    reading.end = { link: undefined };

    return;
  }

  // A base on the install's own host, or from its root, takes every link of the page out of the site: it is the link to name.
  if (host !== undefined || isRootLink(link)) reading.end = { link };
}

function readTag(name: string, attributes: Readonly<Record<string, string>>, hosts: readonly string[], reading: Reading): void {
  if (reading.end !== undefined) return;

  if (name === BASE) {
    readBase(attributes[HREF], hosts, reading);

    return;
  }

  for (const [attribute, value] of Object.entries(attributes)) {
    const link = linksOf(attribute, value).find(isRootLink);
    if (link === undefined) continue;

    reading.end = { link };

    return;
  }
}

async function rootLinkOf(page: PublishFile, hosts: readonly string[]): Promise<string | undefined> {
  const reading: Reading = { baseSeen: false, baseless: 0, end: undefined };
  const parser = new Parser({
    onopentag: (name, attributes) => {
      readTag(name, attributes, hosts, reading);
      if (BASELESS_ELEMENTS.has(name)) reading.baseless += 1;
    },
    onclosetag: (name) => {
      if (BASELESS_ELEMENTS.has(name)) reading.baseless -= 1;
    },
  });
  const decoder = new TextDecoder();
  const reader = page.open().getReader();

  try {
    while (reading.end === undefined) {
      const { done, value } = await reader.read();
      if (done) break;

      parser.write(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel();
  }

  parser.end();

  return reading.end?.link;
}

/**
 * Find the first link of a publish that starts at the root of its host: an `href`, a `src`, or a candidate of a `srcset` that starts with one `/`.
 *
 * A base on one of the install's hosts counts as such a link, since every link of its page then starts at that host.
 * Only `.html` and `.htm` files are read, as UTF-8, each up to its first such link. A page is read no further than a base that names a host other than the install's, since its links go there. Its base is its first `<base>` with an `href`.
 *
 * @param files - the files of a listing, in its order
 * @param hosts - the hosts the install serves its sites on, as its layout names them: a base on one of them is named as a root link, and one on any other host exempts its page
 * @returns the first such link of the first file that holds one; `undefined` when no file does
 */
export async function firstRootLink(files: readonly PublishFile[], hosts: readonly string[]): Promise<RootLink | undefined> {
  for (const file of files) {
    if (!PAGE_FILE.test(file.path)) continue;

    const link = await rootLinkOf(file, hosts);
    if (link !== undefined) return { file: file.path, link };
  }

  return undefined;
}
