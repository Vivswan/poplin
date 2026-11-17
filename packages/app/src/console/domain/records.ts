// The plug the Domain screen works through: the provider's side of an install, read and repaired with a key that lives for one call.
//
//   dashboard  --check(token, settings)-->   plug  -->  the provider's API
//              <--rows: object, state, detail--
//
// An install that holds something of its own to read the provider with has `ownCheck` too: the same rows, with no token.
//
// The dashboard knows no provider: whoever builds it hands the plug in, and with none there is no Domain screen.

import type { CheckedPiece } from "@poplin/core/src/records/domain-check";
import type { SettingValues } from "@poplin/core/src/records/settings";
import type { TokenFacts } from "@poplin/core/src/install/token-facts";

/** The settings the provider's side is made to match. */
export type DomainSettings = Pick<SettingValues, "users" | "alert_users" | "outside_pages" | "search_engines_allowed" | "block_bots" | "provider_logs">;

/** Reads the settings the provider's side is made to match: an install has them before it answers any request. A plug calls it only after the token has proven itself, so a refused token learns nothing of the install. */
export type ReadSettings = () => Promise<DomainSettings>;

/** How one object stands. The first five are what a check finds; a repair also says what it did, where it failed, and what it never reached. `optional` is one the token has no right for and the install works without: no failure, and nothing to repair. */
export type DomainState = "present" | "missing" | "differs" | "left-out" | "optional" | "created" | "changed" | "removed" | "failed" | "not-run";

/**
 * One object of the install at the provider. `detail` names it, and says why it was left out, why it failed, or which right would switch it on.
 *
 * `part` is what the object is for: `login` guards private sites, `reach` makes a site answer at its address, and `rest` is everything else.
 * `right` is on a row that failed because the token lacked a right, and names that right.
 * `users` is on an object that holds the install's users, such as the list of who may log in: a repair has carried the users only once every such object stands.
 */
export interface DomainRow {
  readonly object: string;
  readonly state: DomainState;
  readonly detail: string;
  readonly part: CheckedPiece["part"];
  readonly right?: string;
  readonly users?: true;
}

/** Something only a person can do, at the provider's own pages: what to do there, and the address to open. */
export interface DomainStep {
  readonly text: string;
  readonly address: string;
}

/**
 * Every object of the install, or why none was read: `token` for a key that is malformed, refused, or of another account, all alike; `unreachable` when the provider did not answer.
 */
export type DomainReading =
  | { readonly ok: true; readonly rows: readonly DomainRow[]; readonly steps: readonly DomainStep[] }
  | { readonly ok: false; readonly refusal: "token" | "unreachable" };

/** The provider's side of an install, with what its form for a new token is and asks for. Neither method keeps the token past its own call, and neither throws for anything the provider answers. */
export interface DomainPlug extends TokenFacts {
  /** How the screens speak of the install's side at the provider: `thing` is what a sentence calls it, such as `the domain`, and `line` is one sentence said first on its screen, or `null`. */
  readonly words: { readonly thing: string; readonly line: string | null };

  /** The settings, beyond the users, that a repair carries to the provider. */
  readonly carriedSettings: readonly (keyof DomainSettings)[];

  /** The settings that do nothing on this install, since the provider's side has no place for them: each with the one short line its control says in place of taking a change. */
  readonly idleSettings: Readonly<Partial<Record<keyof DomainSettings, string>>>;

  /** Read every object and say what a repair would do. It changes nothing at the provider, and reads the settings only once the token is proven. */
  check(token: string, settings: ReadSettings): Promise<DomainReading>;

  /** Read every object with what the install itself holds at the provider: it takes no token and changes nothing. Absent on an install that holds nothing to read with. An object it has no right to read says so in its row. */
  readonly ownCheck?: (settings: ReadSettings) => Promise<DomainReading>;

  /** Make every object match, in order. It goes on past an object the token has no right for, `optional` where the right is, and stops at any other failure: the rows say what was done, what failed, and what was never reached. */
  repair(token: string, settings: ReadSettings): Promise<DomainReading>;
}
