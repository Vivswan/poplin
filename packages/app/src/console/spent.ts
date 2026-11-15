// The console's answer while a day's allowance is used up: the database's free reading or writing, or the storage's writes and listings.
//
//   <base>/data/...   the refusal as the client reads it, with its sentence
//   any other path    the sentence in plain text: no page can be drawn, since the frame reads the settings
//
// Both are a 503 with the seconds to the next midnight UTC, when the day's allowance begins anew.

import { AllowanceSpent, secondsToNextDay } from "@poplin/core/src/database/driver";
import { WritesSpent } from "@poplin/core/src/storage/metered";

import { refusalSentence } from "./notices";

/** The code of the refusal, the API's own for the same day: what ran out is what the refusal is about. */
const CODE = "allowance_spent";

/** The sentence of each allowance of the database that is used up for the day, by its row in the table of sentences. */
const SENTENCES = { writing: "no_more_writing", reading: "no_more_reading" } as const;

/** What a listing of the storage that the day's writes have no room for is about: the setting that bounds them. */
const WRITES_SETTING = "max_storage_writes_per_day";

/** Where a request was sent, and when. */
interface Asked {
  /** The path of the request. */
  readonly path: string;

  /** The path every route of the console starts with; empty for the root. */
  readonly base: string;

  /** The clock, in milliseconds since the epoch. */
  readonly now: number;
}

/** A day's allowance that is used up, as the database or the counted storage throws it. */
type Spent = AllowanceSpent | WritesSpent;

/**
 * Decide whether a failure is a day's allowance used up.
 *
 * @param error - what a request failed with
 */
export function isSpent(error: unknown): error is Spent {
  return error instanceof AllowanceSpent || error instanceof WritesSpent;
}

/**
 * Build the answer to a request of the console that met a day's allowance used up.
 *
 * @returns status 503 with `Retry-After` up to the next midnight UTC: for a data route the refusal `allowance_spent` as JSON, about what ran out; for a page its sentence as plain text
 */
export function spentAnswer(spent: Spent, asked: Asked): Response {
  const about = spent instanceof WritesSpent ? WRITES_SETTING : spent.spent;
  const sentence = refusalSentence(spent instanceof WritesSpent ? CODE : SENTENCES[spent.spent]);
  const headers = { "Retry-After": String(secondsToNextDay(asked.now)), "Cache-Control": "no-store" };
  if (asked.path.startsWith(`${asked.base}/data/`)) return Response.json({ ok: false, code: CODE, about, sentence }, { status: 503, headers });

  return new Response(`${sentence}\n`, { status: 503, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}
