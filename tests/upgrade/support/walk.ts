// The walk: one site taken through every site action, by one tree's command against an install. The actions are the table both faces of the product implement, read from the tree whose command is run.

import type { SITE_ACTIONS } from "../../../packages/core/src/actions";
import { fault, field, type Machine, runCli } from "./command";
import { part, type Tree } from "./trees";

/** Where a tree lists its site actions: the module from its root, and the export. */
const ACTIONS = ["packages/core/src/actions.ts", "SITE_ACTIONS"] as const;

/** The action that gives a site a new id: the walk goes on, and ends, under the id it answers. */
const RENAMES = "new-link";

/** The actions that find nothing to do unless another was done first. */
const NEEDS: Readonly<Record<string, string>> = { rollback: "publish", restore: "delete" };

/** The command line of each site action on a site that has two versions, in the order they are run: every one finds the site as the one before left it. */
const WALK: { readonly [Action in (typeof SITE_ACTIONS)[number]["action"]]: (site: string, folder: string) => readonly string[] } = {
  publish: (site, folder) => ["publish", folder, "--site", site],
  set: (site) => ["set", site, "--unlisted"],
  show: (site) => ["show", site],
  list: () => ["list"],
  rollback: (site) => ["rollback", site],
  delete: (site) => ["delete", site],
  restore: (site) => ["restore", site],
  duplicate: (site) => ["duplicate", site],
  "new-link": (site) => ["new-link", site],
};

/** Who walks, and where. */
interface Walker {
  /** The tree whose command is run. */
  readonly cli: Tree;

  /** The install it is run against, and the token it presents. */
  readonly machine: Machine;

  /** The folder of a small site to publish. */
  readonly folder: string;

  /** The trees on both ends of the wire: an action is walked when both have it. */
  readonly both: readonly Tree[];
}

/** What a walk came to. */
interface Walked {
  /** The id the walked site has now; `undefined` when none was made. */
  readonly site: string | undefined;

  /** What went wrong, a line each; none for a walk whose every command did its work or asked for an update. */
  readonly faults: readonly string[];
}

async function actionsOf(tree: Tree): Promise<readonly string[]> {
  return (await part<readonly { readonly action: string }[]>(tree, ...ACTIONS)).map(({ action }) => action);
}

/** The actions both ends can walk, each with its line, and a fault for each action of an end that this walk has no line for. */
async function linesOf(
  both: readonly Tree[],
): Promise<{ readonly lines: readonly (readonly [action: string, line: (typeof WALK)[keyof typeof WALK]])[]; readonly faults: readonly string[] }> {
  const known = await Promise.all(both.map(actionsOf));
  const lines = Object.entries(WALK).filter(([action]) => known.every((actions) => actions.includes(action)));
  const unwalked = known.flat().filter((action) => !Object.hasOwn(WALK, action));

  return { lines, faults: [...new Set(unwalked)].map((action) => `the site action \`${action}\` has no line in the walk of tests/upgrade`) };
}

/** Publish the site a walk starts from. */
async function publishNew(walker: Walker, name: string): Promise<Walked> {
  const made = await runCli(walker.cli, walker.machine, ["publish", walker.folder, "--name", name]);
  const wrong = fault(made);
  if (made.exit !== 0) return { site: undefined, faults: wrong === undefined ? [] : [wrong] };

  const id = field(field(made.answer, "site"), "id");
  if (typeof id !== "string") return { site: undefined, faults: [`\`${made.line}\` answered no site`] };

  return { site: id, faults: [] };
}

/**
 * Take one site through every site action with a tree's command.
 *
 * @param site - the id of a site of the install to walk; left out, a new site called `name` is published first
 * @returns the site and the faults. The walk ends at the first fault. A command refused with a hint to update is none, and the action that needs it is not walked
 */
export async function walk(walker: Walker, name: string, site?: string): Promise<Walked> {
  const { lines, faults } = await linesOf(walker.both);
  if (faults.length > 0) return { site, faults };

  const started = site === undefined ? await publishNew(walker, name) : { site, faults: [] };
  if (started.site === undefined) return started;

  let id = started.site;
  const refused = new Set<string>();

  for (const [action, line] of lines) {
    if (refused.has(NEEDS[action] ?? "")) continue;

    const ran = await runCli(walker.cli, walker.machine, line(id, walker.folder));
    const wrong = fault(ran);
    if (wrong !== undefined) return { site: id, faults: [wrong] };

    if (ran.exit !== 0) refused.add(action);

    const renamed = field(field(ran.answer, "site"), "id");
    if (action === RENAMES && typeof renamed === "string") id = renamed;
  }

  return { site: id, faults: [] };
}
