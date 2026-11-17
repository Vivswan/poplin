// The addresses a page's markup holds, found by a parser: text that only looks like an attribute, in a `pre` or a script, is left as it is.
//
//   <a href='/a'>  <img src="/b.png">  <video poster=/c.png>     each address is handed to `rewrite`
//   <pre>href="/d"</pre>  <script>x = 'href="/e"'</script>        no attribute, so nothing is

import { Parser } from "htmlparser2";

/** The attributes that hold one address. */
const ADDRESS_ATTRIBUTES = new Set(["href", "xlink:href", "action", "formaction", "src", "poster"]);

/** One change to a page's text: what stands between two offsets of it afterwards. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Rewrite every address in the attributes of a page.
 *
 * @param rewrite - gives the address to write for one the page holds, as the page wrote it, entities and all; the same text leaves it alone
 * @returns the page with only the moved addresses changed: every other byte of it, the quotes of an untouched attribute included, is the page's own.
 */
export function withAddresses(page: string, rewrite: (address: string) => string): string {
  const edits: Edit[] = [];
  const parser = new Parser(
    {
      onattribute: (name, value, quote) => {
        if (quote === undefined || !ADDRESS_ATTRIBUTES.has(name)) return;

        const next = rewrite(value);
        if (next === value) return;

        // The value is written in the quotes it had, so one of that kind inside it becomes its entity.
        const mark = quote ?? '"';
        const written = next.replaceAll(mark, mark === '"' ? "&quot;" : "&#39;");

        // The attribute ends at the parser's index: after the closing quote of a value that has one.
        const quotes = quote === null ? 0 : 2;
        edits.push({ start: parser.endIndex - value.length - quotes, end: parser.endIndex, text: `${mark}${written}${mark}` });
      },
    },
    { decodeEntities: false },
  );
  parser.end(page);

  let moved = "";
  let from = 0;
  for (const edit of edits) {
    moved += `${page.slice(from, edit.start)}${edit.text}`;
    from = edit.end;
  }

  return `${moved}${page.slice(from)}`;
}
