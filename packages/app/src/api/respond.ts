// The one form every answer of the API takes: the JSON of a done action, or the error object with the HTTP status of its code.

import type { Refused } from "@poplin/core/src/actions/records";
import { type AllowanceSpent, secondsToNextDay } from "@poplin/core/src/database/driver";
import { type ApiError, STORED_TYPE_HEADER } from "@poplin/core/src/api/routes";
import type { TypedResponse } from "hono";

/** The HTTP status of every code an action or the API itself refuses with. A code missing here does not compile. */
const STATUS = {
  not_logged_in: 401,
  not_allowed: 403,
  not_found: 404,
  no_such_version: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  bad_argument: 400,
  bad_name: 400,
  reserved_name: 400,
  bad_path: 400,
  no_index: 400,
  size_mismatch: 400,
  hash_mismatch: 400,
  backup_too_new: 400,
  name_taken: 409,
  id_taken: 409,
  in_trash: 409,
  not_in_trash: 409,
  stale_version: 409,
  missing_files: 409,
  upload_finished: 409,
  too_many_sites: 409,
  not_set_up: 409,
  no_working_login: 409,
  needs_update_check: 409,
  already_a_login: 409,
  not_a_login: 404,
  no_update: 409,
  no_key: 409,
  key_refused: 409,
  lacks_right: 409,
  logins_not_ended: 409,
  too_large: 413,
  too_many_requests: 429,
  internal: 500,
  release_refused: 502,
  version_refused: 502,
  allowance_spent: 503,
  update_unreachable: 504,
} as const;

/** What each code means, for a person. No message quotes anything a request sent. */
const MESSAGES: Readonly<Record<Code, string>> = {
  not_logged_in: "no token was sent, or it is not a live token of this install",
  not_allowed: "this token may not do that",
  not_found: "there is no such thing here",
  no_such_version: "the site keeps no such version",
  method_not_allowed: "this address takes another method",
  unsupported_media_type: "the body is not of the content type this address takes",
  bad_argument: "an argument is missing, unknown, or of the wrong form",
  bad_name: "the name breaks the rules of a name",
  reserved_name: "the install keeps that public name for itself",
  bad_path: "a file's path is one no site can serve, or is given twice",
  no_index: "a site needs an index.html at its top",
  size_mismatch: "a file's bytes are not as many as its declared size",
  hash_mismatch: "a file's bytes are not the ones its declared hash names",
  backup_too_new: "the backup was made by a newer poplin than this install runs: update the install, then import",
  name_taken: "another site holds that public name",
  id_taken: "a site here already has that id",
  in_trash: "the site sits in the trash",
  not_in_trash: "the site is not in the trash",
  stale_version: "a newer publish of the site went live first",
  missing_files: "a declared file has not been uploaded",
  upload_finished: "the upload is finished and live",
  too_many_sites: "the install holds as many sites as it may",
  not_set_up: "the install is not set up",
  no_working_login: "the change would leave no login that works",
  needs_update_check: "auto_update is on only while update_check is on",
  already_a_login: "that email is a login already",
  not_a_login: "that email is no login",
  no_update: "no newer version is known to the install",
  no_key: "the install holds no key of its host, so it cannot update itself",
  key_refused: "the install's host no longer takes the install's key",
  lacks_right: "the install's key lacks this permission at its host",
  too_large: "a size limit is passed",
  too_many_requests: "the install is asked too often: wait, then ask again",
  internal: "the install failed to do that",
  release_refused: "the release cannot be taken, and nothing was changed, for this reason",
  version_refused: "the install's host refused the new version, so the install runs the version it ran before",
  logins_not_ended: "the install's provider did not end the dashboard's logins, or gave no answer",
  allowance_spent: "a day's allowance of the install is used up: ask again after midnight UTC",
  update_unreachable: "the install's provider did not answer the request to update",
};

/** The setting that bounds the times a day the store is written to or listed, which a refusal for it is about. */
const WRITES_SETTING = "max_storage_writes_per_day";

/** The form of a token, and of the secret of a computer's login, wherever one sits in a text. */
const TOKEN_SHAPE = /poplin_(?:login_)?[0-9a-f]{16}_[0-9a-f]{64}/i;

/** What goes on every response: no cache keeps it, and no browser guesses at its type. No header opens the API to another origin's scripts. */
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

/** What goes on the answer that is one stored file: it is bytes whatever the file is, so no browser renders a site's page under the API's address. */
const FILE_HEADERS = { ...HEADERS, "Content-Type": "application/octet-stream", "Content-Disposition": "attachment" } as const;

