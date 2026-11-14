/** The bounded wait for a published version to show on the registry's record. */

import { setTimeout as sleep } from "node:timers/promises";
import type { Packument } from "./records.js";

/** One wait: what to read, what to look for, and the bound. */
export interface AwaitVersionOptions {
  /** One read of the registry's record; null while the package has never been published. */
  read: () => Promise<Packument | null>;

  /** The version the record must show. */
  version: string;

  /** How many times the record is read while it lacks the version. */
  attempts: number;

  /** The pause between reads, in milliseconds. */
  delayMs: number;
}

/**
 * Reads the record until it shows the version: npm makes a publish readable asynchronously, and a job that ends before
 * then lets the next one judge a record without it.
 *
 * A read that fails counts as one that did not show the version, so the wait runs its whole budget either way.
 *
 * @returns the record that shows the version and the reads it took, or null when no read within the bound showed it
 * @throws {Error} the attempts are not a positive integer, or the last read failed
 */
export async function awaitVersion(options: AwaitVersionOptions): Promise<{ packument: Packument; reads: number } | null> {
  const { read, version, attempts, delayMs } = options;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`the read attempts must be a positive integer, not ${attempts}`);
  }

  let failure: unknown;

  for (let reads = 1; reads <= attempts; reads++) {
    if (reads > 1) await sleep(delayMs);

    try {
      const packument = await read();
      failure = undefined;
      if (packument !== null && Object.hasOwn(packument.versions, version)) return { packument, reads };
    } catch (error) {
      failure = error;
    }
  }

  if (failure !== undefined) {
    throw failure;
  }

  return null;
}
