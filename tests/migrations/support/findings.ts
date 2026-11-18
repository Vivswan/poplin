// What the upgrade check finds: one line per thing that outlived a release and that this code no longer takes, under the shape it belongs to.

import diff from "microdiff";

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

/** The line of one value that is not what it was. */
function changed(at: string, before: unknown, after: unknown): string {
  return `${at} was ${JSON.stringify(before)} and is ${JSON.stringify(after)}`;
}

/** The line of the outermost list on the way to a difference that holds another count than it held, if there is one: such a list is told once, by its two counts, and nothing inside it is told. */
function resized(path: readonly (string | number)[], before: unknown, after: unknown, at: string): string | undefined {
  let was: unknown = [before];
  let now: unknown = [after];

  for (const [depth, key] of path.entries()) {
    if (Array.isArray(was) && Array.isArray(now) && was.length !== now.length) return `${[at, ...path.slice(1, depth)].join(".")} held ${was.length} and holds ${now.length}`;

    was = Object(was)[key];
    now = Object(now)[key];
  }

  return undefined;
}

/** The lines of one value that changed in place. An address is compared by what it names, a list that became an object is no list, and an object that became a list is read key by key. */
function changes(at: string, before: unknown, after: unknown, address: string): string[] {
  if (typeof before === "string" && before.includes(address)) return namesTheSame(before, after, address) ? [] : [changed(at, before, after)];

  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) return [changed(at, before, after)];

  if (Array.isArray(before)) return [`${at} held ${before.length} and holds no list`];

  if (!Array.isArray(after)) return [changed(at, before, after)];

  const now: Readonly<Record<string, unknown>> = Object(after);
  const kept = Object.fromEntries(Object.keys(before).map((key) => [key, now[key]]));

  return differences(before, kept, address, at);
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
  const lists = new Set<string>();

  return diff([before], [after]).flatMap((difference): string[] => {
    const list = resized(difference.path, before, after, at);
    if (list !== undefined) {
      const told = lists.has(list);
      lists.add(list);

      return told ? [] : [list];
    }

    const place = [at, ...difference.path.slice(1)].join(".");
    if (difference.type === "CREATE") return [];

    if (difference.type === "CHANGE") return changes(place, difference.oldValue, difference.value, address);

    return difference.oldValue === undefined ? [] : [changed(place, difference.oldValue, undefined)];
  });
}
