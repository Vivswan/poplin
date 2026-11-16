// A ceiling on the bucket writes and lists one step of a live run asks the install for. R2 bills each past a million a month, and nothing at Cloudflare stops at a number.
//
//   PUT    /api/uploads/:upload/file     a write         GET    /api/uploads/:upload              a list
//   POST   /api/uploads/:upload/finish   a list          DELETE /api/uploads/:upload              a list
//   DELETE /api/sites/:site              a list          POST   /api/sites/:site/duplicate        a list
//   PUT    any path outside the API      a write         GET    /api/export/sites/:site/files     a list
//
// Each such request counts as one before it is sent; a file the bucket itself refused, outside the API, is taken off the count again: the bucket bills no request it refuses.
// A request past the ceiling is not sent, and every one after it: each is answered here as refused.
// The refusal is a 403, which the CLI does not send again: a request that got no answer is one it sends again after a pause. The count is the harness's own: the install lists once more for every thousand files, and a move to the trash lists nothing.

import type { Api } from "@poplin/app/src/api/api";
import type { ExtractSchema } from "hono/types";

import type { Fetch } from "../../../../cli/src/client/client";

/** The routes whose every request makes the install write to the bucket or list it. One the app does not declare does not compile. */
const SPENDING = [
  { method: "PUT", path: "/api/uploads/:upload/file" },
  { method: "GET", path: "/api/uploads/:upload" },
  { method: "POST", path: "/api/uploads/:upload/finish" },
  { method: "DELETE", path: "/api/uploads/:upload" },
  { method: "DELETE", path: "/api/sites/:site" },
  { method: "POST", path: "/api/sites/:site/duplicate" },
  { method: "GET", path: "/api/export/sites/:site/files" },
] as const satisfies readonly Declared[];

/** The routes a run sends beside its files that spend nothing at the bucket: handing out tickets makes no call to the store. */
const FREE = [{ method: "POST", path: "/api/uploads/:upload/tickets" }] as const satisfies readonly Declared[];

/** The method and the path of each spending route, as a request is matched against them. */
const MATCHERS = SPENDING.map(({ method, path }) => ({ method, path: new URLPattern({ pathname: path }) }));

/** The same of each route that spends nothing. */
const FREE_MATCHERS = FREE.map(({ method, path }) => ({ method, path: new URLPattern({ pathname: path }) }));

/** The most bucket writes and lists a step may ask for: the checks, those with the job's copy, those with two thousand files, the reset, the upgrade. `orphans`: the most lists and deletes to remove files no record names. */
export const CEILINGS = { checks: 150, jobCopy: 300, manyFiles: 2300, reset: 150, orphans: 300, upgrade: 40, load: 80 } as const;

/** Where the API answers. */
const API = "/api/";

/** The status a held-back request is answered with. */
const HELD_BACK = 403;

/** The paths the app declares, each with the methods it takes. */
type Paths = ExtractSchema<Api>;

/** The method a route is declared under, as a request names it. */
type MethodOf<Key> = Key extends `$${infer Method}` ? Uppercase<Method> : never;

/** One route the app declares: its method and its path. */
export type Declared = { [Path in keyof Paths & string]: { readonly method: MethodOf<keyof Paths[Path]>; readonly path: Path } }[keyof Paths & string];

/** A `fetch` that counts, and what it counted. */
interface Meter {
  /** Sends a request, unless it would pass the ceiling. */
  readonly fetch: Fetch;

  /** How many bucket writes and lists were asked for. */
  readonly spent: () => number;

  /** What stopped the step, as the end of a sentence, once a request was held back; `undefined` while none was. */
  readonly stopped: () => string | undefined;
}

/** Whether a request is a file on its way to the bucket itself: no site and no page of the install takes a PUT, so one outside the API is. */
function isSentAway(input: string, init: RequestInit): boolean {
  return init.method === "PUT" && !new URL(input).pathname.startsWith(API);
}

function spends(input: string, init: RequestInit): boolean {
  const method = init.method ?? "GET";

  return MATCHERS.some((matcher) => matcher.method === method && matcher.path.test(input));
}

/**
 * Say whether a request is one the install answers without a call to the bucket, whatever another request on its way meanwhile makes the bucket do.
 *
 * @returns `true` for a request to a route of `FREE`
 */
export function spendsNothing(input: string, init: RequestInit): boolean {
  const method = init.method ?? "GET";

  return FREE_MATCHERS.some((matcher) => matcher.method === method && matcher.path.test(input));
}

/**
 * Count the bucket writes and lists a step asks an install for, and hold back every request past a ceiling.
 *
 * @param ceiling - the most writes and lists the step may ask for
 * @returns the counting `fetch`; a request it holds back reaches nothing and is answered 403, in the API's own form of a refusal
 */
export function meterBucket(fetch: Fetch, ceiling: number): Meter {
  let spent = 0;
  let over = false;

  return {
    fetch: async (input, init) => {
      const away = isSentAway(input, init);
      if (!away && !spends(input, init)) return fetch(input, init);

      if (spent >= ceiling) {
        over = true;

        return Response.json({ error: { code: "forbidden", message: `Held back: past the ceiling of ${ceiling} bucket writes and lists.` } }, { status: HELD_BACK });
      }

      // Counted before it is sent, so requests on their way together cannot pass the ceiling between them; a file the bucket refused is taken off again.
      spent += 1;
      const answer = await fetch(input, init);
      if (away && !answer.ok) spent -= 1;

      return answer;
    },
    spent: () => spent,
    stopped: () => (over ? `passed its ceiling of ${ceiling} bucket writes and lists` : undefined),
  };
}
