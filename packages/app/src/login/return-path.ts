// Where a visitor goes after the login: back to the dashboard path or the site address they came from, and never anywhere else.
//
//   /sites?sort=new                               a dashboard path: one slash, then visible ASCII only
//   https://report--k3f9x2ab71qz-p-poplin.example.com/a   an address the install's layout reads as one of its own
//
// Neither form holds a second slash to start a host, a backslash a browser reads as one, or a control character a parser drops.

import type { SiteAddresses } from "../sites/addresses";

/** Where every refused return goes: the dashboard's first page. */
const ROOT = "/";

/** The most characters a return holds. */
const MAX_LENGTH = 2048;

/** An origin no dashboard has, to resolve a path against and see that it stays one. */
const BASE = "https://dashboard.invalid";

/** One slash, no second slash or backslash after it, then visible ASCII without a backslash. */
const LOCAL_PATH = /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/;

/** `https`, a host of lowercase letters, digits, dots, and dashes, then a path: so no userinfo, no port, and no capital a parser would fold. */
const SITE_ADDRESS = /^https:\/\/([a-z0-9.-]+)\/[\x21-\x5b\x5d-\x7e]*$/;

function dashboardPath(target: string): string | undefined {
  if (!LOCAL_PATH.test(target)) return undefined;

  const url = URL.parse(target, BASE);
  if (url === null || url.origin !== BASE) return undefined;

  // Dot segments resolve away, and `/.//host` would come out as `//host`.
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!LOCAL_PATH.test(path)) return undefined;

  return path;
}

function siteAddress(target: string, addresses: Pick<SiteAddresses, "resolve">): string | undefined {
  const [, host] = SITE_ADDRESS.exec(target) ?? [];
  if (host === undefined) return undefined;

  // The host must be the one written: a parser rewrites a numeric host, and may one day rewrite another.
  const url = URL.parse(target);
  if (url === null || url.origin !== `https://${host}`) return undefined;

  if (addresses.resolve(url).kind === "none") return undefined;

  return url.href;
}

/**
 * Turn the place a visitor asked to return to into a location that is safe to send them to.
 *
 * @param target - untrusted, already decoded from the query once; absent when none was asked for
 * @returns a dashboard path with its query and fragment, the `https` address of something the install's layout addresses, or `/` for anything else
 */
export function safeReturn(target: string | null | undefined, addresses: Pick<SiteAddresses, "resolve">): string {
  if (target === null || target === undefined || target.length > MAX_LENGTH) return ROOT;

  return dashboardPath(target) ?? siteAddress(target, addresses) ?? ROOT;
}
