// The provider's side of the preview install, written by hand: it takes any token but an empty one, calls nothing, and answers the reading its state names.
//
//   fresh           nothing exists yet               a repair creates every object
//   partial         some objects missing or changed  a repair stops at a failure
//   access-off      the login service is not on      a step only a person can do
//   done            every object stands              nothing to repair
//   token-refused, unreachable, not-set-up           no table, only the refusal

import type { DomainPlug, DomainReading, DomainRow, DomainState } from "../../../app/src/dashboard/domain/records";

/** Every state a preview plug can be in, as the address of the setup page names it. */
export const PLUG_STATES = ["fresh", "partial", "access-off", "done", "token-refused", "unreachable", "not-set-up"] as const;

/** The objects of the sample install, as a provider would name them. */
const OBJECTS: readonly (readonly [object: string, detail: string])[] = [
  ["DNS record", "every site"],
  ["DNS record", "the dashboard"],
  ["Route", "every site"],
  ["Route", "the dashboard"],
  ["Login application", "the dashboard's login"],
  ["Login policy", "the logins of the settings"],
  ["Rate rule", "sample-rate-rule"],
];

/** What the preview says each setting does at its provider. */
const NOTES: DomainPlug["guardNotes"] = {
  outside_pages: "Pages of other domains framing a site or loading its files.",
  search_engines_allowed: "Search engines reach public sites.",
  block_bots: "auto blocks AI bots unless the domain has other hostnames.",
};

/** The one thing a person does by hand in the `access-off` state. */
const ACCESS_STEP = { text: "Turn the login service on for the account, then check again.", address: "https://provider.example.com/sample-account" };

/** The refusal of each state that reads no table. */
const REFUSALS: Partial<Record<PlugState, Extract<DomainReading, { ok: false }>["refusal"]>> = { "token-refused": "token", unreachable: "unreachable", "not-set-up": "not_set_up" };

/** One state of the preview's plug. */
export type PlugState = (typeof PLUG_STATES)[number];

/** Every object in one state, but the rows `others` names by their place. */
function rows(state: DomainState, others: Readonly<Record<number, DomainState>> = {}): DomainRow[] {
  return OBJECTS.map(([object, detail], place) => ({ object, detail, state: others[place] ?? state }));
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

  if (state === "partial") return table(rows("present", { 1: "created", 3: "failed", 4: "not-run", 5: "not-run", 6: "not-run" }));

  if (state === "access-off") return table(rows("present", { 4: "missing", 5: "missing" }), [ACCESS_STEP]);

  return table(rows("present"));
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

      if ((await settings()) === undefined) return { ok: false, refusal: "not_set_up" };

      return read(state);
    };

  return { tokenLabel: "Provider token", guardNotes: NOTES, check: answer(checked), repair: answer(repaired) };
}
