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
const EDGE_SPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

const SINGLE_LINK_ATTRIBUTES: ReadonlySet<string> = new Set([HREF, "src"]);

/** A link that starts at the root of its host, and the file that holds it. */
interface RootLink {
  /** The path of the file in the site. */
  readonly file: string;

  /** The link as the file writes it, without the whitespace around it. */
  readonly link: string;
}

/** How far one page is read: `end` is set once its first root link is found, or once a `<base>` sent its links to another host, which leaves no link to name. */
interface Reading {
  end: { readonly link: string | undefined } | undefined;
}

function isRootLink(link: string): boolean {
  return link.startsWith(ROOT) && !link.startsWith(OTHER_HOST);
}

/** HTML takes off the ASCII whitespace around an address, and no other. */
function trimmed(value: string): string {
  return value.replace(EDGE_SPACE, "");
}

function namesHost(link: string): boolean {
  return link.startsWith(OTHER_HOST) || SCHEME_AND_HOST.test(link);
}

function linksOf(attribute: string, value: string): string[] {
  if (SINGLE_LINK_ATTRIBUTES.has(attribute)) return [trimmed(value)];

  if (attribute !== SRCSET) return [];

  return parseSrcset(value).map((candidate) => candidate.url);
}

function readTag(name: string, attributes: Readonly<Record<string, string>>, reading: Reading): void {
  if (reading.end !== undefined) return;

  // A base that names a host sends every root link of the page there, where this install has no say.
  if (name === BASE && namesHost(trimmed(attributes[HREF] ?? ""))) {
    reading.end = { link: undefined };

    return;
  }

  for (const [attribute, value] of Object.entries(attributes)) {
    const link = linksOf(attribute, value).find(isRootLink);
    if (link === undefined) continue;

    reading.end = { link };

    return;
  }
}

async function rootLinkOf(page: PublishFile): Promise<string | undefined> {
  const reading: Reading = { end: undefined };
  const parser = new Parser({ onopentag: (name, attributes) => readTag(name, attributes, reading) });
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
 * Only `.html` and `.htm` files are read, as UTF-8, each up to its first such link. A page is read no further than a `<base>` whose `href` names a host, since its links go there.
 *
 * @param files - the files of a listing, in its order
 * @returns the first such link of the first file that holds one; `undefined` when no file does
 */
export async function firstRootLink(files: readonly PublishFile[]): Promise<RootLink | undefined> {
  for (const file of files) {
    if (!PAGE_FILE.test(file.path)) continue;

    const link = await rootLinkOf(file);
    if (link !== undefined) return { file: file.path, link };
  }

  return undefined;
}
