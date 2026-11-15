// A domain plug written by hand for the tests: it answers what a test scripted and records what it was asked with.

import type { DomainPlug, DomainReading, DomainRow, DomainSettings, FirstRun } from "../../../src/console/domain/records";

/** The token the tests paste. No answer, header, or audit entry may hold it. */
export const TOKEN = "planted-token-0123456789-abcdefghij";

/** One call the plug received. `settings` is what it read, or `undefined` when it never asked or the install had none. */
interface Call {
  readonly run: "check" | "repair";
  readonly token: string;
  readonly settings: DomainSettings | undefined;
}

/** What the fake says of its token and of the form that makes one. */
const TOKEN_FORM = {
  tokenRights: ["Records: Edit", "Routes: Edit"],
  tokenLink: "https://provider.example/tokens/new",
  tokenOptional: [{ right: "Rules: Edit", adds: "The provider stops floods first." }],
  tokenNote: "Choose what the account token is for.",
};

/** A plug and the calls it received. */
export interface FakePlug extends DomainPlug {
  readonly calls: Call[];
}

/** An install with every object in place but the admin hostname's record. */
const ONE_MISSING: readonly DomainRow[] = [
  { object: "DNS record", state: "present", detail: "*.example.com", part: "reach" },
  { object: "DNS record", state: "missing", detail: "poplin.example.com", part: "reach" },
  { object: "Worker route", state: "present", detail: "poplin.example.com/*", part: "reach" },
  { object: "Rate rule", state: "left-out", detail: "rate rule: the domain has other hostnames", part: "rest" },
];

/** The same install after a repair. */
const REPAIRED: readonly DomainRow[] = ONE_MISSING.map((row) => (row.state === "missing" ? { ...row, state: "created" } : row));

/**
 * Build a plug that answers each run with the reading a test gives.
 *
 * @param answer - makes the reading from the token it was asked with, so a test can write a plug that hands the token back
 * @returns a plug that asks for the settings only for a reading that is a table, as a real plug asks only once the token is proven
 */
export function fakePlug(answer: (run: "check" | "repair", token: string) => DomainReading): FakePlug {
  const calls: Call[] = [];
  const asked =
    (run: "check" | "repair"): DomainPlug["check"] =>
    async (token, settings) => {
      const reading = answer(run, token);
      const read = reading.ok ? await settings() : undefined;
      calls.push({ run, token, settings: read });

      return reading;
    };

  return { calls, ...TOKEN_FORM, check: asked("check"), repair: asked("repair") };
}

/** A plug over the one-missing install: a check finds it, a repair fixes it. */
export function usualPlug(): FakePlug {
  return fakePlug((run) => ({ ok: true, rows: run === "check" ? ONE_MISSING : REPAIRED, steps: [] }));
}

/**
 * Build the provider's side of an install with nothing set, over a plug a test wrote.
 *
 * @returns a first run that hands that plug out for any text with a dot in it, takes anything else as no domain, and records what it was asked for
 */
export function firstRunOf(plug: FakePlug): FirstRun & { readonly asked: { domain: string; login: string }[] } {
  const asked: { domain: string; login: string }[] = [];

  return {
    asked,
    ...TOKEN_FORM,
    plugFor: (first) => {
      asked.push({ ...first });

      return first.domain.includes(".") ? plug : undefined;
    },
  };
}
