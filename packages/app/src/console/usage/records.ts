// What the Usage screen asks of whoever hosts the install: the free plan's limits no setting holds, the host's own pages of figures, and those figures themselves where the host can read them.
//
//   line            poplin's own number                        the host's own figure
//   requests        the sites' requests of the day, sampled    every request the account answered today
//   rows read       the rows this install's database read      the account's rows read today
//   rows written    the rows this install's database wrote     the account's rows written today
//   storage         the bytes the sites hold                   the bytes the account's storage holds
//   storage calls   none                                       the month's writes and reads of the storage
//
// The names, the numbers, and the addresses are the host's: this file names no host.

import type { RowsUsed } from "@poplin/core/src/database/database";

import type { Keyed } from "../key/records";

/** The host's own figures of its account at one moment. A figure the host gave none of is left out. */
export interface HostFigures {
  /** When the host was asked, in milliseconds since the epoch. */
  readonly at: number;

  /** Every request the account answered on the UTC day. */
  readonly requests?: number;

  /** The rows the account's databases read on the UTC day. */
  readonly rowsRead?: number;

  /** The rows the account's databases wrote on the UTC day. */
  readonly rowsWritten?: number;

  /** The bytes the account's storage holds. */
  readonly storedBytes?: number;

  /** The writes and listings of the storage in the UTC month. */
  readonly storageWrites?: number;

  /** The reads of the storage in the UTC month. */
  readonly storageReads?: number;
}

/** The most the free plan takes of each thing no setting bounds. */
interface HostLimits {
  /** Requests of the account a UTC day. */
  readonly requestsPerDay: number;

  /** Rows the databases read a UTC day. */
  readonly rowsReadPerDay: number;

  /** Rows the databases write a UTC day. */
  readonly rowsWrittenPerDay: number;

  /** Bytes the storage holds. */
  readonly storedBytes: number;

  /** Writes and listings of the storage a month. */
  readonly storageWritesPerMonth: number;

  /** Reads of the storage a month. */
  readonly storageReadsPerMonth: number;
}

/** The host's side of the Usage screen. */
export interface UsageHost {
  /** The host's name, as a link to its pages says it. */
  readonly name: string;

  /** The free plan's limits. */
  readonly limits: HostLimits;

  /** The host's own pages of figures, each an `https` address: of the requests, of the database, and of the storage. */
  readonly links: { readonly requests: string; readonly database: string; readonly storage: string };

  /** The rows the database used on a UTC day, such as `2026-11-13`, that this instance has counted and not written to the day yet; left out by a host that counts none. */
  readonly unwrittenRows?: (day: string) => RowsUsed;

  /** Asks the host for its own figures at a moment, in milliseconds since the epoch, with the install's kept key, and never rejects: `no_key` while the install keeps none. Left out by a host that reads no figures. */
  readonly official?: (now: number) => Promise<Keyed<HostFigures>>;
}
