// The one way an error the Worker caught reaches Cloudflare's log: as an error of fixed words that keeps the places in the code the caught one passed through, and nothing of its message.
//
// Cloudflare maps the places of an error a run throws back to the source's files and lines, from the uploaded source map. A stack written as text is never mapped, so the places travel on an error.
//
// A message is written for whoever reads the code, so it may repeat a stored value: a site's id, a file's path, a key of the bucket. An unlisted or private site's id is its link, and the log is no place for one.

/** How a line of a stack names a place in the code. */
const FRAME = /^\s*at /;

/** The most places a fault keeps, nearest first. */
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
 * Make the error that stands for one the Worker caught.
 *
 * @param what - what failed, in fixed words that hold no value of a request or a record
 * @param error - whatever was thrown; its message, its cause, and its cause's message are left out
 * @returns an error whose message is `what` with the kind of the caught error and of its cause, and whose stack holds the caught error's places
 */
export function faultOf(what: string, error: unknown): Error {
  const cause = error instanceof Error && error.cause !== undefined ? `, caused by ${kindOf(error.cause)}` : "";
  const fault = new Error(`poplin: ${what} (${kindOf(error)}${cause})`);
  fault.stack = [`${fault.name}: ${fault.message}`, ...framesOf(error)].join("\n");

  return fault;
}

/** Write the fault of an error the Worker caught and answers itself to the log, as an error and not as text. */
export function logFault(what: string, error: unknown): void {
  console.error(faultOf(what, error));
}
