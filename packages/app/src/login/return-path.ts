// Where a visitor goes after the login: back to the dashboard path they came from, and never anywhere else.
//
//   /sites?sort=new    a dashboard path: one slash, then visible ASCII only
//
// It holds no second slash to start a host, no backslash a browser reads as one, and no control character a parser drops.

/** Where every refused return goes: the dashboard's first page. */
const ROOT = "/";

/** The most characters a return holds. */
const MAX_LENGTH = 2048;

/** An origin no dashboard has, to resolve a path against and see that it stays one. */
const BASE = "https://dashboard.invalid";

/** One slash, no second slash or backslash after it, then visible ASCII without a backslash. */
const LOCAL_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;

/**
 * Turn the place a visitor asked to return to into a location that is safe to send them to.
 *
 * @param target - untrusted, already decoded from the query once; absent when none was asked for
 * @returns a dashboard path with its query and fragment, or `/` for anything else
 */
export function safeReturn(target: string | null | undefined): string {
  if (target === null || target === undefined || target.length > MAX_LENGTH || !LOCAL_PATH.test(target)) return ROOT;

  const url = URL.parse(target, BASE);
  if (url === null || url.origin !== BASE) return ROOT;

  // Dot segments resolve away, and `/.//host` would come out as `//host`.
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!LOCAL_PATH.test(path)) return ROOT;

  return path;
}
