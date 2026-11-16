// One run of the domain plug for the Domain screen: the token goes in, the rows come out, and the install keeps the run: its pieces as the last check of the domain, and one audit entry that says what was found or done.
// A check with no token is the plug's own, made with what the install itself holds at the provider: it is kept the same way. One nobody pressed is kept with no audit entry.
// A repair that leaves every piece of the login and every object that holds the users standing has carried the users it read to the domain: a change of the users waits no more while those are still the stored ones.
// A repair that wrote such an object and stopped short may have left the domain with users of an earlier moment, so the change waits.

import { keepDomainRun } from "@poplin/core/src/actions/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { Login } from "@poplin/core/src/auth/logins";
import type { AuditEntry } from "@poplin/core/src/records/audit";
import type { CarriedUsers, CheckedPiece } from "@poplin/core/src/records/domain-check";

import type { DomainPlug, DomainReading, DomainRow, DomainSettings, DomainState, ReadSettings } from "./records";

/** What stands where a token was, should a plug ever hand one back. */
const HIDDEN = "[token]";

/** The status of a page that holds no table. */
export const REFUSAL_STATUS = { token: 403, unreachable: 502, no_domain: 403, allowance_spent: 503 } as const;

/** Where a run a person asked for comes from, as its audit entry says it: the dashboard's Domain screen. */
const FROM = "dashboard";

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

/** The states of an object a repair left as the settings ask. */
const STANDS: readonly DomainState[] = ["present", "created", "changed"];

/** The states of an object a repair wrote. */
const WRITTEN: readonly DomainState[] = ["created", "changed"];

/** What a form asks of the plug: `check` reads, `repair` changes. */
export type DomainRun = "check" | "repair";

/** One run, as a form asked for it. */
interface Asked {
  /** Whether to read or to change. */
  readonly run: DomainRun;

  /** The pasted key, as it was typed. It is handed to the plug and to nothing else. `null` asks for the plug's own check, which takes none: a plug that has no such check is asked with an empty token, which it refuses. */
  readonly token: string | null;

  /** Reads the settings the provider's side is made to match. The plug asks only once the token is proven. */
  readonly settings: ReadSettings;

  /** Who the audit entry names. */
  readonly by: AuditEntry["by"];

  /** Whether the run writes no audit entry: a check nobody pressed, which only renews what the install remembers. Left out, it writes one. */
  readonly unasked?: boolean;
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
      ...(row.users === undefined ? {} : { users: row.users }),
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

/** Whether a run carried the users to the domain: a repair, with no piece of the login left undone and every object that holds the users left as the settings ask. One the run could not read or change may hold the users of an earlier day. */
function carriedUsers(run: DomainRun, rows: readonly DomainRow[], pieces: readonly CheckedPiece[]): boolean {
  const login = pieces.every((piece) => piece.part !== "login" || piece.state === "ok");

  return run === "repair" && login && rows.every((row) => row.users !== true || STANDS.includes(row.state));
}

/**
 * Say what a run did to the users at the domain, as the install settles a change of them by it.
 *
 * @param logins - the logins the run read and worked with
 * @returns the logins of a repair that carried them; `null` after a repair that wrote an object that holds the users and carried them to no end, so what the domain holds is unknown; `undefined` for a run that wrote none
 */
function usersAfter(run: DomainRun, rows: readonly DomainRow[], pieces: readonly CheckedPiece[], logins: readonly Login[] | undefined): CarriedUsers["logins"] | undefined {
  if (logins !== undefined && carriedUsers(run, rows, pieces)) return logins;

  return run === "repair" && rows.some((row) => row.users === true && WRITTEN.includes(row.state)) ? null : undefined;
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

/** Ask the plug for one run: its own check where no token came and it has one, else the run the token is for. */
function askPlug(plug: DomainPlug, asked: Asked, token: string, settings: ReadSettings): Promise<DomainReading> {
  if (asked.run === "repair") return plug.repair(token, settings);

  return asked.token === null && plug.ownCheck !== undefined ? plug.ownCheck(settings) : plug.check(token, settings);
}

/**
 * Run the plug once and keep the run: its pieces as the last check of the domain, in place of the run kept before, and its audit entry. A problem the run shows as mended ends with it.
 *
 * @returns the plug's reading with the token taken out of every text. A reading that is no table, such as a refused token, keeps nothing, so the run kept before stays the last one.
 *   Nothing kept ever holds the token. A repair that left the login standing settles a change of the users while the logins it carried are the stored ones
 * @throws {Error} the plug or the database failed; nothing was kept
 */
export async function runDomain(plug: DomainPlug, install: Pick<Install, "database" | "now">, asked: Asked): Promise<DomainReading> {
  // A change of the users after the run began, or another try at the provider meanwhile, still waits after it.
  const began = install.now();
  let read: DomainSettings | undefined;
  const settings: ReadSettings = async () => {
    read = await asked.settings();

    return read;
  };

  const token = asked.token ?? "";
  const reading = withoutToken(await askPlug(plug, asked, token, settings), token);
  if (!reading.ok) return reading;

  const pieces = reading.rows.map(remembered);
  const detail = asked.unasked === true ? null : { run: asked.run, from: FROM, ...byState(reading) };
  const carried = usersAfter(asked.run, reading.rows, pieces, read?.logins);
  await keepDomainRun(install, { ran_at: install.now(), by: asked.by, run: asked.run, pieces }, detail, carried === undefined ? undefined : { logins: carried, since: began });

  return reading;
}
