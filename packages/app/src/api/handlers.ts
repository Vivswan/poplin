// What a route's handler does beyond calling its one action: it checks what was sent against the action's schema, and joins what only the request knows to the action's answer. No rule lives here.

import type { UploadLimits } from "@poplin/core/src/actions/begin-publish";
import { beginLogin, LOGIN_REQUEST } from "@poplin/core/src/actions/computer-logins";
import { wayBack } from "@poplin/core/src/actions/go-back";
import { issueTickets, type TICKETS_REQUEST } from "@poplin/core/src/actions/issue-tickets";
import { tokenObject, type WHOAMI_ANSWER } from "@poplin/core/src/actions/manage-tokens";
import { noteProblem } from "@poplin/core/src/actions/problems";
import { type Install, type Refused, refuse } from "@poplin/core/src/actions/records";
import type { SelfUpdate } from "@poplin/core/src/actions/start-update";
import { type UPDATE_STATE, updateOf } from "@poplin/core/src/actions/update";
import { uploadFile } from "@poplin/core/src/actions/upload-file";
import { REVIEW_PAGE } from "@poplin/core/src/api/routes";
import { parseLoginSecret } from "@poplin/core/src/auth/computer-logins";
import type { Actor } from "@poplin/core/src/auth/scopes";
import type { TokenRecord } from "@poplin/core/src/auth/tokens";
import type { AddressLayout } from "@poplin/core/src/sites/address-layout";
import type { Tickets } from "@poplin/core/src/storage/tickets";
import * as v from "valibot";

import { capBody } from "./body";

/** What the upload of one file takes from its query: the path the file is stored under. */
export const FILE_QUERY = v.strictObject({ path: v.string() });

/** The content type a file's bytes are sent with. */
const BYTES_TYPE = "application/octet-stream";

/** The tickets of an install that takes its uploads' files itself: each names the install's own route for one file, as a path, and carries no leave: the route asks for the sender's token and holds the bytes to their size and hash. */
const ROUTE_TICKETS: Tickets = {
  async issue(upload, files) {
    return files.map(({ file }) => {
      const url = `/api/uploads/${upload.id}/file?${new URLSearchParams({ path: file.path })}`;

      return { path: file.path, url, method: "PUT", headers: { "Content-Type": BYTES_TYPE, "Content-Length": String(file.size) }, expires: upload.expires };
    });
  },
};

/** The host's tickets that send a file straight to the store, past the install, asked for as each request comes: `undefined` while the host has none to hand out. */
export type Direct = () => Tickets | undefined;

/** The uploads each install noted as turned back to its own route, so the calls that go on with one of them are noted no more. */
const TURNED = new WeakMap<Install["database"], Set<string>>();

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
 * Give an install the tickets its uploads' files are sent by, for a request that begins an upload or asks for tickets. This is the one place that picks between the two ways a file goes.
 *
 * @param direct - the host's tickets past the install; absent on a host that has none
 * @returns the install with the host's tickets while it hands any out, else with `ROUTE_TICKETS`
 */
export function ticketed(install: Install, direct?: Direct): Install {
  return { ...install, tickets: direct?.() ?? ROUTE_TICKETS };
}

/**
 * Hand out more tickets of a pending upload, of the kind its sender asks for: the ones `ticketed` picks, or with `through` the install's own route, after the store refused the sender's files.
 *
 * @param asked - the upload's id as sent, and what a `TICKETS_REQUEST` passed
 * @param direct - the host's tickets past the install, as `ticketed` takes them
 * @returns what `issueTickets` answers. An upload that is handed the install's route while the host hands tickets out is noted as the problem `direct_upload_refused`, once however many calls it goes on with
 */
export async function ticketsFor(install: Install, actor: Actor, asked: v.InferOutput<typeof TICKETS_REQUEST> & { readonly upload: string }, direct?: Direct): ReturnType<typeof issueTickets> {
  const request = { upload: asked.upload, paths: asked.paths };
  if (asked.through === undefined) return issueTickets(ticketed(install, direct), actor, request);

  const issued = await issueTickets({ ...install, tickets: ROUTE_TICKETS }, actor, request);
  const turned = TURNED.get(install.database) ?? new Set<string>();
  if (!issued.ok || direct?.() === undefined || turned.has(asked.upload)) return issued;

  // Marked before the note is written, so a call that comes meanwhile for the same upload notes nothing.
  TURNED.set(install.database, turned.add(asked.upload));
  await noteProblem(install, "direct_upload_refused");

  return issued;
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
 * Say what an update would start from, for an admin. Nothing is fetched and nothing is started.
 *
 * @param running - the version of poplin the install runs, and what updates it
 * @returns the version, the newer release the install knows of or `null`, whether the key is held, and the version it can go back to or `null`; `not_allowed` for anyone but an admin
 */
export async function answerUpdateState(
  install: Install,
  actor: Actor,
  running: { readonly version: string; readonly self: Pick<SelfUpdate, "holdsKey" | "last"> },
): Promise<({ readonly ok: true } & v.InferOutput<typeof UPDATE_STATE>) | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const { version, self } = running;

  return { ok: true, version, update: (await updateOf(install, version)) ?? null, key: self.holdsKey(), back: wayBack(self.last, version) ?? null };
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
