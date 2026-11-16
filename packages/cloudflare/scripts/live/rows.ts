// A ceiling on the rows one step of a live run makes the install write to its database. D1's Free plan takes 100,000 rows written a day, every database of the account together, and refuses each write past them until midnight UTC.
//
//   POST   /api/uploads                    a new site 20, and 19 where it is told never to run out; a new version 13, and what the settings it asks for cost as a change: the begin and its finish together
//   POST   /api/uploads/:upload/finish     2 where the publish dropped older versions and 2 for each of them, once its answer says how many
//   POST   /api/import/sites               a site with one version 19, 2 for each version more, and 1 where it runs out and is in no trash
//   DELETE /api/sites/:site                to the trash 6, for good 13
//   PATCH  /api/sites/:site                who may open it 3, any other setting 2, both 5, and 1 where it is told an expiry
//   POST   /api/sites/:site/new-link 9     POST /api/sites/:site/restore 6    POST /api/sites/:site/rollback 2
//   POST   /api/sites/:site/duplicate      the request that begins a copy 21, each one that goes on with it 16
//   PATCH  /api/config 5                   POST /api/logins 3                 DELETE /api/uploads/:upload 3
//   GET    /api/uploads/:upload 1          GET /api/export/sites/:site/files 1
//   GET    a page or a file of a site      2, once it is answered 200 or 304
//
// D1 counts an index entry and a row a trigger writes as rows, so one new site is 8 of them. Each price is the most its request writes for a site a run made, and is counted before the request is sent.
// A site that runs out has one entry more, in the index of expiries, written when it is told an expiry and when it leaves the trash: a restore is counted as if its site ran out, as every site of the checks does.
// A visit is counted once it is answered, since only the answer says that a site was served, and so is a dropped version. Once a step is stopped, no further request for a site's address is sent.
// A served site's refusal or missing file writes the same two rows and is not counted: its status is that of an address no site holds.
// A request that would pass the ceiling is not sent, and every one after it: each is answered here as refused, with a 403, which the CLI does not send again.
// A request that changes something on a route with no price is refused the same way, so a check that grows a new kind of write stops red until it has one.
// The count is the harness's own, not the database's. The sweep later drops the row of each finished upload, 5 rows more, which no request of a run makes.

import type { Fetch } from "../../../cli/src/client/client";
import type { Declared } from "./budget";

/** The rows of a new site, from its first request to its finish: the site and its first version 8, the upload 6, the day's counts 2, the version's size 2, and the log 1. */
const NEW_SITE = 19;

/** The rows of a new version of a site, from its first request to its finish, where it drops no older one. */
const NEW_VERSION = 13;

/** The rows a publish adds that drops older versions: 2 for the list of what it dropped and its listing of the bucket, and 2 for each version. One is dropped while an install keeps as many as it did, more once it was told to keep fewer. */
const DROPPED = { any: 2, each: 2 } as const;

/** The rows of a site put back from a backup with one version. */
const IMPORTED_SITE = 19;

/** The rows each further version of a site put back from a backup adds. */
const IMPORTED_VERSION = 2;

/** The row a site's entry in the index of expiries is: written when a site is told an expiry, and again when one that runs out leaves the trash. */
const EXPIRY = 1;

/** The rows of a copy of a site: the request that begins it is counted as one that makes the copy whole, and each request that goes on with it as the one that finishes it. */
const COPIED = { begun: 21, goneOn: 16 } as const;

/** The rows of a site moved to the trash, and of one removed for good with the three versions an install keeps and a day's count of its own. */
const REMOVED = { trash: 6, forever: 13 } as const;

/** The rows of a change to a site: of who may open it, and of any other setting. Both are written where a request asks for both. */
const CHANGED = { access: 3, details: 2 } as const;

/** The keys of a change that say who may open a site. */
const ACCESS_KEYS: ReadonlySet<string> = new Set(["access", "public_name"]);

/** The keys of a publish that ask no setting of its site: which site it is, its files, and the title of its entry page, which a version's own rows hold. */
const NO_SETTING: ReadonlySet<string> = new Set(["site", "files", "page_title"]);

/** The rows a visit writes that a site answered with a page or a file: the day's count of the site, and of all sites. */
const VISIT = 2;

/** The answers of a site that count as a request of its day. */
const SERVED: ReadonlySet<number> = new Set([200, 304]);

