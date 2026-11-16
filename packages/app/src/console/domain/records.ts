// The plug the Domain screen and the setup page work through: the provider's side of an install, read and repaired with a key that lives for one call.
//
//   dashboard  --check(token, settings)-->   plug  -->  the provider's API
//              <--rows: object, state, detail--
//
// An install that holds something of its own to read the provider with has `ownCheck` too: the same rows, with no token.
//
// The dashboard knows no provider: whoever builds it hands the plug in, and with none there is no Domain screen.

import type { Login } from "@poplin/core/src/auth/logins";
import type { CheckedPiece } from "@poplin/core/src/records/domain-check";
import type { SettingValues } from "@poplin/core/src/records/settings";
import type { TokenFacts } from "@poplin/core/src/install/token-facts";

/** The settings the provider's side is made to match. */
export type DomainSettings = Pick<SettingValues, "logins" | "outside_pages" | "search_engines_allowed" | "block_bots">;

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
 *
 * Four are of an install with nothing set: `no_domain` for a token that shows no such domain, and `bad_domain` and `bad_login` for a typed value that is no domain or no email, refused before the provider is asked.
 * `bad_address` is a run for an install without a domain that was sent to a hostname no such install can answer at.
 * `allowance_spent` is a run of the setup page that the install's database refused a read or its audit entry, because its free allowance for the day is used up.
 */
export type DomainReading =
  | { readonly ok: true; readonly rows: readonly DomainRow[]; readonly steps: readonly DomainStep[] }
  | { readonly ok: false; readonly refusal: "token" | "unreachable" | "no_domain" | "bad_domain" | "bad_address" | "bad_login" | "allowance_spent" };

/** The provider's side of an install, with what its form for a new token is and asks for. Neither method keeps the token past its own call, and neither throws for anything the provider answers. */
export interface DomainPlug extends TokenFacts {
  /** How the screens speak of the install's side at the provider: `thing` is what a sentence calls it, such as `the domain`, and `line` is one sentence said first on its screen, or `null`. */
  readonly words: { readonly thing: string; readonly line: string | null };

  /** The settings, beyond the logins, that a repair carries to the provider. */
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

/**
 * What a person chose for an install with nothing set, with its first login.
 *
 * `domain` is an install under a domain of their own, as it was typed.
 * `no-domain` is one at the address the provider gave it: `host` is the hostname the run was sent to, which such an install answers at.
 */
export type FirstChoice = { readonly kind: "domain"; readonly domain: string; readonly login: Login } | { readonly kind: "no-domain"; readonly host: string; readonly login: Login };

/** The provider's side of an install with nothing set yet: no plug exists before a person chooses the kind of install and names the first login. */
export interface FirstRun {
  /** What the provider's form for a new token is and asks for, by the kind of install the token is for. */
  readonly forms: Readonly<Record<FirstChoice["kind"], TokenFacts>>;

  /**
   * Make the plug of the install a person chose. A repair of that plug also gives the install where it answers and its first login, so that it starts.
   *
   * @returns the plug, or `undefined` for text the provider cannot take as a domain, and for a hostname no install without a domain answers at
   */
  plugFor(first: FirstChoice): DomainPlug | undefined;
}
