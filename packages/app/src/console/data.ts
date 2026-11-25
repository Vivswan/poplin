// What every data route of the console shares: who asks, how a refusal is answered, and how a request that fails its schema is refused.

import type { Install } from "@poplin/core/src/actions/records";
import type { EndLogins } from "@poplin/core/src/actions/access/sign-out";
import type { Updating } from "@poplin/core/src/actions/start-update";
import type { Asking } from "@poplin/core/src/actions/update/check-update";
import type { Login } from "@poplin/core/src/auth/logins";
import type { Actor } from "@poplin/core/src/auth/scopes";
import type { Jobs } from "@poplin/core/src/jobs/jobs";
import type { AddressLayout } from "@poplin/core/src/sites/address-layout";
import type { Context, TypedResponse } from "hono";
import * as v from "valibot";

import { REFUSAL_STATUSES, statusOf } from "../api/respond";
import type { DomainPlug } from "./domain/records";
import type { UsageHost } from "./usage/records";
import { refusalSentence } from "./notices";
import type { FreeLimits } from "./settings/free-limits";
import type { UsersFollow } from "./access/users-follow";
import type { LogsFollow } from "./settings/logs-follow";
import type { RulesFollow } from "./settings/rules-follow";

/** The status of the refusals only the console answers. Every other code goes out with the status the API gives it. */
const OWN_STATUSES: Readonly<Record<string, 404 | 415 | 429 | 502>> = {
  no_page: 404,
  not_json: 415,
  too_many_tries: 429,
  website_unreachable: 502,
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

  /** What updates the install, and where the starts of a minute are counted. */
  readonly updating: Updating;

  /** What asks the project's website which version of poplin is the newest, for a person who asks now. */
  readonly latest: Asking;

  /** The version of poplin the install runs. */
  readonly version: string;

  /** The host's side of the Usage screen. */
  readonly usage: UsageHost;

  /** What runs the rounds of a copy after its first request's. */
  readonly jobs: Jobs;

  /** The layout of the install's site addresses, which an address pasted into a search is read with. */
  readonly layout: AddressLayout;
}

/** What the handlers of one request share. */
export interface Shared {
  Variables: {
    /** Who asks, and of which install. */
    asker: Asker;

    /** The provider's side of the install, where the console was built with one. */
    domain: DomainPlug | undefined;

    /** The email of the user who asks. */
    email: Login;

    /** When the provider's login behind the request began, in milliseconds since the epoch. */
    since: number;

    /** The provider's side of the users, where the console was built with one: a change of them is carried there by itself. */
    follow: UsersFollow | undefined;

    /** Ends every login of the dashboard at the provider, where the console was built with a way to. */
    endLogins: EndLogins | undefined;

    /** The provider's side of the domain's rules, where the console was built with one: a change of a setting they are written from is carried there by itself. */
    rules: RulesFollow | undefined;

    /** The provider's side of the install's logs, where the console was built with one: a change of the setting that keeps them is carried there by itself. */
    logs: LogsFollow | undefined;

    /** The host's part. */
    host: Host;

    /** Counts one try at a login's code, and answers whether it fits the visitor's minute. */
    takesCode: () => Promise<boolean>;
  };
}

/** A refusal of an action: its code, and the field, setting, or limit it is about. `each` names every field of a request that is refused about more than one, `about` among them, with the code that field is refused by. */
interface Refusal {
  readonly code: string;
  readonly about?: string;
  readonly each?: readonly { readonly code: string; readonly about: string }[];
}

/** A refusal as the client reads it: the code, what it is about, and the sentence to show. `each` is there only for a request refused about several fields: every one of them with its own sentence. */
interface RefusalBody {
  readonly ok: false;
  readonly code: string;
  readonly about: string | null;
  readonly sentence: string;
  readonly each?: readonly { readonly about: string; readonly sentence: string }[];
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
  const each = refusal.each?.map(({ code, about }) => ({ about, sentence: refusalSentence(code, about) }));

  return context.json(
    { ok: false as const, code: refusal.code, about: refusal.about ?? null, sentence: refusalSentence(refusal.code, refusal.about), ...(each === undefined ? {} : { each }) },
    statusFor(refusal.code),
  );
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
