// The provider's side of the preview install, written by hand: it takes any token but an empty one and calls nothing.
//
// The console's plug is one that changes: its first check finds pieces to repair, a repair mends them, and every run after finds them in place.
// A repair with the token `lacking` mends one piece and fails at the other for a right the token lacks; that piece stays to repair until a token that has the right.
// It also checks by itself, as an install that holds something to read its provider with does: its own check reads what a check with a good token reads, and takes none.

import type { DomainPlug, DomainReading, DomainRow, DomainState } from "../../../../app/src/console/domain/records";
import type { TokenFacts } from "../../../../core/src/install/token-facts";

/** The optional right of an install under a domain, and what it adds. */
const FLOOD_RULE: OptionalRight = { right: "Rules: Edit", adds: "The provider stops floods before they reach a site." };

/** The optional right of an install without a domain, and what it adds. */
const SPEND_ALERT: OptionalRight = { right: "Alerts: Edit", adds: "The provider emails the users you choose in Settings when the account's charges reach an amount." };

/** The provider's side of an install under a domain. */
export const WITH_DOMAIN: Provider = {
  pieces: [
    { object: "DNS record", detail: "every site", part: "reach" },
    { object: "DNS record", detail: "the dashboard", part: "reach", broken: { found: "missing", mended: "created" } },
    { object: "Route", detail: "every site", part: "reach" },
    { object: "Route", detail: "the dashboard", part: "reach" },
    { object: "Login application", detail: "the dashboard's login", part: "login" },
    { object: "Login policy", detail: "your users only", part: "login", broken: { found: "differs", mended: "changed" }, lacks: "Login: Edit" },
    { object: "Rate rule", detail: "sample-rate-rule", part: "rest", optional: FLOOD_RULE },
  ],
  form: {
    tokenRights: ["Records: Edit", "Routes: Edit", "Login: Edit"],
    tokenLink: "https://provider.example/tokens/new",
    tokenOptional: [FLOOD_RULE],
    tokenNote: "On the form, choose the account and the domain the account token is for.",
    tokenFor: "this account and this domain",
  },
  says: { words: { thing: "the domain", line: null }, carriedSettings: ["alert_users", "outside_pages", "search_engines_allowed", "block_bots"], idleSettings: {} },
};

/** The provider's side of an install without a domain, as the preview alone invents it: the two addresses its sites answer at, the login, and the optional alert of the account, with no record, route, or rule, since such an install has none. */
export const WITHOUT_DOMAIN: Provider = {
  pieces: [
    { object: "Address", detail: "the open sites", part: "reach" },
    { object: "Address", detail: "the private sites", part: "reach", broken: { found: "missing", mended: "created" } },
    { object: "Login application", detail: "the dashboard and the private sites", part: "login" },
    { object: "Login policy", detail: "your users only", part: "login", broken: { found: "differs", mended: "changed" }, lacks: "Login: Edit" },
    { object: "Spend alert", detail: "sample-spend-alert", part: "rest", optional: SPEND_ALERT },
  ],
  form: {
    tokenRights: ["Scripts: Edit", "Login: Edit"],
    tokenLink: "https://provider.example/tokens/new",
    tokenOptional: [SPEND_ALERT],
    tokenNote: "On the form, choose the account the account token is for.",
    tokenFor: "this account",
  },
  says: { words: { thing: "the install", line: "No domain: your sites answer at the provider's free address." }, carriedSettings: ["alert_users"], idleSettings: { block_bots: "Needs a domain." } },
};

/** The tokens the changing plug answers with a refusal, so that each refusal can be seen: it takes any other. */
const REFUSED_TOKENS: Readonly<Record<string, Extract<DomainReading, { ok: false }>["refusal"]>> = { wrong: "token", offline: "unreachable" };

/** The token that lacks a right one piece needs: a repair with it goes on past that piece, whose row names the right. */
const LACKING_TOKEN = "lacking";

/** What the changing plug's own check is read with, in a token's place: no token a person pastes is taken for it. */
const OWN_TOKEN = "the install's own";

/** A right the install works without, as the token form lists it. */
type OptionalRight = TokenFacts["tokenOptional"][number];

