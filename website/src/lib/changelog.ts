// A heading release-please writes for a version: `## 0.1.0 (2026-11-20)`, or `## [0.2.0](compare link) (2026-12-04)`.
const RELEASE_HEADING = /^#{2,3} \[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\([^)]*\))? \((\d{4}-\d{2}-\d{2})\)$/gm;

/** Every version in the changelog release-please writes, newest first as it writes them, each with its day as `YYYY-MM-DD`. */
export function releases(changelog: string): { version: string; released: string }[] {
  return [...changelog.matchAll(RELEASE_HEADING)].flatMap(([, version, released]) => (version === undefined || released === undefined ? [] : [{ version, released }]));
}

/** The newest version in the changelog, and its day; nothing when no version is released. */
export function newestRelease(changelog: string): { version: string; released: string } | undefined {
  return releases(changelog)[0];
}
