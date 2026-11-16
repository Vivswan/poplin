// What the Usage screen asks of whoever hosts the install: the free plan's limits no setting holds, the host's own pages of figures, and those figures themselves where the host can read them.
//
//   line            poplin's own number                        the host's own figure
//   requests        the sites' requests of the day, sampled    every request the account answered today
//   rows read       the rows this install's database read      the account's rows read today
//   rows written    the rows this install's database wrote     the account's rows written today
//   storage         the bytes the sites hold                   the bytes the account's storage held, each part at its most in a day
//   storage calls   none                                       the month's writes and reads of the storage
//   database size   the bytes this install's database holds    the bytes every database of the account holds
//   errors, time    none                                       the day's failed requests, the ones a limit stopped, and the processing time of the slowest
//   files, uploads  the files the sites hold                   every file the account's storage holds, and its uploads left unfinished
//   jobs            none                                       the day's background jobs started, done, and failed, and the ones running now
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

  /** The bytes the account's storage held: every part of it at its most in the 24 hours before the host was asked, added up. */
  readonly storedBytes?: number;

  /** The writes and listings of the storage in the UTC month. */
  readonly storageWrites?: number;

  /** The reads of the storage in the UTC month. */
  readonly storageReads?: number;

  /** The requests of the account that failed on the UTC day. */
  readonly errors?: number;

  /** The requests of the account the host ended on the UTC day because one used more than a request may. */
  readonly stopped?: number;

  /** The processing time of the UTC day's requests that 99 in 100 stayed under, in milliseconds. */
  readonly slowestMs?: number;

  /** The bytes the account's databases held: each at its most on the UTC day and the one before, added up. */
  readonly databaseBytes?: number;

  /** The files the account's storage held: every part of it at its most in the 24 hours before the host was asked, added up. */
  readonly files?: number;

  /** The uploads to the account's storage that were begun and never finished, counted as the files are. */
  readonly unfinishedUploads?: number;

  /** The background jobs of the account that started on the UTC day. */
  readonly jobsStarted?: number;

  /** The background jobs of the account that ended well on the UTC day. */
  readonly jobsDone?: number;

  /** The background jobs of the account that failed on the UTC day. */
  readonly jobsFailed?: number;

  /** The background jobs of this install that run at the moment the host was asked. */
  readonly jobsRunning?: number;
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

  /** Bytes one database holds. */
  readonly databaseBytes: number;

  /** Bytes the databases of the account hold together. */
  readonly accountDatabaseBytes: number;

  /** Milliseconds of processing a request may use. */
  readonly processingMs: number;

  /** Background jobs that run at one time. */
  readonly jobsAtOnce: number;
}

/** The host's side of the Usage screen. */
export interface UsageHost {
  /** The host's name, as a link to its pages says it. */
  readonly name: string;

  /** The free plan's limits. */
  readonly limits: HostLimits;

  /** The host's own pages of figures, each an `https` address: of the requests, of the database, of the storage, and of the background jobs. */
  readonly links: { readonly requests: string; readonly database: string; readonly storage: string; readonly jobs: string };

  /** How far behind the moment the host's own figures run, in milliseconds; left out by a host that reads no figures. */
  readonly behindMs?: number;

  /** The bytes the install's own database held when it last answered this instance, or `undefined` before its first answer; left out by a host that cannot tell. */
  readonly databaseBytes?: () => number | undefined;

  /** The rows the database used on a UTC day, such as `2026-11-13`, that this instance has counted and not written to the day yet; left out by a host that counts none. */
  readonly unwrittenRows?: (day: string) => RowsUsed;

  /** Asks the host for its own figures at a moment, in milliseconds since the epoch, with the install's kept key, and never rejects: `no_key` while the install keeps none. Left out by a host that reads no figures. */
  readonly official?: (now: number) => Promise<Keyed<HostFigures>>;
}
