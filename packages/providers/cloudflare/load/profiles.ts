// How large the install of a load run is: what every run fills in, the sizes one thing is varied over, and how often a request is repeated.
//
//   profile   runs                    sizes
//   slice     with the Worker's tests two small sizes a thing, so a cost that grows where it should stay flat fails a pull request
//   full      `bun run load`          up to 5,000 sites, a site of 5,000 files, and a log of 200,000 entries

/** What an install is filled with before a request is measured. */
export interface Fill {
  /** The sites, each with its versions. */
  readonly sites: number;

  /** The versions each site keeps. */
  readonly versions: number;

  /** The files of the live version of the one site the requests are about. */
  readonly files: number;

  /** The entries of the Activity log. */
  readonly entries: number;

  /** The users who may log in. */
  readonly users: number;

  /** The tokens that work. */
  readonly tokens: number;
}

/** The one thing of a fill a scenario is measured across. */
export type Axis = "sites" | "files" | "entries" | "users";

/** One load run: its sizes and its repeats. */
export interface Profile {
  /** What a report calls the run. */
  readonly name: "slice" | "full";

  /** What every size is filled with, but for the one thing a scenario varies. */
  readonly base: Fill;

  /** The sizes of each thing a scenario varies, the smallest first. */
  readonly sizes: Readonly<Record<Axis, readonly number[]>>;

  /** How many requests follow the first one, one after another. */
  readonly row: number;

  /** How many requests are then sent at once. */
  readonly burst: number;
}

/** The run of every pull request: seconds long, and two sizes a thing, which is what telling flat from growing takes. Each size is past what one page of a screen holds, so a page that is full costs the same at both. */
export const SLICE: Profile = {
  name: "slice",
  base: { sites: 120, versions: 3, files: 10, entries: 400, users: 5, tokens: 10 },
  sizes: { sites: [120, 400], files: [10, 120], entries: [6000, 12_000], users: [5, 50] },
  row: 3,
  burst: 10,
};

/** The run a person starts: the sizes an install on the provider's free plan may reach. */
export const FULL: Profile = {
  name: "full",
  base: { sites: 100, versions: 3, files: 10, entries: 1000, users: 5, tokens: 50 },
  sizes: { sites: [10, 100, 1000, 5000], files: [10, 1000, 5000], entries: [1000, 50_000, 200_000], users: [5, 50] },
  row: 20,
  burst: 50,
};

/**
 * Write the fill of one size of a profile.
 *
 * @returns the profile's base with the one thing at the size
 */
export function fillOf(profile: Profile, axis: Axis, size: number): Fill {
  return { ...profile.base, [axis]: size };
}

/** The most one request of each scenario may cost at the slice's largest size: what it costs today. A scenario with no row here fails the slice. */
export const SLICE_CEILINGS: Readonly<Record<string, { readonly queries: number; readonly read: number; readonly written: number; readonly bucket: number }>> = {
  "serve a public file": { queries: 3, read: 6, written: 2, bucket: 1 },
  "serve a public file: the last of a site's files": { queries: 3, read: 6, written: 2, bucket: 1 },
  "serve an unlisted page": { queries: 2, read: 6, written: 2, bucket: 1 },
  "serve a private page, logged in": { queries: 3, read: 6, written: 2, bucket: 1 },
  "a file a site does not hold: 404": { queries: 3, read: 6, written: 2, bucket: 1 },
  "an address of no site": { queries: 1, read: 2, written: 0, bucket: 0 },
  "dashboard first load: the page": { queries: 3, read: 7, written: 0, bucket: 0 },
  "dashboard first load: the frame": { queries: 2, read: 6, written: 0, bucket: 0 },
  "Sites list: the first page": { queries: 2, read: 470, written: 0, bucket: 0 },
  "Sites list: sorted by title": { queries: 2, read: 473, written: 0, bucket: 0 },
  "Sites list: sorted by name": { queries: 2, read: 473, written: 0, bucket: 0 },
  "Sites list: sorted by access": { queries: 2, read: 472, written: 0, bucket: 0 },
  "Sites list: searched, many found": { queries: 2, read: 470, written: 0, bucket: 0 },
  "Sites list: searched, none found": { queries: 2, read: 403, written: 0, bucket: 0 },
  "Sites list: the trash": { queries: 2, read: 4, written: 0, bucket: 0 },
  "a site's panel": { queries: 2, read: 26, written: 0, bucket: 0 },
  "Activity: the largest page": { queries: 2, read: 402, written: 0, bucket: 0 },
  "Activity: narrowed to one site": { queries: 3, read: 5053, written: 0, bucket: 0 },
  "Activity: the count of entries": { queries: 2, read: 4, written: 0, bucket: 0 },
  "Activity: download a file": { queries: 4, read: 4002, written: 0, bucket: 0 },
  "Activity: where the next file goes on": { queries: 3, read: 2004, written: 0, bucket: 0 },
  "Usage": { queries: 3, read: 3, written: 0, bucket: 0 },
  "Usage: 90 days of visits, 50 sites compared": { queries: 3, read: 4847, written: 0, bucket: 0 },
  "Usage: a year of visits, 50 sites compared": { queries: 3, read: 3012, written: 0, bucket: 0 },
  "Access: the people": { queries: 2, read: 12, written: 0, bucket: 0 },
  "Access: the tokens": { queries: 2, read: 13, written: 0, bucket: 0 },
  "Settings": { queries: 1, read: 2, written: 0, bucket: 0 },
  "publish: start, a new site": { queries: 3, read: 9, written: 5, bucket: 0 },
  "publish: one file, from the last one on": { queries: 2, read: 2, written: 0, bucket: 2 },
  "publish: finish, a new site": { queries: 5, read: 20, written: 17, bucket: 1 },
  "duplicate a site: the first request": { queries: 4, read: 17, written: 6, bucket: 225 },
  "import: start": { queries: 4, read: 9, written: 5, bucket: 0 },
  "import: finish": { queries: 5, read: 22, written: 17, bucket: 1 },
  "delete a site: to the trash": { queries: 3, read: 15, written: 6, bucket: 0 },
  "delete a site for good": { queries: 5, read: 33, written: 12, bucket: 1 },
  "delete a site for good: its files": { queries: 5, read: 33, written: 12, bucket: 2 },
  "scheduled run: nothing due": { queries: 6, read: 26, written: 0, bucket: 0 },
  "scheduled run: nothing due, a long log": { queries: 6, read: 26, written: 0, bucket: 0 },
  "scheduled run: the trash sweep, every spare site past its days": { queries: 14, read: 383, written: 168, bucket: 15 },
  "list the sites: the largest page": { queries: 2, read: 1213, written: 0, bucket: 0 },
  "export: a page of sites, every version": { queries: 2, read: 506, written: 0, bucket: 0 },
  "export: a page of a version's files": { queries: 3, read: 9, written: 1, bucket: 1 },
  "export: one file": { queries: 2, read: 7, written: 0, bucket: 1 },
  "export: the settings": { queries: 2, read: 2, written: 0, bucket: 0 },
  "read the log: the largest page": { queries: 2, read: 101, written: 0, bucket: 0 },
  "refusal: one visitor past its requests of a minute": { queries: 3, read: 6, written: 2, bucket: 1 },
  "refusal: a publish past the most sites an install may hold": { queries: 3, read: 10, written: 5, bucket: 0 },
  "refusal: one holder past its unfinished uploads": { queries: 3, read: 136, written: 5, bucket: 0 },
  "refusal: one visitor past its checks of a login's secret of a minute": { queries: 2, read: 2, written: 0, bucket: 0 },
};