/** The methods that change nothing. */
const READS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** Where the API answers, under the admin hostname. */
const API = "/api/";

/** Where the edge itself answers on every hostname, with no request to the install. */
const EDGE = "/cdn-cgi/";

/** The status a held-back request is answered with. */
const HELD_BACK = 403;

/** The routes whose requests make the install write rows, each with the most rows one request writes. One the app does not declare does not compile. */
const PRICES = [
  { method: "POST", path: "/api/uploads", rows: (asked) => (asked.body.site === undefined ? NEW_SITE + inheritedExpiryRows(asked.body) : NEW_VERSION + changeRows(settingsOf(asked.body))) },
  { method: "POST", path: "/api/import/sites", rows: (asked) => IMPORTED_SITE + IMPORTED_VERSION * (versionsIn(asked.body) - 1) + importedExpiryRows(asked.body.site) },
  { method: "POST", path: "/api/uploads/:upload/tickets", rows: () => 0 },
  { method: "PUT", path: "/api/uploads/:upload/file", rows: () => 0 },
  { method: "POST", path: "/api/uploads/:upload/finish", rows: () => 0 },
  { method: "GET", path: "/api/uploads/:upload", rows: () => 1 },
  { method: "DELETE", path: "/api/uploads/:upload", rows: () => 3 },
  { method: "DELETE", path: "/api/sites/:site", rows: (asked) => (asked.query.get("forever") === "true" ? REMOVED.forever : REMOVED.trash) },
  { method: "PATCH", path: "/api/sites/:site", rows: (asked) => changeRows(asked.body) },
  { method: "POST", path: "/api/sites/:site/restore", rows: () => 5 + EXPIRY },
  { method: "POST", path: "/api/sites/:site/new-link", rows: () => 9 },
  { method: "POST", path: "/api/sites/:site/rollback", rows: () => 2 },
  { method: "POST", path: "/api/sites/:site/duplicate", rows: (asked) => (asked.body.upload === undefined ? COPIED.begun : COPIED.goneOn) },
  { method: "PATCH", path: "/api/config", rows: () => 5 },
  { method: "POST", path: "/api/logins", rows: () => 3 },
  { method: "GET", path: "/api/export/sites/:site/files", rows: () => 1 },
] as const satisfies readonly (Declared & { readonly rows: (asked: Asked) => number })[];

/** The route whose answer says how many versions a publish dropped. */
const FINISH = new URLPattern({ pathname: "/api/uploads/:upload/finish" });

/** The method and the path of each priced route, as a request is matched against them. */
const MATCHERS = PRICES.map(({ method, path, rows }) => ({ method, path: new URLPattern({ pathname: path }), rows }));

/** The most rows each step of a run may make the install write: the checks, and the reset when it keeps no sample. */
export const ROW_CEILINGS = { checks: 1100, reset: 600 } as const;

/** What a price reads of a request: its query, and its JSON body, empty for a request that carries none. */
interface Asked {
  readonly query: URLSearchParams;
  readonly body: Readonly<Record<string, unknown>>;
}

/** A `fetch` that counts, and what it counted. */
interface Meter {
  /** Sends a request, unless it would pass the ceiling or has no price. */
  readonly fetch: Fetch;

  /** How many rows the requests sent so far write at most. */
  readonly written: () => number;

  /** What stopped the step, as the end of a sentence, once a request was held back; `undefined` while none was. */
  readonly stopped: () => string | undefined;
}

/** How many versions a site holds as a request or an answer names it; none for a value that is no site with such a list. */
function versionsOf(site: unknown): number {
  const versions: unknown = typeof site === "object" && site !== null && "versions" in site ? site.versions : undefined;

  return Array.isArray(versions) ? versions.length : 0;
}

/** How many versions the site of an import carries; one for a body that names none. */
function versionsIn(body: Asked["body"]): number {
  return Math.max(1, versionsOf(body.site));
}

/** The row a request writes that tells a site when it runs out; none for a request that names no expiry, or says never. */
function expiryRows(body: Asked["body"]): number {
  return typeof body.expires === "string" && body.expires !== "never" ? EXPIRY : 0;
}

/** The row a new site writes for its expiry: none where its request says never. One that names no expiry takes the install's own, which no request shows, so it is counted as if that were one. */
function inheritedExpiryRows(body: Asked["body"]): number {
  return body.expires === "never" ? 0 : EXPIRY;
}