/** One object of an install at its provider, and what the changing plug does with it. */
interface Piece {
  /** The object, as a provider would name its kind. */
  readonly object: string;

  /** What the object is of, which names it among its kind. */
  readonly detail: string;

  /** What the object is for. */
  readonly part: DomainRow["part"];

  /** How the changing plug first finds the piece, and what a repair then does to it. A piece without it stands from the start. */
  readonly broken?: { readonly found: DomainState; readonly mended: DomainState };

  /** The right the token `lacking` has not, so that its repair fails at the piece. */
  readonly lacks?: string;

  /** The right of a piece the install works without: its row says what the piece adds and to add that right, whatever a run did. */
  readonly optional?: OptionalRight;
}

/** The provider's side of one kind of install, as the preview invents it. */
export interface Provider {
  /** Every object of the install. */
  readonly pieces: readonly Piece[];

  /** What the preview says of its token and of the form that makes one. */
  readonly form: TokenFacts;

  /** How the screens name this side, which settings a repair carries there, and which do nothing on this kind. */
  readonly says: Pick<DomainPlug, "words" | "carriedSettings" | "idleSettings">;
}

function table(found: readonly DomainRow[]): DomainReading {
  return { ok: true, rows: found, steps: [] };
}

/** The row of one piece of the changing plug in a state. A piece that failed names the right the token lacks. */
function changingRow(piece: Piece, state: DomainState): DomainRow {
  const row = { object: piece.object, detail: piece.detail, part: piece.part, state };
  if (piece.optional !== undefined) return { ...row, state: "optional", detail: `${piece.detail}: ${piece.optional.adds} To switch this on, add this permission to the account token and press Repair: ${piece.optional.right}` };

  if (state !== "failed" || piece.lacks === undefined) return row;

  return { ...row, detail: `${piece.detail}: the account token lacks a permission. Add this permission to the account token: ${piece.lacks}`, right: piece.lacks };
}

/** How a run of the changing plug leaves a piece that is still broken: a check finds it so, and a repair mends it unless the token lacks its right. */
function stateIn(piece: Piece, run: "check" | "repair", token: string): DomainState {
  if (piece.broken === undefined) return "present";

  if (run === "check") return piece.broken.found;

  return token === LACKING_TOKEN && piece.lacks !== undefined ? "failed" : piece.broken.mended;
}

/**
 * Build a plug whose install a repair mends: a check finds the pieces still broken, a repair says what it did to each, and every run after finds a mended piece in place.
 *
 * @param provider - the kind of install the plug stands for
 * @returns a plug that refuses the token `wrong`, does not answer for the token `offline`, fails one piece of a repair for the token `lacking`, and takes any other; its own check takes none
 */
export function changingPlug(provider: Provider): DomainPlug {
  const broken = new Set(provider.pieces.filter((piece) => piece.broken !== undefined));
  const answer =
    (run: "check" | "repair"): DomainPlug["check"] =>
    async (token, settings) => {
      const refusal = token === "" ? "token" : REFUSED_TOKENS[token];
      if (refusal !== undefined) return { ok: false, refusal };

      await settings();
      const states = new Map(provider.pieces.map((piece) => [piece, broken.has(piece) ? stateIn(piece, run, token) : "present"]));
      // A repair mends every piece it did not fail at.
      if (run === "repair") for (const piece of provider.pieces.filter((each) => states.get(each) !== "failed")) broken.delete(piece);

      return table(provider.pieces.map((piece) => changingRow(piece, states.get(piece) ?? "present")));
    };

  const check = answer("check");

  return { ...provider.form, ...provider.says, check, repair: answer("repair"), ownCheck: (settings) => check(OWN_TOKEN, settings) };
}

/**
 * Build a plug of an install whose every object stands.
 *
 * @param provider - the kind of install the plug stands for
 * @returns a plug that refuses an empty token alone, and finds every piece in place on a check and on a repair
 */
export function standingPlug(provider: Provider): DomainPlug {
  const answer: DomainPlug["check"] = async (token, settings) => {
    if (token === "") return { ok: false, refusal: "token" };

    await settings();

    return table(provider.pieces.map(({ object, detail, part }) => ({ object, detail, part, state: "present" })));
  };

  return { ...provider.form, ...provider.says, check: answer, repair: answer };
}
