// What stands in Cloudflare's log for an error the Worker caught: an error of fixed words that keeps the places in the code the caught one passed through. `logFault` writes its words as a line of text first; a fault that is thrown goes as the error alone.
//
//   poplin: a request failed (Error): D1_ERROR, no such table, SQLITE_ERROR      the line `logFault` writes: what failed, the kind of the caught error and of its cause, and the listed words its message holds
//   Error: poplin: a request failed (Error): D1_ERROR, no such table, SQLITE_ERROR
//       at D1Driver.batch (...)                                                  the error: Cloudflare's log keeps its places and drops the line above them
//
// Cloudflare maps the places of an error a run throws back to the source's files and lines, from the uploaded source map. A stack written as text is never mapped, so the places travel on an error.
//
// A message is written for whoever reads the code, so it may repeat a stored value: a site's id, a file's path, a key of the bucket. An unlisted or private site's id is its link, and the log is no place for one.
// So nothing of a message is repeated but the words of `LISTED_WORDS` it holds, whoever wrote the message: each is written here, whole, and none is read from the message.

/** How a line of a stack names a place in the code. */
const FRAME = /^\s*at /;

/** The most places a fault keeps, nearest first. */
const MOST_FRAMES = 12;

/** The most listed words a fault repeats. */
const MOST_WORDS = 6;

/** The only words of a caught message a fault repeats, found in a message of the database or of any other code. They are the codes D1 and its SQLite name a failure by, and the fixed parts of what they say: no name of a table, no statement, no value. */
const LISTED_WORDS: readonly string[] = [
  "D1_ERROR", "D1_EXEC_ERROR", "D1_TYPE_ERROR", "D1_COLUMN_NOTFOUND",
  "SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_FOREIGNKEY", "SQLITE_CONSTRAINT_NOTNULL", "SQLITE_CONSTRAINT_CHECK", "SQLITE_CONSTRAINT_TRIGGER", "SQLITE_CONSTRAINT",
  "SQLITE_ERROR", "SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_FULL", "SQLITE_TOOBIG", "SQLITE_AUTH", "SQLITE_MISMATCH", "SQLITE_READONLY", "SQLITE_CORRUPT", "SQLITE_ABORT", "SQLITE_INTERRUPT", "SQLITE_RANGE", "SQLITE_SCHEMA",
  "no such table", "no such column", "no such index", "syntax error", "already exists", "has no column named", "too many SQL variables", "string or blob too big", "datatype mismatch", "database is locked",
  "UNIQUE constraint failed", "NOT NULL constraint failed", "FOREIGN KEY constraint failed", "CHECK constraint failed", "not authorized", "not found", "does not exist",
  "No SQL statements detected", "maximum account storage limit", "Exceeded maximum DB size", "daily row read limit", "daily row write limit", "reset because its code was updated",
  "Internal error while starting up D1 DB storage", "Internal error in D1 DB storage", "Network connection lost", "Replica disconnected from primary", "Cannot resolve D1 DB due to transient issue on remote node",
  "client disconnected", "storage operation exceeded timeout", "D1 DB is overloaded", "Requests queued for too long", "Too many requests queued", "Too many resources consumed",
  "exceeded its memory limit", "exceeded its CPU time limit", "maximum response size limit",
];

/** Finds each listed word in a text, a longer one before a shorter one it holds. */
const WORDS = new RegExp([...LISTED_WORDS].sort((one, other) => other.length - one.length).join("|"), "g");

function kindOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** The listed words that the message of an error holds, and the message of its cause, in the order they stand in, each once. Older runtimes put D1's sentence in the cause. */
function wordsOf(error: unknown): readonly string[] {
  if (!(error instanceof Error)) return [];

  const cause = error.cause instanceof Error ? error.cause.message : "";

  return [...new Set(`${error.message}\n${cause}`.match(WORDS))].slice(0, MOST_WORDS);
}

/** The places in the code a stack names. A stack starts with the error's message, which may itself hold lines that read as places, so only what follows the whole message is read; a stack that does not hold it gives none. */
function framesOf(error: unknown): readonly string[] {
  if (!(error instanceof Error) || error.stack === undefined) return [];

  const told = error.stack.indexOf(error.message);
  if (told < 0) return [];

  return error.stack
    .slice(told + error.message.length)
    .split("\n")
    .filter((line) => FRAME.test(line))
    .slice(0, MOST_FRAMES);
}

/**
 * Make the error that stands for one the Worker caught.
 *
 * @param what - what failed, in fixed words that hold no value of a request or a record
 * @param error - whatever was thrown; its message, its cause, and its cause's message are left out, but for the listed words they hold
 * @returns an error whose message is `what` with the kind of the caught error and of its cause, then those words, and whose stack is that message's line and the caught error's places
 */
export function faultOf(what: string, error: unknown): Error {
  const cause = error instanceof Error && error.cause !== undefined ? `, caused by ${kindOf(error.cause)}` : "";
  const words = wordsOf(error);
  const said = words.length === 0 ? "" : `: ${words.join(", ")}`;
  const fault = new Error(`poplin: ${what} (${kindOf(error)}${cause})${said}`);
  fault.stack = [`${fault.name}: ${fault.message}`, ...framesOf(error)].join("\n");

  return fault;
}

/** Write the fault of an error the Worker caught and answers itself to the log: its words as a line of text, which the log keeps whole, then the fault as an error and not as text, for its places. */
export function logFault(what: string, error: unknown): void {
  const fault = faultOf(what, error);
  console.error(fault.message);
  console.error(fault);
}
