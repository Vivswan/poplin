// One call of the API's query route, split back into the statements it joined: what a stand-in for that route runs on its own SQLite.
//
//   a statement   ends at a semicolon outside a quoted text; a trigger ends at the semicolon after its END
//   a number      bound as a real one, as D1's API binds it
//   placeholders  numbered over the whole call, and numbered anew from 1 in each statement

import type { SqlValue, Statement } from "@poplin/core/src/database/driver";

/** A quoted text or name, which is passed over, the end of a statement, or a numbered placeholder. */
const QUOTED_END_OR_PLACEHOLDER = /'(?:[^']|'')*'|"(?:[^"]|"")*"|;|\?(\d+)/g;

/** A trigger whose body is still open: its own statements end in semicolons that end no statement of the call. */
const OPEN_TRIGGER = /^\s*CREATE\s+TRIGGER\b(?![\s\S]*\bEND\s*$)/i;

/**
 * Split one call of the query route into its statements, each with the values its placeholders name.
 *
 * @param sql - one statement, or several joined by semicolons
 * @param params - the values of `?1`, `?2`, ... over the whole call; a placeholder past the list binds null
 */
export function statementsOf(sql: string, params: readonly SqlValue[]): Statement[] {
  const statements: Statement[] = [];
  let [text, values, from]: [string, SqlValue[], number] = ["", [], 0];
  const close = (upTo: number): void => {
    text += sql.slice(from, upTo);
    if (OPEN_TRIGGER.test(text)) {
      text += ";";

      return;
    }

    if (text.trim() !== "") statements.push({ sql: text, params: values });

    [text, values] = ["", []];
  };

  for (const found of sql.matchAll(QUOTED_END_OR_PLACEHOLDER)) {
    const [whole, digits] = found;
    if (whole === ";") {
      close(found.index);
      from = found.index + 1;
    }

    if (digits === undefined) continue;

    const value = params[Number(digits) - 1] ?? null;
    values.push(value);
    text += `${sql.slice(from, found.index)}${typeof value === "number" ? `CAST(?${values.length} AS REAL)` : `?${values.length}`}`;
    from = found.index + whole.length;
  }

  close(sql.length);

  return statements;
}
