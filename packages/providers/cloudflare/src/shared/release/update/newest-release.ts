// The newest release the project published, fetched for a run with a person's token: the first upload of an install, and the upload of a repair.
//
//   releases.json at the project's website   which releases there are, each with the digest of its manifest and its schema
//   the release's page                       the manifest, the built module, and its map, each checked against the digest one step up
//
// Nothing but those two places is asked, and nothing is changed.

import type { Reach } from "@poplin/core/src/install/installer";
import { newestPinned, type ReleasePins } from "@poplin/core/src/records/release";
import { firstBindings } from "../../install/first/first-bindings";
import { projectReleases } from "../publish/release-source";
import { type CheckedBundle, checkedBundle } from "./bundle-files";
import { statesOwnBinding } from "./upload";

/** A release ready to upload. */
export interface Release {
  /** Its checked files. */
  readonly bundle: CheckedBundle;

  /** What states the first value of each binding it keeps by name. */
  readonly first: NonNullable<ReturnType<typeof firstBindings>>;

  /** The schema its code keeps a database at. */
  readonly schema: number;

  /** Every release the website names, this one among them. */
  readonly pins: ReleasePins;
}

/** Why there is no release to upload: no answer, none published, files that are not the published ones, or a release this code cannot place. */
export type NoRelease = "unreachable" | "no_release" | "bad_release" | "newer_release";

/**
 * Fetch the newest release the project published, with every digest checked.
 *
 * @returns the release, or why there is none; `newer_release` is one no upload of this code places: its manifest is not read as an upload, it keeps a binding this code has no first value for, or it states a binding no release may state
 */
export async function newestRelease(reach: Pick<Reach, "fetch">): Promise<Release | NoRelease> {
  const pins = await projectReleases({ fetch: reach.fetch }).pins();
  if (pins === undefined) return "unreachable";

  const version = newestPinned(pins);
  const pin = version === undefined ? undefined : pins[version];
  if (version === undefined || pin === undefined) return "no_release";

  const checked = await checkedBundle({ fetch: reach.fetch }, version, pin);
  if (!checked.ok && checked.why === "unreachable") return "unreachable";

  if (!checked.ok) return checked.why === "needs_hand" ? "newer_release" : "bad_release";

  const first = firstBindings(checked.bundle.deploy.bindings.flatMap((binding) => (binding.kind === "kept" ? [binding.name] : [])));

  return first === undefined || statesOwnBinding(checked.bundle) ? "newer_release" : { bundle: checked.bundle, first, schema: pin.schema, pins };
}
