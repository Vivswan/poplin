// What every data route of the console shares: who asks, how a refusal is answered, and how a request that fails its schema is refused.

import { listTokens } from "@poplin/core/src/actions/manage-tokens";
import type { Install } from "@poplin/core/src/actions/records";
import type { Rebuilding } from "@poplin/core/src/actions/start-update";
import type { Actor } from "@poplin/core/src/auth/scopes";
import type { Context, TypedResponse } from "hono";
import * as v from "valibot";

import { REFUSAL_STATUSES, statusOf } from "../api/respond";
import type { DomainPlug } from "./domain/records";
import { refusalSentence } from "./notices";
import type { FreeLimits } from "./settings/free-limits";

/** The status of the refusals only the console answers. Every other code goes out with the status the API gives it. */
const OWN_STATUSES: Readonly<Record<string, 404 | 415 | 429>> = {
  no_page: 404,
  not_json: 415,
  too_many_tries: 429,
};

/** Every HTTP status a refusal of the console goes out with, each once: the API's, the console's own, and 400 for a code neither names. */
export const CONSOLE_REFUSAL_STATUSES: readonly number[] = [...new Set<number>([...REFUSAL_STATUSES, ...Object.values(OWN_STATUSES), 400])];

/** A change that carries no values: its body is an empty JSON object. */
export const NOTHING = v.object({});

/** Who asks, and of which install. */
interface Asker {
  readonly install: Install;
  readonly actor: Actor;
}

/** What the routes ask of whoever hosts the install. */
interface Host {
  /** The free plan's limits a setting can be put above. */
  readonly freeLimits: FreeLimits;

  /** How the host's provider starts a rebuild of the install, and where the starts of a minute are counted. */
  readonly rebuilding: Rebuilding;

  /** The version of poplin the install runs. */
  readonly version: string;
}

/** What the handlers of one request share. */
export interface Shared {
  Variables: {
    /** Who asks, and of which install. */
    asker: Asker;

    /** The provider's side of the install, where the console was built with one. */
    domain: DomainPlug | undefined;

    /** The email the session names. */
    email: string;

    /** The host's part. */
    host: Host;

    /** Counts one try at a login's code, and answers whether it fits the visitor's minute. */
    takesCode: () => Promise<boolean>;
  };
}

/** A refusal of an action: its code, and the field, setting, or limit it is about. */
interface Refusal {
  readonly code: string;
  readonly about?: string;
}

/** A refusal as the client reads it: the code, what it is about, and the sentence to show. */
interface RefusalBody {
  readonly ok: false;
  readonly code: string;
  readonly about: string | null;
  readonly sentence: string;
}

/** What a schema's check of a request answered. */
type Checked = { readonly success: true } | { readonly success: false; readonly issues: readonly [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]] };

/** The status a refusal goes out with: the console's own for a code only it answers, the API's for a code the API answers too, and 400 for any other refusal of an action. */
function statusFor(code: string): (typeof OWN_STATUSES)[string] | NonNullable<ReturnType<typeof statusOf>> | 400 {
  if (Object.hasOwn(OWN_STATUSES, code)) return OWN_STATUSES[code] ?? 400;

  return statusOf(code) ?? 400;
}

/**
 * Answer a refusal.
 *
 * @returns the status the API answers the same code with, so a refusal reads the same wherever it is met; the console's own for the codes only it answers; 400 for any other code
 */
export function refused(context: Context<Shared>, refusal: Refusal): Response & TypedResponse<RefusalBody, ReturnType<typeof statusFor>, "json"> {
  return context.json(
    { ok: false as const, code: refusal.code, about: refusal.about ?? null, sentence: refusalSentence(refusal.code, refusal.about) },
    statusFor(refusal.code),
  );
}

/**
 * Read the name of each login that has one, by the login's id: what a screen writes where a login published or changed something.
 *
 * It is one read however many rows name a login. A login that was removed has no name here.
 */
export async function loginNames({ install, actor }: Asker): Promise<Record<string, string>> {
  const listed = await listTokens(install, actor);
  if (!listed.ok) return {};

  return Object.fromEntries(listed.tokens.filter((token) => token.note !== "").map((token) => [token.id, token.note]));
}

/**
 * Refuse a request whose query or body fails its schema, naming the first key that failed. A request that passes goes on to its handler.
 *
 * It is the hook every route's validator is given, so each refusal of a malformed request reads the same.
 */
export function refuseInvalid(checked: Checked, context: Context<Shared>): ReturnType<typeof refused> | undefined {
  if (checked.success) return undefined;

  return refused(context, { code: "bad_argument", about: v.getDotPath(checked.issues[0])?.split(".")[0] });
}
