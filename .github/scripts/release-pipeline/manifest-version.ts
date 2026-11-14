/** The version release-please last released, read from its manifest. */

import { MANIFEST_FILE } from "./constants.js";
import { isRecord } from "./util.js";

/**
 * The one version the manifest holds, whatever path it is keyed by.
 *
 * @param text - the manifest file's content
 * @throws {Error} the text is not a JSON object with exactly one package, or its version is not a string
 */
export function manifestVersion(text: string): string {
  const manifest: unknown = JSON.parse(text);

  if (!isRecord(manifest)) {
    throw new Error(`${MANIFEST_FILE} is not a JSON object of package paths to versions.`);
  }

  const entries = Object.entries(manifest);
  const [entry] = entries;

  if (entry === undefined || entries.length !== 1) {
    throw new Error(
      `${MANIFEST_FILE} names ${entries.length} packages (${Object.keys(manifest).join(", ") || "none"}); the pipeline publishes one and reads its version from a manifest that holds exactly one.`,
    );
  }

  const [path, version] = entry;

  if (typeof version !== "string") {
    throw new Error(`${MANIFEST_FILE} gives ${JSON.stringify(path)} the version ${JSON.stringify(version)}, not a string.`);
  }

  return version;
}
