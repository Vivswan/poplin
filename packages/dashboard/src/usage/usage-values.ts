// What a line of the Usage screen says of a number beside its limit: the share used, and the words once it nears the limit. Also the bytes a line writes after "at most".

/** The share of a limit, in percent, from which a line says it is near. */
const NEAR_FROM = 80;

/** What each state of a line says. A line under its limit by a wide margin says nothing. */
const STATE_WORDS = { fine: null, near: "Near the limit", at: "At the limit", over: "Over the limit" } as const;

/** What a unit of bytes is to the one under it, and how many steps of a unit a written size tells apart: one decimal place. */
const WRITTEN = { unit: 1000, steps: 10 } as const;

/** How much of its limit a line has used: the percent, rounded down so only a limit reached reads as 100, and what it says. */
interface Share {
  readonly percent: number;
  readonly state: keyof typeof STATE_WORDS;
  readonly words: string | null;
}

function stateOf(used: number, limit: number): Share["state"] {
  if (used > limit) return "over";

  if (used === limit) return "at";

  return (used / limit) * 100 >= NEAR_FROM ? "near" : "fine";
}

/**
 * Raise a count of bytes to the next one a written size tells apart, so the size written after "at most" is never under the count: 5,099,999 is raised to 5,100,000, which is written 5.1 MB.
 *
 * @param bytes - a whole number from 0 up
 * @returns the count itself where it is written whole, under 1 kB or already on a step, and where the next step is past the whole numbers a size is written from
 */
export function raisedBytes(bytes: number): number {
  if (bytes < WRITTEN.unit) return bytes;

  const step = WRITTEN.unit ** Math.floor(Math.log(bytes) / Math.log(WRITTEN.unit)) / WRITTEN.steps;

  const raised = Math.ceil(bytes / step) * step;

  return Number.isSafeInteger(raised) ? raised : bytes;
}

/**
 * Work out how much of its limit a line has used.
 *
 * @param limit - the most a setting lets the number be; `null` where no setting bounds it
 * @returns the share, or `undefined` for a line with no limit or a limit of nothing
 */
export function shareOf(used: number, limit: number | null): Share | undefined {
  if (limit === null || limit <= 0) return undefined;

  const state = stateOf(used, limit);

  return { percent: Math.floor((used / limit) * 100), state, words: STATE_WORDS[state] };
}