/** Every code a response may carry. */
export type Code = keyof typeof STATUS;

/** Every HTTP status a refusal of the API goes out with, each once. */
export const REFUSAL_STATUSES: readonly number[] = [...new Set<number>(Object.values(STATUS))];

/**
 * Read the HTTP status of a refusal's code, for anything that answers a refusal outside the API and must send the status the API sends.
 *
 * @returns `undefined` for a code the API never answers
 */
export function statusOf(code: string): (typeof STATUS)[Code] | undefined {
  return Object.hasOwn(STATUS, code) ? STATUS[code as Code] : undefined;
}

/** What a handler answers: a done action, or a refusal with one of the codes. */
export type Result<Done> = ({ readonly ok: true } & Done) | Refused<Code>;

/** The body of a done answer: what the action answered, less its `ok`. */
type Body<Answer> = Answer extends { readonly ok: true } ? Omit<Answer, "ok"> : never;

/** The response of a refusal, typed for a client by its body. */
export type Refusal = Response & TypedResponse<ApiError, (typeof STATUS)[Code], "json">;

/** The codes an answer may refuse with. */
type RefusedCode<Answer> = Answer extends { readonly ok: false; readonly code: infer Refusing } ? Refusing : never;

/** The clock `respond` takes: asked for where the answer may be `allowance_spent`, and not taken anywhere else. */
type Clock<Answer> = "allowance_spent" extends RefusedCode<Answer> ? [now: number] : [];

/** The response of a handler's answer, typed for a client by its body: the done answer under 200, or a refusal. */
export type Answered<Answer> = (Response & TypedResponse<Body<Answer>, 200, "json">) | Refusal;

function json(status: number, body: unknown, extra: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

/**
 * Build the response of a refusal.
 *
 * @param about - the argument, the limit, or the path the code is about, as the action named it; one that holds a token or a login's secret is left out, since a caller may have sent one where a name goes
 * @param headers - headers to send beside the fixed ones, such as `Allow`
 */
export function refusal(code: Code, about?: string, headers?: Readonly<Record<string, string>>): Refusal {
  const named = about !== undefined && !TOKEN_SHAPE.test(about);
  const error: ApiError["error"] = named ? { code, message: MESSAGES[code], about } : { code, message: MESSAGES[code] };

  return json(STATUS[code], { error } satisfies ApiError, headers) as Refusal;
}

/**
 * Build the response to a request the database refused because its day's free allowance is used up.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns status 503 with the code `allowance_spent`, about `reading` or `writing`, and `Retry-After` up to the next midnight UTC
 */
export function spentRefusal(spent: AllowanceSpent, now: number): Refusal {
  return refusal("allowance_spent", spent.spent, { "Retry-After": String(secondsToNextDay(now)) });
}

/**
 * Build the response to a request refused because the store takes no more writes or listings today.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns status 503 with the code `allowance_spent`, about the setting that bounds them, and `Retry-After` up to the next midnight UTC
 */
export function writesSpentRefusal(now: number): Refusal {
  return refusal("allowance_spent", WRITES_SETTING, { "Retry-After": String(secondsToNextDay(now)) });
}

/**
 * Build the response of a handler that answers one stored file.
 *
 * @returns 200 with the file's bytes, its length, and its stored media type in `STORED_TYPE_HEADER`, or the refusal's response
 */
export function respondFile(result: Result<{ readonly size: number; readonly content_type: string; readonly body: ReadableStream<Uint8Array> }>): Response {
  if (!result.ok) return refusal(result.code, result.about);

  const headers = { ...FILE_HEADERS, "Content-Length": String(result.size), [STORED_TYPE_HEADER]: encodeURIComponent(result.content_type) };

  return new Response(result.body, { status: 200, headers });
}

/**
 * Build the response of a handler's answer.
 *
 * @param now - the clock, in milliseconds since the epoch: asked for where the answer may be `allowance_spent`, whose `Retry-After` runs up to the next midnight UTC
 * @returns 200 with the answer less its `ok`, or the refusal's response
 */
export function respond<Answer extends Result<object>>(result: Answer, ...[now]: Clock<Answer>): Answered<Answer> {
  if (!result.ok && result.code === "allowance_spent" && now !== undefined) return refusal(result.code, result.about, { "Retry-After": String(secondsToNextDay(now)) });

  if (!result.ok) return refusal(result.code, result.about);

  return json(200, Object.fromEntries(Object.entries(result).filter(([key]) => key !== "ok"))) as Answered<Answer>;
}
