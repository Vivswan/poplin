// The one way an error the Worker caught reaches Cloudflare's log: by its kind and the places in the code it passed through, never by its message.
//
// A message is written for whoever reads the code, so it may repeat a stored value: a site's id, a file's path, a key of the bucket. An unlisted or private site's id is its link, and the log is no place for one.

/** How a line of a stack names a place in the code. */
const FRAME = /^\s*at /;

/** The most places one line of the log names, nearest first. */
const MOST_FRAMES = 12;

function kindOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
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
 * Write one error line to the log for an error the Worker caught.
 *
 * @param what - what failed, in fixed words that hold no value of a request or a record
 * @param error - whatever was thrown; its message, and the message of its cause, are left out
 */
export function logFault(what: string, error: unknown): void {
  const cause = error instanceof Error && error.cause !== undefined ? `, caused by ${kindOf(error.cause)}` : "";

  console.error([`poplin: ${what} (${kindOf(error)}${cause})`, ...framesOf(error)].join("\n"));
}
