// What a route's handler does beyond calling its one action: it checks what was sent against the action's schema, and joins what only the request knows to the action's answer. No rule lives here.

import type { UploadLimits } from "@poplin/core/src/actions/begin-publish";
import { beginLogin, LOGIN_REQUEST } from "@poplin/core/src/actions/computer-logins";
import { tokenObject, type WHOAMI_ANSWER } from "@poplin/core/src/actions/manage-tokens";
import { type Install, type Refused, refuse } from "@poplin/core/src/actions/records";
import { updateOf } from "@poplin/core/src/actions/update";
import { saveUpdateAddress, UPDATE_ADDRESS_REQUEST } from "@poplin/core/src/actions/update-address";
import { uploadFile } from "@poplin/core/src/actions/upload-file";
import { REVIEW_PAGE } from "@poplin/core/src/api/routes";
import { parseLoginSecret } from "@poplin/core/src/auth/computer-logins";
import type { Actor } from "@poplin/core/src/auth/scopes";
import type { TokenRecord } from "@poplin/core/src/auth/tokens";
import type { AddressLayout } from "@poplin/core/src/sites/address-layout";
import * as v from "valibot";

import { capBody } from "./body";

/** What the upload of one file takes from its query: the path the file is stored under. */
export const FILE_QUERY = v.strictObject({ path: v.string() });

/** What an action answers, behind its promise. */
type AnswerOf<Action extends (...parameters: never[]) => Promise<unknown>> = Awaited<ReturnType<Action>>;

/** The answer of a begun login, with the address of the dashboard page where an admin decides it. */
type Begun = Extract<AnswerOf<typeof beginLogin>, { readonly ok: true }> & { readonly verify_url: string };

/** What an install says of itself to whoever asks who they are. */
interface Running {
  /** The version of poplin the install runs. */
  readonly version: string;

  /** How the install's site addresses are laid out. */
  readonly layout: AddressLayout;
}

/** One file as its upload sends it: the upload it belongs to, the query that names its path, and the request whose body holds its bytes. */
interface SentFile {
  /** The path's `:upload`. */
  readonly upload: string;

  /** The query, checked by `FILE_QUERY`. */
  readonly query: v.InferOutput<typeof FILE_QUERY>;

  /** The request itself, whose body is read here. */
  readonly request: Request;

  /** What one request can carry. */
  readonly limits: UploadLimits;
}

/**
 * Check a sent value against an action's schema, and run the action on what passes.
 *
 * @returns the action's answer, or `bad_argument` about the first key that was refused, `body` for a value that is no object
 */
export async function checked<Schema extends v.GenericSchema, Answer>(
  schema: Schema,
  sent: unknown,
  run: (asked: v.InferOutput<Schema>) => Promise<Answer>,
): Promise<Answer | Refused<"bad_argument">> {
  const asked = v.safeParse(schema, sent);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "body");

  return run(asked.output);
}

/**
 * Store the body of a request as one file, reading no more of it than one request may carry.
 *
 * @returns the stored file, the action's refusal, or `too_large` about `max_file_size` for a body past the cap
 */
export async function storeBody(install: Install, actor: Actor, { upload, query, request, limits }: SentFile): Promise<AnswerOf<typeof uploadFile> | Refused<"too_large">> {
  const body = capBody(request, limits.fileBytes);

  try {
    const stored = await uploadFile(install, actor, { upload, path: query.path, body: body.stream });

    return body.exceeded() ? refuse("too_large", "max_file_size") : stored;
  } catch (error) {
    if (body.exceeded()) return refuse("too_large", "max_file_size");

    throw error;
  }
}

/**
 * Begin a login, and add the address of the dashboard page where an admin decides it.
 *
 * @param origin - the origin the request was sent to, which is the dashboard's
 * @param visitor - the key the asking visitor's requests are counted by
 */
export async function beginWithAddress(install: Install, body: unknown, origin: string, visitor: string): Promise<Begun | Exclude<AnswerOf<typeof beginLogin>, { readonly ok: true }> | Refused<"bad_argument">> {
  const begun = await checked(LOGIN_REQUEST, body, (request) => beginLogin(install, request, visitor));
  if (!begun.ok) return begun;

  // The address names the login by the id its secret starts with, which proves nothing. No part of the code is in it: the page asks for the code's end, so the address alone allows nothing.
  return { ...begun, verify_url: `${origin}${REVIEW_PAGE}/${parseLoginSecret(begun.secret)}` };
}

/**
 * Save the address that starts a rebuild.
 *
 * @param accepts - whether the host's provider starts rebuilds at an address
 * @returns the action's answer. A body of any other form is refused about `address`, never about a key it holds: the address may have been typed where a key goes
 */
export async function saveAddress(install: Install, actor: Actor, body: unknown, accepts: (address: URL) => boolean): Promise<AnswerOf<typeof saveUpdateAddress> | Refused<"bad_argument">> {
  const sent = v.safeParse(UPDATE_ADDRESS_REQUEST, body);
  if (!sent.success) return refuse("bad_argument", "address");

  return saveUpdateAddress(install, actor, sent.output.address, accepts);
}

/**
 * Say who a token is, which version the install runs, and how its site addresses are laid out, with the newer release when one is out.
 *
 * @param running - the version of poplin the install runs, and the layout of its site addresses
 */
export async function answerWhoami(install: Install, token: TokenRecord, running: Running): Promise<{ readonly ok: true } & v.InferOutput<typeof WHOAMI_ANSWER>> {
  const update = await updateOf(install, running.version);
  const answer = { ok: true, token: tokenObject(token), version: running.version, layout: running.layout } as const;

  return update === undefined ? answer : { ...answer, update };
}
