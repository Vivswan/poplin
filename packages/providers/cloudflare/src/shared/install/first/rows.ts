// The rows of a kind's own repair, as the rows a command prints: an install and a repair from a terminal word the same objects alike.
//
//   a dry run    `missing` is what a run makes, and `differs` what it changes
//   a run        `missing` and `differs` are what the run could not bring to what it should be

import type { DomainRow } from "@poplin/app/src/console/domain/records";
import type { Blocked, Row, RowState } from "@poplin/core/src/install/installer";
import { INSTALL_OBJECTS } from "../install-objects";
import type { CloudflareFailure } from "../client";
import type { Mode } from "../sync";

/** What a row says before the permission a token lacks. */
export const LACKS = "The account token lacks";

/** The states of a row that leave a run not done. */
export const UNDONE: ReadonlySet<RowState> = new Set(["block", "fail", "not-run"]);

/** What each state of a repair's row is as a row of a command: a check's `missing` is what a run makes, and after a run it is what the run could not make. */
const STATES: Readonly<Record<Mode, Readonly<Record<DomainRow["state"], RowState>>>> = {
  plan: { present: "leave", missing: "make", differs: "change", "left-out": "leave-out", optional: "leave-out", created: "make", changed: "change", removed: "remove", failed: "fail", "not-run": "not-run" },
  apply: { present: "leave", missing: "block", differs: "block", "left-out": "leave-out", optional: "leave-out", created: "make", changed: "change", removed: "remove", failed: "fail", "not-run": "not-run" },
};

/**
 * Why a call failed, with nothing Cloudflare said but its status and the numbers of its error codes.
 *
 * The sentence beside a code is never passed on: it may quote an id, an address, or the key it was sent with, and a row is printed, kept, and answered.
 */
export function failureWords(failure: CloudflareFailure): string {
  if (failure.failure === "rate-limited") return "Cloudflare asked to wait";

  if (failure.failure === "network") return "no answer from Cloudflare";

  const codes = failure.errors.map((error) => error.code).join(", ");

  return codes === "" ? `refused with status ${failure.status}` : `refused with status ${failure.status} and codes ${codes}`;
}

/**
 * Word a row of the repair as a row of a command.
 *
 * Where Access is off, the rows that wait for it are blocked in a dry run too: a run cannot make them.
 * Where it is on, a dry run names the login's variable as a run does, with no word on when it is written.
 *
 * @param loginOff - whether Access is switched off for the account
 */
export function rowOf(row: DomainRow, mode: Mode, loginOff: boolean): Row {
  const login = row.state === "missing" && row.detail.startsWith(`${INSTALL_OBJECTS.accessBinding}:`);
  const waits = loginOff && row.state === "missing" && (login || row.object.startsWith("Access"));
  const state = waits || (row.state === "failed" && row.right !== undefined) ? "block" : STATES[mode][row.state];

  return { object: row.object, state, detail: login && !waits ? INSTALL_OBJECTS.accessBinding : row.detail, ...(row.right === undefined ? {} : { right: row.right }) };
}

/**
 * Name each permission the rows of a run say the token lacks, once.
 *
 * @param form - the address of the token's form, where a permission is added
 * @returns one block a permission, in the order the rows name them
 */
export function lackingOf(rows: readonly Row[], form: string): Blocked[] {
  const rights = [...new Set(rows.flatMap((row) => (row.right === undefined ? [] : [row.right])))];

  return rights.map((right) => ({ what: "right_lacking", right, words: `${LACKS} ${right}`, address: form }));
}
