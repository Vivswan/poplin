// The tests' stand-in for the host's side of an update: a host a test sets up by hand, which fetches nothing and replaces no code.

import { NEWEST } from "@poplin/core/src/actions/update/pick-release";
import type { SelfUpdate } from "@poplin/core/src/actions/start-update";

/** What a host answers a release it does not take. */
type Refusal = Exclude<Awaited<ReturnType<SelfUpdate["ready"]>>, { readonly ok: true }>;

/** A host as a test sets it: whether it holds the key an update is sent with, the newest release above the running version or `null`, what it refuses a release with, the update it keeps as the last one, and every version it put in place. */
export interface UpdateHost {
  key: boolean;
  release: string | null;
  refusal: Refusal | undefined;
  last?: SelfUpdate["last"];
  readonly put: string[];
}

/** A host that holds its key and takes the release given. */
export function updateHost(release: string): UpdateHost {
  return { key: true, release, refusal: undefined, put: [] };
}

/**
 * Make what an API or a console is handed to update with, over a host a test changes as it goes.
 *
 * @returns a door that answers `no_update` while the host names no release and none is asked for by its version, the host's refusal while it has one, and else takes the release, or the one version asked for, and notes it in `put`
 */
export function hostUpdate(host: UpdateHost): SelfUpdate {
  return {
    holdsKey: () => host.key,
    get last() {
      return host.last;
    },
    ready: async (wanted) => {
      const version = wanted.version === NEWEST ? host.release : wanted.version;
      if (version === null) return { ok: false, code: "no_update" };

      if (host.refusal !== undefined) return host.refusal;

      return {
        ok: true,
        version,
        put: async () => {
          host.put.push(version);

          return { ok: true };
        },
      };
    },
  };
}
