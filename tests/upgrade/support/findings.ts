// What the upgrade check finds: one line per thing that outlived a release and that this code no longer takes, under the shape it belongs to.

/** Every stored or exchanged shape that outlives a release. */
const SHAPES = [
  "database",
  "settings",
  "storage",
  "backup",
  "login file",
  "this command on that install",
  "that command on this install",
  "update notice",
  "module",
] as const;

/** One of those shapes. */
export type Shape = (typeof SHAPES)[number];

/** One thing the code being upgraded from left behind, or sends, that this code does not take as it is. */
export interface Finding {
  readonly shape: Shape;
  readonly problem: string;
}

/**
 * Build the findings of one shape.
 *
 * @param problems - what is wrong, a line each
 */
export function found(shape: Shape, problems: readonly string[]): Finding[] {
  return problems.map((problem) => ({ shape, problem }));
}

/**
 * Run one part of the check, and turn what it throws into a finding of its shape.
 *
 * @param what - the part, in a few words; a finding made of a throw starts with them
 */
export async function attempt(shape: Shape, what: string, run: () => Promise<readonly string[]>): Promise<Finding[]> {
  try {
    return found(shape, await run());
  } catch (error) {
    return found(shape, [`${what} failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`]);
  }
}

/** Whether a value after the upgrade names what an address of the first install named: an address whose first host label is the last path segment of the first, a site's host label; any address for the install's own. */
function namesTheSame(written: string, after: unknown, address: string): boolean {
  if (after === written) return true;

  if (typeof after !== "string" || !URL.canParse(after)) return false;

  const segments = written.slice(written.indexOf(address) + address.length).split("/");
  const label = segments.filter((part) => part !== "").at(-1);

  return label === undefined || new URL(after).hostname.split(".")[0] === label;
}

/**
 * Compare what a read answered before an upgrade with what it answers after.
 *
 * Every value of `before` must be in `after` at the same place; `after` may hold more. The second install answers at another address than the first, so an address of the first is compared by what it names alone.
 *
 * @param address - the address the first install answered at
 * @param at - where the two values sit in their answers, for the lines returned
 * @returns one line per value that is gone or changed
 */
export function differences(before: unknown, after: unknown, address: string, at = "the answer"): string[] {
  const changed = [`${at} was ${JSON.stringify(before)} and is ${JSON.stringify(after)}`];
  if (typeof before === "string" && before.includes(address)) return namesTheSame(before, after, address) ? [] : changed;

  if (typeof before !== "object" || before === null) return Object.is(before, after) ? [] : changed;

  if (typeof after !== "object" || after === null) return changed;

  if (Array.isArray(before)) return listDifferences(before, after, address, at);

  const now: Readonly<Record<string, unknown>> = Object(after);

  return Object.entries(before).flatMap(([key, value]) => differences(value, now[key], address, `${at}.${key}`));
}

/** The differences of a list: its length, or else each of its values in place. */
function listDifferences(before: readonly unknown[], after: object, address: string, at: string): string[] {
  if (!Array.isArray(after)) return [`${at} held ${before.length} and holds no list`];

  if (after.length !== before.length) return [`${at} held ${before.length} and holds ${after.length}`];

  return before.flatMap((value, index) => differences(value, after[index], address, `${at}.${index}`));
}
