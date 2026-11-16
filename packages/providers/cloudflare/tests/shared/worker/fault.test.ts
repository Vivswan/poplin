import { describe, expect, test, vi } from "vitest";
import { faultOf, logFault } from "../../../src/shared/worker/fault";
import { BINDINGS } from "./support/install";

/** The id of a site nobody but its owner knows: the label its address begins with. */
const SITE = "quiet-harbor-meadow";

/** A table the database does not hold, and a login a statement on it is bound to. */
const [TABLE, LOGIN] = ["a_table_nobody_made", "ada@example.com"];

/** What one call of the log was given: a text as it is, an error as the first line of its stack. */
function given(call: readonly unknown[]): string[] {
  return call.map((value) => (value instanceof Error ? `error: ${(value.stack ?? "").split("\n")[0]}` : `text: ${String(value)}`));
}

/** Everything of a fault a log or a thrown error shows. */
function shown(fault: Error): string {
  return [fault.name, fault.message, fault.stack, String(fault.cause)].join("\n");
}

describe("faultOf", () => {
  // Drift: an error's message repeats stored values for whoever reads the code, and Cloudflare keeps every line for days. An unlisted or private site's id is its link, so one message in the log hands the site to whoever reads the log.
  test("an error whose message and whose cause's message name a site becomes one of fixed words with its kind, its cause's kind, and the places it was thrown at, and no cause or word of either message", () => {
    const thrown = new RangeError(`site ${SITE} is live at version 3, which is not kept`, { cause: new TypeError(`sites/${SITE}/index.html is no key`) });

    const fault = faultOf("a request failed", thrown);
    const [first, ...frames] = (fault.stack ?? "").split("\n");

    expect([fault.message, first, fault.cause]).toEqual(["poplin: a request failed (RangeError, caused by TypeError)", "Error: poplin: a request failed (RangeError, caused by TypeError)", undefined]);
    // The places are the caught error's own, so Cloudflare maps the line that failed and not the line that made the fault.
    expect(frames).toEqual((thrown.stack ?? "").split("\n").filter((line) => /^\s*at /.test(line)).slice(0, 12));
    expect(frames.length).toBeGreaterThan(0);
    expect(shown(fault)).not.toContain(SITE);
  });

  // Drift: a stack starts with the message, and a message may hold lines of its own; one that reads as a place in the code would pass for one.
  test("a message with a line that reads as a place in the code is left out whole", () => {
    const fault = faultOf("a request failed", new Error("a stored login is not a login\n    at owner@example.com (worker.js:1:1)"));

    expect([fault.message, shown(fault).includes("owner@example.com")]).toEqual(["poplin: a request failed (Error)", false]);
  });

  test.each([
    { name: "a text", thrown: `site ${SITE} failed`, stack: "Error: poplin: a request failed (string)" },
    { name: "nothing", thrown: undefined, stack: "Error: poplin: a request failed (undefined)" },
  ])("$name that was thrown becomes a fault of its type alone, with no place", ({ thrown, stack }) => {
    expect(faultOf("a request failed", thrown).stack).toBe(stack);
  });
});

describe("logFault", () => {
  // Drift: Cloudflare maps the places of an error to the source and never those of a text, so a fault written as its stack's text would name the bundle's one line for good.
  // Cloudflare's log kept an error's places and not the line above them, so a fault written as an error alone left a log that said neither what failed nor what was thrown.
  test("the fault is written twice: its words as a line of text, then as an error whose stack starts with those words", () => {
    using logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logFault("a request failed", new RangeError(`site ${SITE} failed`));

    expect(logged.mock.calls.map(given)).toEqual([["text: poplin: a request failed (RangeError)"], ["error: Error: poplin: a request failed (RangeError)"]]);
  });

  // Drift: a start that failed at the database logged ten places in the code and no word of what the database said, so the log could not tell a missing table from a database that was gone.
  test("an error the database itself threw is written with the database's codes and fixed words, and with no name of a table and no value of the statement", async () => {
    using logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const thrown: unknown = await BINDINGS.DB.prepare(`SELECT * FROM ${TABLE} WHERE login = ?`)
      .bind(LOGIN)
      .all()
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    logFault("a request failed", thrown);
    const written = logged.mock.calls.map(given);

    // What the database said, for whoever reads this test: its code, the fixed words, the table's name, and its engine's code.
    expect(thrown instanceof Error ? thrown.message : thrown).toBe(`D1_ERROR: no such table: ${TABLE}: SQLITE_ERROR`);
    expect(written).toEqual([["text: poplin: a request failed (Error, caused by Error): D1_ERROR, no such table, SQLITE_ERROR"], ["error: Error: poplin: a request failed (Error, caused by Error): D1_ERROR, no such table, SQLITE_ERROR"]]);
    expect(JSON.stringify(logged.mock.calls.map((call) => call.map((value) => (value instanceof Error ? shown(value) : value))))).not.toMatch(new RegExp(`${TABLE}|${LOGIN}`));
  });

  // Drift: the words are found in any message, so one that names a site beside a word of the database's must give the word alone.
  test("a message that holds a word of the database's beside a site's id gives the word, once, and nothing around it", () => {
    const fault = faultOf("a request failed", new Error(`site ${SITE} was not found, and ${SITE}/index.html was not found`, { cause: new Error(`UNIQUE constraint failed: sites.id: SQLITE_CONSTRAINT_UNIQUE (${SITE})`) }));

    expect([fault.message, shown(fault).includes(SITE)]).toEqual(["poplin: a request failed (Error, caused by Error): not found, UNIQUE constraint failed, SQLITE_CONSTRAINT_UNIQUE", false]);
  });
});
