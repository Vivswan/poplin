// Where a visitor goes after the login: back to the dashboard path they came from, and never anywhere else.
//
// A path is one slash, then visible ASCII only: no second slash to start a host, no backslash a browser reads as one, no control character a parser drops.

const ROOT = "/";
const MAX_LENGTH = 2048;
const BASE = "https://dashboard.invalid";
const LOCAL_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;

/**
 * Turn the place a visitor asked to return to into a path on the dashboard.
 *
 * @param target - untrusted, already decoded from the query once; absent when none was asked for
 * @returns the path with its query and fragment, or `/` for anything that is not a plain path of the dashboard's own origin
 */
export function safeReturnPath(target: string | null | undefined): string {
  if (target === null || target === undefined) return ROOT;

  if (target.length > MAX_LENGTH || !LOCAL_PATH.test(target)) return ROOT;

  const url = URL.parse(target, BASE);
  if (url === null || url.origin !== BASE) return ROOT;

  // Dot segments resolve away, and `/.//host` would come out as `//host`.
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!LOCAL_PATH.test(path)) return ROOT;

  return path;
}
