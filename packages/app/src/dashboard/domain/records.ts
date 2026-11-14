// The plug the Domain tab and the setup page work through: the provider's side of an install, read and repaired with a key that lives for one call.
//
//   dashboard  --check(token, settings)-->   plug  -->  the provider's API
//              <--rows: object, state, detail--
//
// The dashboard knows no provider: whoever builds it hands the plug in, and with none there is no Domain tab.

import type { Login } from "@poplin/core/src/auth/logins";
import type { SettingValues } from "@poplin/core/src/records/settings";

/** The settings the provider's side is made to match. */
export type DomainSettings = Pick<SettingValues, "logins" | "outside_pages" | "search_engines_allowed" | "block_bots">;

/** Reads the settings the provider's side is made to match: an install has them before it answers any request. A plug calls it only after the token has proven itself, so a refused token learns nothing of the install. */
export type ReadSettings = () => Promise<DomainSettings>;

/** A setting the Domain tab changes and a repair carries to the provider. */
export type GuardKey = Exclude<keyof DomainSettings, "logins">;

/** How one object stands. The first four are what a check finds; a repair also says what it did, where it failed, and what it never reached. */
export type DomainState = "present" | "missing" | "differs" | "left-out" | "created" | "changed" | "removed" | "failed" | "not-run";

/** One object of the install at the provider. `detail` names it, and says why it was left out or why it failed. */
export interface DomainRow {
  readonly object: string;
  readonly state: DomainState;
  readonly detail: string;
}

/** Something only a person can do, at the provider's own pages: what to do there, and the address to open. */
export interface DomainStep {
  readonly text: string;
  readonly address: string;
}

/**
 * Every object of the install, or why none was read: `token` for a key that is malformed, refused, or of another account, all alike; `unreachable` when the provider did not answer.
 *
 * Three are of an install with nothing set: `no_domain` for a token that shows no such domain, and `bad_domain` and `bad_login` for a typed value that is no domain or no email, refused before the provider is asked.
 * `allowance_spent` is a run of the setup page that the install's database refused a read or its audit entry, because its free allowance for the day is used up.
 */
export type DomainReading =
  | { readonly ok: true; readonly rows: readonly DomainRow[]; readonly steps: readonly DomainStep[] }
  | { readonly ok: false; readonly refusal: "token" | "unreachable" | "no_domain" | "bad_domain" | "bad_login" | "allowance_spent" };

/** The provider's side of an install. Neither method keeps the token past its own call, and neither throws for anything the provider answers. */
export interface DomainPlug {
  /** What the token field is called, such as the provider's own name for the key. */
  readonly tokenLabel: string;

  /** Every right a token needs for a check and a repair, each in the provider's own name for it. */
  readonly tokenRights: readonly string[];

  /** The address of the provider's form for a new token, with as many of the rights already chosen as a link can carry. */
  readonly tokenLink: string;

  /** The rights the link cannot carry: the person adds them on the form. */
  readonly tokenByHand: readonly string[];

  /** What else the provider's form asks of the person, in one sentence, such as which account the token is for. */
  readonly tokenNote: string;

  /** What each of the three settings does at this provider, in the provider's own words. */
  readonly guardNotes: Readonly<Record<GuardKey, string>>;

  /** Read every object and say what a repair would do. It changes nothing at the provider, and reads the settings only once the token is proven. */
  check(token: string, settings: ReadSettings): Promise<DomainReading>;

  /** Make every object match, in order. It goes on past an object the token has no permission for, and stops at any other failure: the rows say what was done, what failed, and what was never reached. */
  repair(token: string, settings: ReadSettings): Promise<DomainReading>;
}

/** What the provider's form for a new token is and asks for, as both pages show it. */
export type TokenFacts = Pick<DomainPlug, "tokenLabel" | "tokenRights" | "tokenLink" | "tokenByHand" | "tokenNote">;

/** The provider's side of an install with nothing set yet: no plug exists before a person names the domain and the first login. */
export interface FirstRun extends TokenFacts {
  /**
   * Make the plug of an install under a domain whose first login is an email. A repair of that plug also gives the install these two values, so that it starts.
   *
   * @returns the plug, or `undefined` for text the provider cannot take as a domain
   */
  plugFor(first: { readonly domain: string; readonly login: Login }): DomainPlug | undefined;
}
