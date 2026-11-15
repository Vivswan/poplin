// What a route checks before its handler runs, beside who asks and the query: the count of a request that takes no token, the content type, the site its path names, and the JSON it carries.

import type { Install } from "@poplin/core/src/actions/records";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import { siteReference } from "@poplin/core/src/sites/labels";
import type { Handler, MiddlewareHandler } from "hono";
import type { BlankEnv } from "hono/types";

import type { Counters, Taken } from "../limits/limits";
import { hasContentType, readJson } from "./body";
import { refusal, respond } from "./respond";

/** The most requests one visitor may send a minute to each route that takes no token. A terminal asks for its token twelve times a minute. The pace alone bounds no visitor's waiting logins: core keeps three of each. */
const OPEN_PER_MINUTE = { beginLogin: 5, redeemLogin: 25 } as const;

/** The most logins all visitors together may begin a minute. A day then begins 7,200 at most: 28,800 rows written and 417,600 read, under a third of what a free day of the database takes. */
const STARTS_PER_MINUTE = 5;

/** What a counter that cannot answer is taken to say: the minute is full. A login is the guess the count exists to stop, so it is refused where a request for a site is let through. */
const UNCOUNTED = { ok: false, retryAfterSeconds: 60 } as const;

/** A route that takes no token: a computer calls it to get one. */
type OpenName = keyof typeof OPEN_PER_MINUTE;

/** What a request to a route that takes no token holds once it is counted: the key its visitor is counted by. */
interface Counted {
  readonly Variables: { readonly visitor: string };
}

/** What counting a request needs: the clock, where a visitor's requests are counted, and what names a visitor. */
export interface Gate extends Pick<Install, "now"> {
  /** Where the requests to the routes that take no token are counted, a minute at a time. */
  readonly counters: Pick<Counters, "takeMinute">;

  /** The key one visitor's requests are counted by: `visitorKey` of the address the host itself saw, never of a header a visitor can set. */
  readonly visitorOf: (request: Request) => Promise<string>;
}

/** Count one request to a route that takes no token: against its visitor's minute, and a login that fits there against the minute of all logins begun. */
async function takeOpen(name: OpenName, request: Request, gate: Gate): Promise<Taken & { readonly visitor: string }> {
  const visitor = await gate.visitorOf(request);
  const own = await gate.counters.takeMinute({ scope: "visitor", key: `${name}:${visitor}`, limit: OPEN_PER_MINUTE[name] }, gate.now());
  if (!own.ok || name !== "beginLogin") return { ...own, visitor };

  return { ...(await gate.counters.takeMinute({ scope: "install", key: name, limit: STARTS_PER_MINUTE }, gate.now())), visitor };
}

/**
 * Let a request on to a route that takes no token, once it is counted.
 *
 * @returns the middleware, which keeps the visitor's key for the handler, or answers `too_many_requests` with `Retry-After`
 */
export function counted(name: OpenName, gate: Gate): MiddlewareHandler<Counted> {
  return async (context, next) => {
    const taken = await takeOpen(name, context.req.raw, gate).catch((error: unknown) => {
      // A database that is spent for the day is told as that, never as a full minute.
      if (error instanceof AllowanceSpent) throw error;

      return UNCOUNTED;
    });
    if (!taken.ok) return refusal("too_many_requests", undefined, { "Retry-After": String(Math.max(1, Math.ceil(taken.retryAfterSeconds))) });

    context.set("visitor", taken.visitor);

    return next();
  };
}

/**
 * Let a request on whose body is of the content type its route takes.
 *
 * @returns the middleware, which answers `unsupported_media_type` for any other
 */
export function carries(sends: "json" | "bytes"): MiddlewareHandler {
  return async (context, next) => (hasContentType(context.req.raw, sends) ? next() : refusal("unsupported_media_type"));
}

/**
 * Let a request on whose path names a site in the form of a site reference.
 *
 * @returns the middleware, which answers `bad_argument` about `site` for any other
 */
export function namesSite(): MiddlewareHandler {
  return async (context, next) => (siteReference(context.req.param("site") ?? "").ok ? next() : refusal("bad_argument", "site"));
}

/**
 * Read the JSON a request carries, up to a cap.
 *
 * `Body` is what a client is typed to send. The value itself is checked by the route's action, never here.
 *
 * @param maxBytes - the most bytes the body may hold
 * @returns the middleware, which hands the handler the parsed value as `valid("json")`, or answers `too_large` or `bad_argument` about `body`
 */
export function sent<Body>(maxBytes: number): Handler<BlankEnv, string, { in: { json: Body }; out: { json: unknown } }> {
  return async (context, next) => {
    const read = await readJson(context.req.raw, maxBytes);
    if (!read.ok) return respond(read);

    context.req.addValidatedData("json", read.value as object);

    return next();
  };
}
