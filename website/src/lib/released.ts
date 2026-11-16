import { readFileSync } from "node:fs";
import { releases } from "./changelog.ts";

// The repository's changelog, or nothing while no version is released and the file does not exist.
const REPOSITORY_CHANGELOG = import.meta.glob<string>("../../../CHANGELOG.md", { eager: true, query: "?raw", import: "default" });

/**
 * The releases an install may take, by version, each with the digest of its files: the file `POPLIN_RELEASE_PINS` names, as the step before the build wrote it.
 * None when the variable is not set, as in a build on a person's computer.
 */
export function releasePins(): Record<string, unknown> {
  const file = process.env.POPLIN_RELEASE_PINS;

  return file ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/**
 * The newest released version an install may take, and its day, from the repository's changelog or from the file `POPLIN_CHANGELOG` names.
 * A version whose digest is not published is passed over, so no install is told of a release it would refuse; nothing when no version is left.
 */
export function released(): { version: string; released: string } | undefined {
  const override = process.env.POPLIN_CHANGELOG;
  const changelog = override ? readFileSync(override, "utf8") : (REPOSITORY_CHANGELOG["../../../CHANGELOG.md"] ?? "");
  const pins = releasePins();

  return releases(changelog).find(({ version }) => Object.hasOwn(pins, version));
}
