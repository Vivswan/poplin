// What went wrong in the install, as the install remembers it: one record per kind and UTC day.
//
//   count            how often, at the least: a kind is written once an hour, so a storm costs one row and the count runs behind
//   more             whether the kind came more often than it was written, so the count is a floor
//   name, message    of the latest failure alone, the message cut and cleaned by `problemDetail`
//
// Nothing of the request is kept: no address, header, body, token, email, or file.

import * as v from "valibot";

import { MOMENT, POSITIVE } from "./fields";
import type { SettingValues } from "./settings";

/** How many UTC days a problem is kept, today included. */
export const PROBLEM_DAYS_KEPT = 30;

/** The most characters of a failure's message that are kept. */
export const MOST_MESSAGE_LENGTH = 200;

/** The most characters of a failure's name that are kept. */
export const MOST_NAME_LENGTH = 40;

/** Every kind of problem the install notes. A limit of a day is its own kind, noted once on the day it is reached. */
export const PROBLEM_KINDS = [
  "request_failed",
  "api_failed",
  "sweep_failed",
  "count_unwritten",
  "login_unwritten",
  "login_unchecked",
  "update_failed",
  "update_went_back",
  "users_not_carried",
  "rules_not_carried",
  "copy_failed",
  "direct_upload_refused",
  "login_not_repaired",
  "files_limit_reached",
  "writes_limit_reached",
  "requests_limit_reached",
] as const;

/** One kind on one UTC day. Times are milliseconds since the epoch. */
export const PROBLEM = v.object({
  day: v.pipe(v.string(), v.isoDate()),
  kind: v.picklist(PROBLEM_KINDS),
  count: POSITIVE,
  more: v.boolean(),
  first_at: MOMENT,
  last_at: MOMENT,
  name: v.nullable(v.pipe(v.string(), v.maxLength(MOST_NAME_LENGTH))),
  message: v.nullable(v.pipe(v.string(), v.maxLength(MOST_MESSAGE_LENGTH))),
});

/** A kind of problem. */
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** One kind on one UTC day. */
export type Problem = Readonly<v.InferOutput<typeof PROBLEM>>;

/** What a person reads of a kind: the sentence, what to do, the screen where it is acted on, and the setting that holds the limit it is about. */
interface ProblemWords {
  readonly sentence: string;
  readonly todo: string;
  readonly home: "usage" | "domain" | "settings";
  readonly setting: keyof SettingValues | null;
}

/** What to do about a limit of a day that was reached. */
const AFTER_MIDNIGHT = "It works again after midnight UTC. To allow more, raise the limit in Settings.";

/** What to do about a problem that a repair of the domain is the cure of. */
const PRESS_REPAIR = "Open Domain and press Repair.";

/** The words of every kind. A kind with no words does not compile. */
export const PROBLEM_WORDS: Readonly<Record<ProblemKind, ProblemWords>> = {
  request_failed: { sentence: "A request failed", todo: "Try again. If it comes back, copy the details and report it.", home: "usage", setting: null },
  api_failed: { sentence: "A publish or a command failed", todo: "Run it again. `poplin doctor` checks the install.", home: "usage", setting: null },
  sweep_failed: { sentence: "The clean-up did not finish", todo: "Nothing yet. It runs again by itself. If it is still here tomorrow, report it.", home: "usage", setting: null },
  count_unwritten: { sentence: "The day's count of storage writes was not saved", todo: "Nothing, unless it comes back.", home: "usage", setting: null },
  login_unwritten: { sentence: "A login was not written to Activity", todo: "Nothing. The login itself worked.", home: "usage", setting: null },
  login_unchecked: { sentence: "The login could not be checked", todo: "Open Domain and press Check.", home: "domain", setting: null },
  update_failed: { sentence: "An update did not go as it should", todo: "The details say what went wrong. To try again, press Update now.", home: "settings", setting: null },
  update_went_back: { sentence: "An update could not change the database, so poplin went back", todo: "Nothing is lost: the install runs the version before. Report it, and update again once a later release is out.", home: "settings", setting: null },
  users_not_carried: { sentence: "A change of the users did not reach the login page", todo: PRESS_REPAIR, home: "domain", setting: null },
  rules_not_carried: { sentence: "A changed setting did not reach every rule of the domain", todo: PRESS_REPAIR, home: "domain", setting: null },
  copy_failed: { sentence: "A copy of a site was not made", todo: "Duplicate the site again.", home: "usage", setting: null },
  login_not_repaired: { sentence: "The install could not repair its own login", todo: PRESS_REPAIR, home: "domain", setting: null },
  direct_upload_refused: { sentence: "The store refused files sent straight to it, so they went through the install", todo: PRESS_REPAIR, home: "domain", setting: null },
  files_limit_reached: { sentence: "The daily limit of files was reached", todo: AFTER_MIDNIGHT, home: "usage", setting: "max_files_per_day" },
  writes_limit_reached: { sentence: "The daily limit of storage writes was reached", todo: AFTER_MIDNIGHT, home: "usage", setting: "max_storage_writes_per_day" },
  requests_limit_reached: { sentence: "The daily limit of requests was reached", todo: AFTER_MIDNIGHT, home: "usage", setting: "requests_per_day" },
};

/** What a run of the domain can show that ends a problem: the login stands as the install needs it, or a repair left nothing to repair. */
export type Mend = "login_stands" | "repaired";

/** What ends a kind at once, before its day is forgotten. A kind that is not here is ended by nothing: it says what happened, and stays. */
const ENDED_BY: Readonly<Partial<Record<ProblemKind, Mend>>> = {
  login_unchecked: "login_stands",
  login_not_repaired: "login_stands",
  users_not_carried: "repaired",
  rules_not_carried: "repaired",
  direct_upload_refused: "repaired",
};

/** The kinds noted once a day, whatever follows: a limit that was reached stays reached until midnight. */
export const ONCE_A_DAY: ReadonlySet<ProblemKind> = new Set(["files_limit_reached", "writes_limit_reached", "requests_limit_reached"]);

/** Whether what a kind says to do is a repair of the domain: the Domain screen then says that a repair waits. */
export function asksRepair(kind: ProblemKind): boolean {
  return PROBLEM_WORDS[kind].todo === PRESS_REPAIR;
}

/** The kinds some mends end, in the order of the kinds. */
export function endedBy(mends: readonly Mend[]): readonly ProblemKind[] {
  return PROBLEM_KINDS.filter((kind) => mends.some((mend) => ENDED_BY[kind] === mend));
}
