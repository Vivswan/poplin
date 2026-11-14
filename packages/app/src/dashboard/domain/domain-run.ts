// One run of the domain plug for the Domain tab or the setup page: the token goes in, the rows come out, and one audit entry says what was found or done.

import type { Install } from "@poplin/core/src/actions/records";
import type { AuditEntry } from "@poplin/core/src/records/audit";

import type { DomainPlug, DomainReading, DomainSettings, ReadSettings } from "./records";

/** What stands where a token was, should a plug ever hand one back. */
const HIDDEN = "[token]";

/** The status of a page that holds no table. */
export const REFUSAL_STATUS = { token: 403, unreachable: 502, no_domain: 403, bad_domain: 400, bad_login: 400, allowance_spent: 503 } as const;

/** What a form asks of the plug: `check` reads, `repair` changes. */
export type DomainRun = "check" | "repair";

/** One run, as a form asked for it. */
interface Asked {
  /** Whether to read or to change. */
  readonly run: DomainRun;

  /** The pasted key, as it was typed. It is handed to the plug and to nothing else. */
  readonly token: string;

  /** Reads the settings the provider's side is made to match. The plug asks only once the token is proven. */
  readonly settings: ReadSettings;

  /** Who the audit entry names; left out where no session says, it names the first stored login. */
  readonly by?: AuditEntry["by"];

  /** The page the form was on. */
  readonly from: "dashboard" | "setup";

  /** Whether the run gets an audit entry; left out, it does. A run on an install with no stored settings gets none: nobody is there to name, and whoever sent it has proven nothing of this install. */
  readonly unrecorded?: boolean;
}

function hidden(text: string, token: string): string {
  if (token === "") return text;

  return text.replaceAll(token, HIDDEN);
}

// The plug is not trusted with the promise that no text of its own holds the token.
function withoutToken(reading: DomainReading, token: string): DomainReading {
  if (!reading.ok) return reading;

  return {
    ok: true,
    rows: reading.rows.map((row) => ({ object: hidden(row.object, token), state: row.state, detail: hidden(row.detail, token) })),
    steps: reading.steps.map((step) => ({ text: hidden(step.text, token), address: hidden(step.address, token) })),
  };
}

// Every object by its state, the ones that already stood left out: `{ "created": ["DNS record: poplin.example.com"] }`.
function byState(reading: Extract<DomainReading, { ok: true }>): Record<string, string[]> {
  const changed = reading.rows.filter((row) => row.state !== "present");

  return Object.fromEntries(
    [...new Set(changed.map((row) => row.state))].map((state) => [
      state,
      changed.filter((row) => row.state === state).map((row) => `${row.object}: ${row.detail}`),
    ]),
  );
}

/**
 * Run the plug once and write the run's audit entry.
 *
 * @returns the plug's reading with the token taken out of every text. A reading that is no table, such as a refused token, writes no audit entry, an unrecorded run writes none either, and no entry ever holds the token
 * @throws {Error} the plug or the database failed
 */
export async function runDomain(plug: DomainPlug, install: Pick<Install, "database" | "now">, asked: Asked): Promise<DomainReading> {
  let read: DomainSettings | undefined;
  const settings: ReadSettings = async () => {
    read = await asked.settings();

    return read;
  };

  const answered = asked.run === "check" ? await plug.check(asked.token, settings) : await plug.repair(asked.token, settings);
  const reading = withoutToken(answered, asked.token);
  if (!reading.ok || asked.unrecorded === true) return reading;

  const by = asked.by ?? read?.logins[0];
  if (by === undefined) throw new Error("a table was read with no login behind it, so the audit entry has nobody to name");

  await install.database.appendAudit({ action: "domain_synced", detail: { run: asked.run, from: asked.from, ...byState(reading) } }, { by, at: install.now() });

  return reading;
}
