// The page's own title, read on the publisher's machine from the start of the entry page.

import { DomUtils, parseDocument } from "htmlparser2";

import type { PublishFile } from "./read";

const READ_LIMIT_BYTES = 64 * 1024;
const MAX_TITLE_CHARACTERS = 200;
const TITLE = "title";
const WHITESPACE_RUN = /\s+/g;

const FOREIGN_ROOTS: ReadonlySet<string> = new Set(["svg", "math"]);

type Element = ReturnType<typeof DomUtils.getElementsByTagName>[number];

async function readStart(page: Pick<PublishFile, "open">): Promise<string> {
  const reader = page.open().getReader();
  const chunks: Uint8Array[] = [];
  let budget = READ_LIMIT_BYTES;

  try {
    while (budget > 0) {
      const { done, value } = await reader.read();
      if (done) break;

      const head = value.subarray(0, budget);
      budget -= head.length;
      chunks.push(head);
    }
  } finally {
    await reader.cancel();
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Whether a title describes a drawing or a formula rather than the page. */
function isForeign(element: Element): boolean {
  for (let above = element.parent; above !== null; above = above.parent) {
    if ("name" in above && FOREIGN_ROOTS.has(above.name)) return true;
  }

  return false;
}

function tidy(raw: string): string | undefined {
  const collapsed = raw.replace(WHITESPACE_RUN, " ").trim();
  const capped = [...collapsed].slice(0, MAX_TITLE_CHARACTERS).join("").trimEnd();
  if (capped === "") return undefined;

  return capped;
}

/**
 * Read a page's own title: the text of its first `<title>` element, outside any inline SVG or MathML.
 *
 * Only the first 64 KB of the page are read, as UTF-8, and parsed as if they were the whole page: a title that starts after them is not seen, and one they cut through is read as far as they go.
 *
 * @param page - the entry page of a listing
 * @returns the title with entities decoded, whitespace runs collapsed to one space, trimmed, and cut to 200 characters; `undefined` when the page has none or an empty one
 */
export async function readTitle(page: Pick<PublishFile, "open">): Promise<string | undefined> {
  const start = parseDocument(await readStart(page));
  const title = DomUtils.getElementsByTagName(TITLE, start).find((element) => !isForeign(element));
  if (title === undefined) return undefined;

  return tidy(DomUtils.textContent(title));
}
