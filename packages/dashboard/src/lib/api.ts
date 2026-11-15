// The client of the console's data routes. Every call is checked against the routes the server declares: its path, its query, its body, and what it answers.

import type { DataRoutes } from "@poplin/app/src/console/routes";
import { DetailedError, hc, parseResponse } from "hono/client";

import { BOOT } from "@/lib/boot";

/** The status of an answer to a request whose session ended. */
const LOGGED_OUT = 401;

/** What is shown when no answer could be read at all. */
const UNREACHED = "The dashboard did not answer. Check the connection and try again.";

/** What is shown when the server answered with a failure of its own. */
const FAILED = "Something went wrong on the server. Try again in a moment.";

/** One field a request was refused about, and the sentence to show at it. */
interface RefusedField {
  readonly about: string;
  readonly sentence: string;
}

/** A refusal as a route answers it. `each` is there only where a request was refused about several fields. */
interface RefusalBody {
  readonly code: string;
  readonly about: string | null;
  readonly sentence: string;
  readonly each?: readonly RefusedField[];
}

/** The answer to a call of `api`, before its body is read. */
export type Answering = Awaited<Parameters<typeof parseResponse>[0]>;

/** What a call's route answers when it is done. */
export type Done<Call extends Answering> = Awaited<ReturnType<typeof parseResponse<Call>>>;

/** A request the server refused, or one that got no answer. `message` is the sentence to show. */
export class Refused extends Error {
  /** The refusal's code, such as `bad_name`; `unreached` when nothing answered. */
  readonly code: string;

  /** The field, setting, or limit the refusal is about. */
  readonly about: string | null;

  /** Every field of a request that was refused about several, each with its own sentence; empty for any other refusal. */
  readonly each: readonly RefusedField[];

  constructor(body: RefusalBody) {
    super(body.sentence);
    this.code = body.code;
    this.about = body.about;
    this.each = body.each ?? [];
  }
}

/** The data routes, called as `api.sites.$get({ query })` or `api.sites[":site"].naming.$post({ param, json })`. */
export const api = hc<DataRoutes>(`${BOOT.base}/data`);

function isRefusal(data: unknown): data is RefusalBody {
  return (
    typeof data === "object" && data !== null && "sentence" in data && typeof data.sentence === "string" && "code" in data && typeof data.code === "string"
  );
}

/** What a failed call is told as: the server's refusal where it gave one, one sentence for a failure of the server's own, and one for a call that got no answer. */
function refusalOf(error: unknown): Refused {
  const data: unknown = error instanceof DetailedError ? (error.detail as { readonly data?: unknown } | undefined)?.data : undefined;
  if (isRefusal(data)) return new Refused({ code: data.code, about: data.about ?? null, sentence: data.sentence, ...(data.each === undefined ? {} : { each: data.each }) });

  return new Refused(
    error instanceof DetailedError ? { code: "failed", about: null, sentence: FAILED } : { code: "unreached", about: null, sentence: UNREACHED },
  );
}

/**
 * Wait for a call's answer and hand back its values.
 *
 * @param asked - a call of `api`
 * @returns what the route answers when it is done
 * @throws {Refused} the route refused, or nothing answered. A session that ended loads the page again, which leads to the login
 */
export async function answerOf<Call extends Answering>(asked: Promise<Call>): Promise<Done<Call>> {
  try {
    return (await parseResponse(asked)) as Done<Call>;
  } catch (error) {
    if (error instanceof DetailedError && error.statusCode === LOGGED_OUT) window.location.reload();

    throw refusalOf(error);
  }
}
