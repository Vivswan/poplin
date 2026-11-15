// A heading release-please writes for a version: `## 0.1.0 (2026-11-20)`, or `## [0.2.0](compare link) (2026-12-04)`.
const RELEASE_HEADING = /^#{2,3} \[?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\([^)]*\))? \((\d{4}-\d{2}-\d{2})\)$/m;

/** The newest version in the changelog release-please writes, which puts it first, and its day as `YYYY-MM-DD`; nothing when no version is released. */
export function newestRelease(changelog: string): { version: string; released: string } | undefined {
  const [, version, released] = RELEASE_HEADING.exec(changelog) ?? [];

  if (version === undefined || released === undefined) {
    return undefined;
  }

  return { version, released };
}
