// One run of the domain plug for the Domain tab or the setup page: the token goes in, the rows come out, and the install keeps the run: its pieces as the last check of the domain, and one audit entry that says what was found or done.
// A repair that leaves every piece of the login standing has carried the users to the domain, so a change of the users from before it waits for a repair no more.

import type { Install } from "@poplin/core/src/actions/records";
import type { AuditEntry } from "@poplin/core/src/records/audit";
import { type CheckedPiece, keptPieces } from "@poplin/core/src/records/domain-check";

import type { DomainPlug, DomainReading, DomainRow, DomainSettings, DomainState, ReadSettings } from "./records";

/** What stands where a token was, should a plug ever hand one back. */
const HIDDEN = "[token]";

/** The status of a page that holds no table. */
export const REFUSAL_STATUS = { token: 403, unreachable: 502, no_domain: 403, bad_domain: 400, bad_login: 400, allowance_spent: 503 } as const;

/** How the install remembers a row of each state that says how the object stands: what a repair did stands, and one that only lacks an optional right is not set up. */
const REMEMBERED: Readonly<Record<Exclude<DomainState, "failed" | "not-run" | "left-out">, Extract<CheckedPiece, { state: "ok" | "needs_repair" | "not_set_up" }>["state"]>> = {
  present: "ok",
  created: "ok",
  changed: "ok",
  removed: "ok",
  missing: "needs_repair",
  differs: "needs_repair",
  optional: "not_set_up",
};

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

  /** Whether the run is kept, as the last check of the domain and as an audit entry; left out, it is. A run on an install with no stored settings is not: nobody is there to name, and whoever sent it has proven nothing of this install. */
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
    rows: reading.rows.map((row) => ({
      object: hidden(row.object, token),
      state: row.state,
      detail: hidden(row.detail, token),
      part: row.part,
      ...(row.right === undefined ? {} : { right: hidden(row.right, token) }),
    })),
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

/** Whether a run carried the users to the domain: a repair, with no piece of the login left undone. */
function carriedUsers(run: DomainRun, pieces: readonly CheckedPiece[]): boolean {
  return run === "repair" && pieces.every((piece) => piece.part !== "login" || piece.state === "ok");
}

/** A row as the install remembers it. */
function remembered(row: DomainRow): CheckedPiece {
  const named = { piece: row.object, detail: row.detail, part: row.part };
  if (row.state === "not-run") return { ...named, state: "unread", reason: "not_run" };

  // The install works without a rule that was left out, and not without its login, a record, or a route.
  if (row.state === "left-out") return { ...named, state: row.part === "rest" ? "not_set_up" : "needs_repair" };

  if (row.state !== "failed") return { ...named, state: REMEMBERED[row.state] };

  return row.right === undefined ? { ...named, state: "unread", reason: "failed" } : { ...named, state: "unread", reason: "missing_right", right: row.right };
}

/**
 * Run the plug once and keep the run: its pieces as the last check of the domain, in place of the run kept before, and its audit entry.
 *
 * @returns the plug's reading with the token taken out of every text. A reading that is no table, such as a refused token, keeps nothing, so the run kept before stays the last one.
 *   An unrecorded run keeps nothing either, nor does one signed by a name that holds the token.
 *   Nothing kept ever holds the token. A repair that left the login standing settles a change of the users from before it began
 * @throws {Error} the plug or the database failed; nothing was kept
 */
export async function runDomain(plug: DomainPlug, install: Pick<Install, "database" | "now">, asked: Asked): Promise<DomainReading> {
  // A user added while the run is under way is not in the settings it carries, and still waits after it.
  const began = install.now();
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

  // An email typed on the setup page can hold the token, in whatever case, and a name cannot be scrubbed: such a run is not kept.
  if (asked.token !== "" && by.toLowerCase().includes(asked.token.toLowerCase())) return reading;

  const pieces = reading.rows.map(remembered);
  const check = { ran_at: install.now(), by, run: asked.run, pieces: keptPieces(pieces) };
  const detail = { run: asked.run, from: asked.from, ...byState(reading) };
  await install.database.keepDomainCheck(check, detail, carriedUsers(asked.run, pieces) ? began : undefined);

  return reading;
}
