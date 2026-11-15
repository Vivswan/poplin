import { readFileSync } from "node:fs";
import { newestRelease } from "./changelog.ts";

// The repository's changelog, or nothing while no version is released and the file does not exist.
const REPOSITORY_CHANGELOG = import.meta.glob<string>("../../../CHANGELOG.md", { eager: true, query: "?raw", import: "default" });

/** The newest released version and its day, from the repository's changelog or from the file `POPLIN_CHANGELOG` names; nothing when no version is released. */
export function released(): ReturnType<typeof newestRelease> {
  const override = process.env.POPLIN_CHANGELOG;
  const changelog = override ? readFileSync(override, "utf8") : (REPOSITORY_CHANGELOG["../../../CHANGELOG.md"] ?? "");

  return newestRelease(changelog);
}
