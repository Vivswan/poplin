import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFiles } from "../../src/files/read";
import { readTitle } from "../../src/files/title";

const READ_LIMIT = 64 * 1024;
const TITLE = "<title>Late</title>";
const ENCODER = new TextEncoder();
const UNSTOPPED = new AbortController().signal;

/** A page that hands its bytes over in the given pieces, one piece a read. */
function pieces(...chunks: readonly Uint8Array[]): { open(): ReadableStream<Uint8Array> } {
  return {
    open: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);

          controller.close();
        },
      }),
  };
}

function html(source: string): { open(): ReadableStream<Uint8Array> } {
  return pieces(ENCODER.encode(source));
}

/** A comment that brings a page to exactly `length` bytes before whatever follows it. */
function padding(length: number): string {
  return `<!--${"x".repeat(length - 7)}-->`;
}

describe("readTitle", () => {
  // Drift: the title is what the owner sees for a site on the dashboard; a wrong reading shows a drawing's caption, markup, or a script's string there.
  const rows: ReadonlyArray<readonly [string, string, string | undefined]> = [
    ["a plain title", "<!doctype html><html><head><title>Field notes</title></head><body>hi</body></html>", "Field notes"],
    ["capital tags", "<HTML><HEAD><TITLE>Field notes</TITLE></HEAD></HTML>", "Field notes"],
    ["a title with attributes", '<title id="t" lang="en">Field notes</title>', "Field notes"],
    ["entities", "<title>Salt &amp; pepper &lt;3 &quot;quoted&quot; &#65;&#x42; &eacute;</title>", 'Salt & pepper <3 "quoted" AB \u00e9'],
    ["markup inside the title, kept as text", "<title>A <b>bold</b> claim</title>", "A <b>bold</b> claim"],
    ["line breaks and runs of spaces", "<title>\n  Quarterly\n\t  sales &nbsp; report \n</title>", "Quarterly sales report"],
    ["control characters, written plain or as entities, which no stored title may hold", "<title>Field&#x7f;notes&#x1; \u0002v2</title>", "Field notes v2"],
    ["a title inside a comment, then the real one", "<!-- <title>Draft</title> --><title>Final</title>", "Final"],
    ["a title inside a script string, then the real one", "<script>const t = '<title>Script</title>';</script><title>Final</title>", "Final"],
    ["a title inside a style sheet, then the real one", "<style>/* <title>Style</title> */</style><title>Final</title>", "Final"],
    ["an inline SVG's title, then the page's", "<body><svg><title>A circle</title><circle r='4'/></svg><title>Page</title></body>", "Page"],
    ["a self-closed SVG shape before the page's title", "<svg><circle r='4'/><g><title>Shape</title></g></svg><title>Page</title>", "Page"],
    ["a MathML title, then the page's", "<math><title>Sum</title></math><title>Page</title>", "Page"],
    ["two titles", "<title>First</title><title>Second</title>", "First"],
    ["a cut that would leave a space at the end", `<title>${"a ".repeat(150)}</title>`, `${"a ".repeat(99)}a`],
    ["a cut that would split an astral character", `<title>${"\u{1f600}".repeat(201)}</title>`, "\u{1f600}".repeat(200)],
    ["only an inline SVG's title", "<body><svg><title>A circle</title></svg></body>", undefined],
    ["only a title in a comment", "<!-- <title>Draft</title> --><p>text</p>", undefined],
    ["no title", "<!doctype html><h1>Field notes</h1>", undefined],
    ["an empty title, though a second follows", "<title></title><title>Second</title>", undefined],
    ["a title of whitespace", "<title> \n &nbsp; </title>", undefined],
    ["a title the page ends inside", "<title>Field notes", "Field notes"],
    ["an empty page", "", undefined],
    ["a title that closes on the last byte read", `${padding(READ_LIMIT - TITLE.length)}${TITLE}`, "Late"],
    ["a title that what is read cuts through", `${padding(READ_LIMIT - 9)}${TITLE}`, "La"],
    ["a title whose tag is cut through", `${padding(READ_LIMIT - 4)}${TITLE}`, undefined],
    ["a title after the first 64 KB", `${padding(READ_LIMIT)}${TITLE}`, undefined],
  ];

  for (const [what, source, title] of rows) {
    test(`reads ${what}`, async () => {
      expect(await readTitle(html(source), UNSTOPPED)).toBe(title as string);
    });
  }

  test("joins a character split between two reads: without this a title with an accent shows two replacement marks", async () => {
    const bytes = ENCODER.encode("<title>\u00e9 menu</title>");
    const split = bytes.indexOf(0xc3) + 1;

    expect(await readTitle(pieces(bytes.subarray(0, split), bytes.subarray(split)), UNSTOPPED)).toBe("\u00e9 menu");
  });

  test("stops reading at 64 KB: without this a page that never ends is read without end", async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = ENCODER.encode("x".repeat(1024));
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += chunk.length;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );

    expect([await readTitle({ open: () => endless }, UNSTOPPED), pulled, cancelled]).toEqual([undefined, READ_LIMIT, true]);
  });

  // Drift: a page on a slow disk kept the read open after the person stopped the command, so a publish could not answer the stop until the disk did.
  test("ends a read that is waiting when the command is stopped, and lets the page go: without this a stop is heard only once the disk answers", async () => {
    const stop = new AbortController();
    const cancelled: unknown[] = [];
    const waiting = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined), cancel: (reason) => void cancelled.push(reason) }, { highWaterMark: 0 });

    const read = readTitle({ open: () => waiting }, stop.signal).then(
      () => "read",
      (reason: unknown) => reason,
    );
    stop.abort("stopped by the person");
    const ended = await Promise.race([read, new Promise((resolve) => setTimeout(resolve, 500, "still waiting"))]);

    expect([ended, cancelled]).toEqual(["stopped by the person", ["stopped by the person"]]);
  });

  test("opens no page for a command that was stopped already: without this a stop before the title is read still starts a read", async () => {
    const opened: ReadableStream<Uint8Array>[] = [];
    const page = { open: () => opened[opened.push(html("<title>Field notes</title>").open()) - 1] as ReadableStream<Uint8Array> };

    expect([await readTitle(page, AbortSignal.abort("stopped by the person")).catch((reason: unknown) => reason), opened]).toEqual(["stopped by the person", []]);
  });

  test("reads the entry page of a listing: without this the two halves of a publish agree on no way to hand a page over", async () => {
    using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-title-"));
    writeFileSync(join(scratch.path, "index.html"), "<!doctype html><title>Field notes</title>");
    writeFileSync(join(scratch.path, "about.html"), "<!doctype html><title>About</title>");

    const listed = await readFiles(scratch.path);
    if (!listed.ok) throw new Error(listed.reason);
    const entry = listed.files.find((file) => file.path === "index.html");

    expect(entry && (await readTitle(entry, UNSTOPPED))).toBe("Field notes");
  });
});
