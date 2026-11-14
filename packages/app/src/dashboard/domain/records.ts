// The plug the Domain tab and the setup page work through: the provider's side of an install, read and repaired with a key that lives for one call.
//
//   dashboard  --check(token, settings)-->   plug  -->  the provider's API
//              <--rows: object, state, detail--
//
// The dashboard knows no provider: whoever builds it hands the plug in, and with none there is no Domain tab.

import type { SettingValues } from "@poplin/core/src/records/settings";

/** The settings the provider's side is made to match. */
export type DomainSettings = Pick<SettingValues, "logins" | "outside_pages" | "search_engines_allowed" | "block_bots">;

/** Reads the stored settings, or `undefined` on an install that has none. A plug calls it only after the token has proven itself, so a refused token learns nothing of the install. */
export type ReadSettings = () => Promise<DomainSettings | undefined>;

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

/** Every object of the install, or why none was read: `token` for a key that is malformed, refused, or of another account, all alike; `unreachable` when the provider did not answer; `not_set_up` for a proven token on an install with no settings. */
export type DomainReading =
  | { readonly ok: true; readonly rows: readonly DomainRow[]; readonly steps: readonly DomainStep[] }
  | { readonly ok: false; readonly refusal: "token" | "unreachable" | "not_set_up" };

/** The provider's side of an install. Neither method keeps the token past its own call, and neither throws for anything the provider answers. */
export interface DomainPlug {
  /** What the token field is called, such as the provider's own name for the key. */
  readonly tokenLabel: string;

  /** What each of the three settings does at this provider, in the provider's own words. */
  readonly guardNotes: Readonly<Record<GuardKey, string>>;

  /** Read every object and say what a repair would do. It changes nothing at the provider, and reads the settings only once the token is proven. */
  check(token: string, settings: ReadSettings): Promise<DomainReading>;

  /** Make every object match, in order, stopping at the first failure: the rows say what was done, what failed, and what was never reached. */
  repair(token: string, settings: ReadSettings): Promise<DomainReading>;
}
