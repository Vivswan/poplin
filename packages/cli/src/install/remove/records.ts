// What `poplin uninstall` is read into, and what it works through. The words of the command line become one request that can only be valid.
//
//   words         -> parseUninstall -> UninstallPlan: every answer given, or still to ask where a person can be asked
//   UninstallPlan -> settled        -> UninstallRequest: where the install is, the token, and how to run
//
// A removal is confirmed by the install's own address: typed when a person is asked, or given with the line. No run that removes is without one.

import type { Question, Token } from "../../../../core/src/install/installer";
import type { GivenToken, Provider } from "../records";

/** The proof of which install is meant, given with the line. */
interface Given {
  readonly by: "flag";
  readonly typed: string;
}

/** The proof of which install is meant, typed once the list was shown. */
interface Typing {
  readonly by: "typing";
}

/**
 * How a run goes. A dry run lists what a run with the same `data` would do, and removes nothing, so it has no proof.
 *
 * @typeParam Asked - `Typing` for a run that can ask a person, and `never` for one that cannot: then the proof is given with the line
 */
export type RemovalMode<Asked> = { readonly mode: "dry-run"; readonly data: "remove" | "keep" } | { readonly mode: "apply"; readonly confirm: Given | Asked; readonly data: "remove" | "keep" };

/**
 * The command line, read. A run that asks nothing holds every answer; one on a terminal holds each answer given, and asks for the rest.
 *
 * `where` on a terminal is the provider's own answer, or the questions it still has. `token` there is the one the variable held.
 */
export type UninstallPlan = { readonly provider: Provider; readonly json: boolean } & (
  | { readonly asking: "never"; readonly mode: RemovalMode<never>; readonly where: unknown; readonly token: GivenToken }
  | {
      readonly asking: "terminal";
      readonly mode: RemovalMode<Typing>;
      readonly where: { readonly known: true; readonly where: unknown } | { readonly known: false; readonly open: readonly Question<unknown>[] };
      readonly token: Token | undefined;
    }
);

/** Everything a run needs, each answer checked where it was read. */
export type UninstallRequest = { readonly provider: Provider; readonly json: boolean; readonly where: unknown; readonly token: Token } & (
  | { readonly asking: "terminal"; readonly mode: RemovalMode<Typing> }
  | { readonly asking: "never"; readonly mode: RemovalMode<never> }
);