/** The settings a publish asks of its site: its request without what names the site and its files. */
function settingsOf(body: Asked["body"]): Asked["body"] {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !NO_SETTING.has(key)));
}

/** The row a site put back from a backup writes for its expiry: a backup holds the moment, and a site in the trash has no entry. */
function importedExpiryRows(site: unknown): number {
  if (typeof site !== "object" || site === null || !("expires" in site) || !("state" in site)) return 0;

  return typeof site.expires === "number" && site.state !== "trash" ? EXPIRY : 0;
}

/** The rows of a change to a site, by what it asks for: who may open it, any other setting, or both, and the expiry's entry where it names one. */
function changeRows(body: Asked["body"]): number {
  const keys = Object.keys(body);
  const access = keys.some((key) => ACCESS_KEYS.has(key)) ? CHANGED.access : 0;
  const details = keys.some((key) => !ACCESS_KEYS.has(key)) ? CHANGED.details : 0;

  return access + details + expiryRows(body);
}

/** The JSON object a request carries; empty for a body that is none, such as a file's bytes. */
function bodyOf(init: RequestInit): Asked["body"] {
  if (typeof init.body !== "string") return {};

  try {
    const body: unknown = JSON.parse(init.body);

    return typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body } : {};
  } catch {
    return {};
  }
}

/** The rows a finished publish wrote for the older versions it dropped, read from a copy of its answer: the site before it, one version more, less the site after it. None for a new site, and for an answer that is no publish. */
async function droppedRows(answer: Response): Promise<number> {
  const published: unknown = await answer
    .clone()
    .json()
    .catch(() => undefined);
  if (typeof published !== "object" || published === null || !("before" in published) || !("site" in published) || published.before === null) return 0;

  const dropped = versionsOf(published.before) + 1 - versionsOf(published.site);

  return dropped > 0 ? DROPPED.any + DROPPED.each * dropped : 0;
}

/** Whether a request may be a visit of a site: a read of an address outside the API that the edge does not answer itself. */
function mayVisit(input: string, init: RequestInit): boolean {
  const { pathname } = new URL(input);

  return (init.method ?? "GET") === "GET" && !pathname.startsWith(API) && !pathname.startsWith(EDGE);
}

function refusal(message: string): Response {
  return Response.json({ error: { code: "forbidden", message } }, { status: HELD_BACK });
}

/**
 * Say how many rows a request to the API makes an install write, at most.
 *
 * @returns the rows; 0 for a request that reads; `undefined` for one that changes something on a route with no price
 */
function rowsOf(input: string, init: RequestInit): number | undefined {
  const method = init.method ?? "GET";
  const url = new URL(input);
  const priced = MATCHERS.find((matcher) => matcher.method === method && matcher.path.test(input));
  if (priced !== undefined) return priced.rows({ query: url.searchParams, body: bodyOf(init) });

  return READS.has(method) || !url.pathname.startsWith(API) ? 0 : undefined;
}

/**
 * Count the rows a step makes an install write, and hold back every request past a ceiling, and every request of a kind that has no price.
 *
 * @param ceiling - the most rows the step may make the install write
 * @returns the counting `fetch`; a request it holds back reaches nothing and is answered 403, in the API's own form of a refusal
 */
export function meterRows(fetch: Fetch, ceiling: number): Meter {
  let written = 0;
  let stopped: string | undefined;

  return {
    fetch: async (input, init) => {
      const rows = rowsOf(input, init);
      if (rows === undefined) stopped ??= `sent ${init.method} to a route of the API that has no price in rows`;

      if (rows !== undefined && written + rows > ceiling) stopped ??= `passed its ceiling of ${ceiling} rows written to the database`;

      // A read of the API goes out after the stop too: the step's own listings read the install. A visit of a site would write its rows.
      const visit = mayVisit(input, init);
      if (stopped !== undefined && (rows !== 0 || visit)) return refusal(`Held back: the step ${stopped}.`);

      written += rows ?? 0;
      const answer = await fetch(input, init);
      if (visit && SERVED.has(answer.status)) written += VISIT;

      if (init.method === "POST" && FINISH.test(input) && answer.ok) written += await droppedRows(answer);

      // A visit and a finish are sent before their rows are known, so the one that passes the ceiling went out: the step stops with the next request.
      if (written > ceiling) stopped ??= `passed its ceiling of ${ceiling} rows written to the database`;

      return answer;
    },
    written: () => written,
    stopped: () => stopped,
  };
}
