/** The npm version trusted publishing needs, checked against the npm on PATH. */

import { execFileSync } from "node:child_process";
import { NPM_FLOOR } from "./constants.js";

/**
 * Whether a version is at or above the floor.
 *
 * Bun's own semver orders a two-digit minor numerically and puts a prerelease of the floor below it. A string that is
 * no version at all counts as below it.
 */
export function atFloor(version: string, floor: string = NPM_FLOOR): boolean {
  return Bun.semver.satisfies(version, `>=${floor}`);
}

/**
 * The npm on PATH and whether it can publish through OIDC. Nothing is installed: the workflow picks the npm.
 *
 * @throws {Error} npm is not on PATH, or `npm --version` failed
 */
export function npmFloor(): { version: string; atFloor: boolean } {
  const version = execFileSync("npm", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

  return { version, atFloor: atFloor(version) };
}
