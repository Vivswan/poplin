// The OpenTofu module of one tree, by the names an install made with it depends on: its inputs, which a variables file names, and its resource addresses, which the install's state names.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Tree } from "./trees";

/** The module's folder, from a tree's root. */
const MODULE = "packages/cloudflare/tofu";

/** The first line of an input or of a resource: the kind, then its one or two names. */
const DECLARED = /^(variable|resource)\s+"([^"]+)"(?:\s+"([^"]+)")?/gm;

/** A block that says where a resource went, or that it is given up on purpose: its `from` is an address the state may still hold. */
const LEFT = /^(?:moved|removed)\s*\{[^}]*?\bfrom\s*=\s*([\w.]+)/gm;

/** The names of one module. */
interface Names {
  /** Every input. */
  readonly inputs: ReadonlySet<string>;

  /** The address of every resource: what the state of an install made with the module holds. */
  readonly resources: ReadonlySet<string>;

  /** Every address a `moved` or `removed` block says the module has left. */
  readonly left: ReadonlySet<string>;
}

/** The names a tree's module declares; `undefined` for a tree that has no module. */
function namesOf(tree: Tree): Names | undefined {
  const folder = join(tree.root, MODULE);
  if (!existsSync(folder)) return undefined;

  const files = readdirSync(folder).filter((file) => file.endsWith(".tf"));
  const text = files.map((file) => readFileSync(join(folder, file), "utf8")).join("\n");
  const declared = [...text.matchAll(DECLARED)];
  const inputs = declared.filter(([, kind]) => kind === "variable").map(([, , name = ""]) => name);
  const resources = declared.filter(([, kind]) => kind === "resource").map(([, , type = "", name = ""]) => `${type}.${name}`);

  return { inputs: new Set(inputs), resources: new Set(resources), left: new Set(Array.from(text.matchAll(LEFT), ([, from = ""]) => from)) };
}

/**
 * Compare the module of two trees by name.
 *
 * @returns one line per input of `from` that `to` no longer declares, and per resource address of `from` that `to` neither declares nor names in a `moved` or `removed` block; none when `from` has no module
 */
export function moduleFaults(from: Tree, to: Tree): string[] {
  const before = namesOf(from);
  if (before === undefined) return [];

  const after = namesOf(to) ?? { inputs: new Set<string>(), resources: new Set<string>(), left: new Set<string>() };
  const gone = [...before.inputs].filter((input) => !after.inputs.has(input));
  const dropped = [...before.resources].filter((address) => !after.resources.has(address) && !after.left.has(address));

  return [
    ...gone.map((input) => `the module's input \`${input}\` is gone: a variables file that sets it no longer plans`),
    ...dropped.map((address) => `the module's resource \`${address}\` is gone with no \`moved\` or \`removed\` block: a plan destroys it`),
  ];
}
