// The page's own title, read on the publisher's machine from the start of the entry page.

import { DomUtils, parseDocument } from "htmlparser2";

import type { PublishFile } from "./read";

const READ_LIMIT_BYTES = 64 * 1024;
const MAX_TITLE_CHARACTERS = 200;
const TITLE = "title";
const UNPRINTED_RUN = /[\s\p{Cc}\p{Zl}\p{Zp}]+/gu;

const FOREIGN_ROOTS: ReadonlySet<string> = new Set(["svg", "math"]);

type Element = ReturnType<typeof DomUtils.getElementsByTagName>[number];

async function readStart(page: Pick<PublishFile, "open">, stopped: AbortSignal): Promise<string> {
  stopped.throwIfAborted();

  const enough = new AbortController();
  const chunks: Uint8Array[] = [];
  let budget = READ_LIMIT_BYTES;
  const kept = new WritableStream<Uint8Array>({
    write(piece): void {
      const head = piece.subarray(0, budget);
      budget -= head.length;
      chunks.push(head);
      if (budget === 0) enough.abort();
    },
  });

  // The page is let go at a stop, or once enough of it is kept, and only the stop is a failure.
  await page
    .open()
    .pipeTo(kept, { signal: AbortSignal.any([stopped, enough.signal]) })
    .catch((failure: unknown) => {
      if (!enough.signal.aborted) throw failure;
    });
  stopped.throwIfAborted();

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
  const collapsed = raw.replace(UNPRINTED_RUN, " ").trim();
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
 * @param stopped - aborts when the person stops the command: the page is then not opened, and one being read is let go
 * @returns the title with entities decoded, runs of whitespace and control characters collapsed to one space, trimmed, and cut to 200 characters; `undefined` when the page has none or an empty one
 * @throws {Error} the page could not be read, or the stop came first, which throws the signal's own reason
 */
export async function readTitle(page: Pick<PublishFile, "open">, stopped: AbortSignal): Promise<string | undefined> {
  const start = parseDocument(await readStart(page, stopped));
  const title = DomUtils.getElementsByTagName(TITLE, start).find((element) => !isForeign(element));
  if (title === undefined) return undefined;

  return tidy(DomUtils.textContent(title));
}
