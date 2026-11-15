// The provider's side of the preview install, written by hand: it takes any token but an empty one, calls nothing, and answers the reading its state names.
//
//   fresh           nothing exists yet               a repair creates every object
//   partial         some objects missing or changed  a repair stops at a failure
//   access-off      the login service is not on      a step only a person can do
//   done            every object stands              nothing to repair
//   token-refused, unreachable                       no table, only the refusal
//
// The console's plug is one that changes: its first check finds pieces to repair, a repair mends them, and every run after finds them in place.
// A repair with the token `lacking` mends one piece and fails at the other for a right the token lacks; that piece stays to repair until a token that has the right.

import type { DomainPlug, DomainReading, DomainRow, DomainState, FirstRun } from "../../../app/src/console/domain/records";

/** Every state a preview plug can be in, as the address of the setup page names it. */
export const PLUG_STATES = ["fresh", "partial", "access-off", "done", "token-refused", "unreachable"] as const;

/** The objects of the sample install, as a provider would name them. */
const OBJECTS: readonly (readonly [object: string, detail: string, part: DomainRow["part"]])[] = [
  ["DNS record", "every site", "reach"],
  ["DNS record", "the dashboard", "reach"],
  ["Route", "every site", "reach"],
  ["Route", "the dashboard", "reach"],
  ["Login application", "the dashboard's login", "login"],
  ["Login policy", "your users only", "login"],
  ["Rate rule", "sample-rate-rule", "rest"],
];

/** The rights the preview's token form names: every one its link carries. */
const RIGHTS = ["Records: Edit", "Routes: Edit", "Login: Edit"];

/** What the preview says of its token and of the form that makes one. */
const TOKEN_FORM = {
  tokenRights: RIGHTS,
  tokenLink: "https://provider.example/tokens/new",
  tokenOptional: [{ right: "Rules: Edit", adds: "The provider stops floods before they reach a site." }],
  tokenNote: "On the form, choose the account and the domain the account token is for.",
};

/** The one thing a person does by hand in the `access-off` state. */
const ACCESS_STEP = { text: "Turn the login service on for the account, then check again.", address: "https://provider.example.com/sample-account" };

/** The refusal of each state that reads no table. */
const REFUSALS: Partial<Record<PlugState, Extract<DomainReading, { ok: false }>["refusal"]>> = { "token-refused": "token", unreachable: "unreachable" };

/** The tokens the changing plug answers with a refusal, so that each refusal can be seen: it takes any other. */
const REFUSED_TOKENS: Readonly<Record<string, Extract<DomainReading, { ok: false }>["refusal"]>> = { wrong: "token", offline: "unreachable" };

/** The pieces of the changing plug that start broken. */
const BROKEN = [
  { place: 1, found: "missing", mended: "created" },
  { place: 5, found: "differs", mended: "changed" },
] as const;

/** The token that lacks a right one piece needs: a repair with it goes on past that piece, whose row names the right. */
const LACKING_TOKEN = "lacking";

/** The piece the lacking token cannot change, and the right it lacks. */
const LACKED = { place: 5, right: "Login: Edit", detail: "your users only: the account token lacks a right. Add this right to the account token: Login: Edit" } as const;

/** The place of the optional piece among the objects, and what its row says while the token lacks its right. */
const OPTIONAL_ROW = { place: 6, detail: "sample-rate-rule: add this right to the account token and press Repair: Rules: Edit" } as const;

/** What the row a repair of the `partial` state fails at says: the piece, why, and what to add. */
const FAILED_DETAIL = "the dashboard: the provider refused the change. Add this right to the account token: Routes: Edit";

/** One state of the preview's plug. */
export type PlugState = (typeof PLUG_STATES)[number];

/** Every object in one state, but the rows `others` names by their place. */
function rows(state: DomainState, others: Readonly<Record<number, DomainState>> = {}): DomainRow[] {
  return OBJECTS.map(([object, detail, part], place) => ({ object, detail, part, state: others[place] ?? state }));
}

function table(found: readonly DomainRow[], steps: readonly (typeof ACCESS_STEP)[] = []): DomainReading {
  return { ok: true, rows: found, steps };
}

function checked(state: PlugState): DomainReading {
  if (state === "fresh") return table(rows("missing"));

  if (state === "partial") return table(rows("present", { 1: "missing", 3: "missing", 5: "differs", 6: "left-out" }));

  if (state === "access-off") return table(rows("present", { 4: "missing", 5: "missing" }), [ACCESS_STEP]);

  return table(rows("present"));
}

function repaired(state: PlugState): DomainReading {
  if (state === "fresh") return table(rows("created"));

  if (state === "partial") {
    const stopped = rows("present", { 1: "created", 3: "failed", 4: "not-run", 5: "not-run", 6: "not-run" });

    return table(stopped.map((row) => (row.state === "failed" ? { ...row, detail: FAILED_DETAIL } : row)));
  }

  if (state === "access-off") return table(rows("present", { 4: "missing", 5: "missing" }), [ACCESS_STEP]);

  return table(rows("present"));
}

/** The rows of the changing plug, with the pieces `others` names in its states. */
function changing(others: Readonly<Record<number, DomainState>>): DomainReading {
  return table(
    rows("present", others).map((row, place) => {
      if (place === OPTIONAL_ROW.place) return { ...row, state: "optional", detail: OPTIONAL_ROW.detail };

      return row.state === "failed" ? { ...row, detail: LACKED.detail, right: LACKED.right } : row;
    }),
  );
}

/**
 * Build a plug whose install a repair mends: a check finds the pieces still broken, a repair says what it did to each, and every run after finds a mended piece in place.
 *
 * @returns a plug that refuses the token `wrong`, does not answer for the token `offline`, fails one piece of a repair for the token `lacking`, and takes any other
 */
export function changingPlug(): DomainPlug {
  const broken = new Set<number>(BROKEN.map((piece) => piece.place));
  const answer =
    (run: "check" | "repair"): DomainPlug["check"] =>
    async (token, settings) => {
      const refusal = token === "" ? "token" : REFUSED_TOKENS[token];
      if (refusal !== undefined) return { ok: false, refusal };

      await settings();
      const left = BROKEN.filter((piece) => broken.has(piece.place));
      if (run === "check") return changing(Object.fromEntries(left.map((piece) => [piece.place, piece.found])));

      const lacked = (place: number): boolean => token === LACKING_TOKEN && place === LACKED.place;
      for (const piece of left.filter((one) => !lacked(one.place))) broken.delete(piece.place);

      return changing(Object.fromEntries(left.map((piece) => [piece.place, lacked(piece.place) ? "failed" : piece.mended])));
    };

  return { ...TOKEN_FORM, check: answer("check"), repair: answer("repair") };
}

/**
 * Build the provider's side of an install with nothing set.
 *
 * @returns a first run whose plug creates every object; it takes any text with a dot in it as a domain
 */
export function previewFirstRun(): FirstRun {
  return { ...TOKEN_FORM, plugFor: (first) => (first.domain.includes(".") ? previewPlug("fresh") : undefined) };
}

/**
 * Build a plug that stays in one state.
 *
 * @returns a plug that reads the settings before it answers a table, as a real one does once the token is proven
 */
export function previewPlug(state: PlugState): DomainPlug {
  const answer =
    (read: typeof checked): DomainPlug["check"] =>
    async (token, settings) => {
      const refusal = token === "" ? "token" : REFUSALS[state];
      if (refusal !== undefined) return { ok: false, refusal };

      await settings();

      return read(state);
    };

  return { ...TOKEN_FORM, check: answer(checked), repair: answer(repaired) };
}
