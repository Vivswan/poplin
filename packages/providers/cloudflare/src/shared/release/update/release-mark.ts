// The release a Worker's code is of, as the Worker itself carries it: the plain-text binding `RELEASE`, which every upload states.
//
//   PUT    .../workers/scripts/{name}             states the binding, and tags the version it makes
//   PATCH  .../workers/scripts/{name}/settings    keeps the binding as every other, and makes a version with no annotation unless the change states them
//
// A binding stays through every change of the settings, whoever makes it, so the release is read from the bindings and never from a version's tag.
// The tag says the same of one version, for the install going back by itself: a change of the settings states it again from the binding, so the newest version of a release is one with every variable and key.
// An upload that states no such binding, as one made by another tool, leaves a Worker whose release is not read.

import { isPlainVersion } from "@poplin/core/src/records/update";
import { INSTALL_OBJECTS } from "../../install/install-objects";
import type { ListedBinding } from "../../install/pieces/variables/variables";
import type { SentBinding } from "./upload";

/** The annotations of a version: the release its code is of, and a line for a person. */
interface Tagged {
  readonly "workers/tag": string;
  readonly "workers/message": string;
}

/**
 * State the release of the code an upload sends.
 *
 * @param version - the release's version, as its manifest names it
 */
export function releaseBinding(version: string): SentBinding {
  return { name: INSTALL_OBJECTS.releaseBinding, type: "plain_text", text: version };
}

/**
 * Tag the version a change makes with the release its code is of.
 *
 * @param made - what made the version, after the release in the line a person reads
 */
export function taggedAs(version: string, made: string): Tagged {
  return { "workers/tag": version, "workers/message": `poplin ${version}, ${made}` };
}

/**
 * Read the release a Worker's code is of.
 *
 * @param bindings - every binding of the Worker, as Cloudflare lists them
 * @returns the version; `undefined` for a Worker with no such binding, and for a text that is no released version: the binding is a text whoever may write the Worker sets
 */
export function readRelease(bindings: readonly ListedBinding[]): string | undefined {
  const text = bindings.find((binding) => binding.name === INSTALL_OBJECTS.releaseBinding && binding.type === "plain_text")?.text;

  return typeof text === "string" && isPlainVersion(text) ? text : undefined;
}
