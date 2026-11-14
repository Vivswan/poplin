/** The records the npm release pipeline's modules pass to each other. */

/** The dist-tag a run publishes under: `next` for a main commit's pre-release, `stable` for a release under `latest`. */
export type Channel = "next" | "stable";

/** Where a commit sits on main. */
export interface MainPosition {
  /** Commits reachable from it along first parents: one more per merge to main, whatever a merged branch held. */
  count: number;

  /** Its committer date in UTC, YYYYMMDD. */
  date: string;
}

/** What the registry holds for the package. */
export interface Packument {
  /** Every published version, keyed by its version string. */
  versions: Record<string, unknown>;

  /** The version each dist-tag names. */
  "dist-tags": Record<string, string>;
}

/** The commit graph as the publish decisions ask about it; the checkout answers in CI, a hand-written graph in tests. */
export interface Ancestry {
  /** The full sha a name resolves to, or null for a commit the graph lacks or a short sha naming several. */
  resolve(name: string): string | null;

  /** Whether `ancestor` is reachable from `descendant`; a commit is its own ancestor. */
  isAncestor(ancestor: string, descendant: string): boolean;
}

/** Whether a version may be published, and why not when it may not. */
export type PublishVerdict = { publish: true; version: string } | { publish: false; version: string; reason: string };

/** The next channel's verdict, with one line for each published pre-release whose source could not be placed. */
export type NextVerdict = PublishVerdict & { notices: string[] };

/**
 * What the registry showed after a publish.
 *
 * - `settled`: the record shows the version, and `next` is not behind a descendant's pre-release.
 * - `unsettled`: the record still lacks the version after every read.
 * - `behind`: the record shows the version, and `next` does not name the furthest descendant's pre-release it holds.
 */
export type ConfirmVerdict =
  | { outcome: "settled"; version: string; reads: number }
  | { outcome: "unsettled"; version: string; reason: string }
  | { outcome: "behind"; version: string; reason: string };
