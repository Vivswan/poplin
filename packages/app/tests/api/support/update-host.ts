// The tests' stand-in for the host's side of an update: a host a test sets up by hand, which fetches nothing and replaces no code.

import type { SelfUpdate } from "@poplin/core/src/actions/start-update";

/** What a host answers a release it does not take. */
type Refusal = Exclude<Awaited<ReturnType<SelfUpdate["ready"]>>, { readonly ok: true }>;

/** A host as a test sets it: whether it holds the key an update is sent with, the newest release above the running version or `null`, what it refuses that release with, and every version it put in place. */
export interface UpdateHost {
  key: boolean;
  release: string | null;
  refusal: Refusal | undefined;
  readonly put: string[];
}

/** A host that holds its key and takes the release given. */
export function updateHost(release: string): UpdateHost {
  return { key: true, release, refusal: undefined, put: [] };
}

/**
 * Make what an API or a console is handed to update with, over a host a test changes as it goes.
 *
 * @returns a door that answers `no_update` while the host names no release, the host's refusal while it has one, and else takes the release and notes it in `put`
 */
export function hostUpdate(host: UpdateHost): SelfUpdate {
  return {
    holdsKey: () => host.key,
    ready: async () => {
      const { release, refusal } = host;
      if (release === null) return { ok: false, code: "no_update" };

      if (refusal !== undefined) return refusal;

      return {
        ok: true,
        version: release,
        put: async () => {
          host.put.push(release);

          return { ok: true };
        },
      };
    },
  };
}
