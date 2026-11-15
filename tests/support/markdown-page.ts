// What a Markdown page holds, as Bun's Markdown parser reads it. A guard that reads the raw text takes a link inside a fenced example for a link of the page, and passes over a table row written another way.

/** One fenced block. */
interface Block {
  /** The language its fence names, or none. */
  readonly language: string;

  /** Its text. */
  readonly text: string;
}

/** One heading. */
interface Heading {
  /** Its level, 1 for the title. */
  readonly level: number;

  /** The anchor a link reaches it by. */
  readonly anchor: string;

  /** Its text, a code span in backticks. */
  readonly text: string;
}

/** One cell of a table. */
interface Cell {
  /** The text of each code span it holds. */
  readonly spans: readonly string[];

  /** Its text outside its code spans. */
  readonly rest: string;
}

/** One row of a table. */
interface Row {
  /** How many headings the page holds above it. */
  readonly below: number;

  /** Its cells, in the order of the row. */
  readonly cells: readonly Cell[];
}

/** One page, read once. */
export interface Page {
  /** The text of every code span, table cells included. */
  readonly spans: readonly string[];

  /** Every fenced block. */
  readonly blocks: readonly Block[];

  /** Where every link leads. */
  readonly links: readonly string[];

  /** Every heading, in the order of the page. */
  readonly headings: readonly Heading[];

  /** Every row of every table, the heading row included. */
  readonly rows: readonly Row[];

  /** The text of every paragraph, heading, list item, table cell, and piece of raw HTML as a reader sees it, a code span in backticks. */
  readonly prose: readonly string[];
}

/** Read a page's Markdown. A link, a heading, or a table written inside a fenced block is text of that block and nothing else. */
export function readPage(markdown: string): Page {
  const spans: string[] = [];
  const blocks: Block[] = [];
  const links: string[] = [];
  const headings: Heading[] = [];
  const rows: Row[] = [];
  const prose: string[] = [];
  let cells: Cell[] = [];
  let held: string[] = [];

  // A code span sits in the paragraph, heading, list item, or cell that closes next, so each of those takes the spans held since the last one closed.
  const close = (text: string): string[] => {
    const inside = held;
    held = [];
    if (text.trim() !== "") prose.push(text);

    return inside;
  };
  const cell = (text: string): string => {
    const inside = close(text);
    cells.push({ spans: inside, rest: inside.reduce((rest, span) => rest.replace(`\`${span}\``, ""), text).trim() });

    return "";
  };
  const block = (text: string): string => {
    close(text);

    return "";
  };

  Bun.markdown.render(
    markdown,
    {
      codespan: (span) => {
        spans.push(span);
        held.push(span);

        return `\`${span}\``;
      },
      code: (text, meta) => {
        blocks.push({ language: meta?.language ?? "", text });

        return "";
      },
      link: (shown, meta) => {
        links.push(meta.href);

        return shown;
      },
      heading: (text, meta) => {
        close(text);
        headings.push({ level: meta.level, anchor: meta.id ?? "", text });

        return "";
      },
      paragraph: block,
      listItem: block,
      html: block,
      th: cell,
      td: cell,
      tr: () => {
        rows.push({ below: headings.length, cells });
        cells = [];

        return "";
      },
    },
    { tables: true, headings: { ids: true } },
  );

  return { spans, blocks, links, headings, rows, prose };
}
