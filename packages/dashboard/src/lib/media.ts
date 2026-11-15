// Whether the browser matches a media query, read again whenever that changes.

import { useCallback, useSyncExternalStore } from "react";

/**
 * Follow a media query.
 *
 * @param query - the query, such as `(min-width: 1040px)`
 * @returns whether the browser matches it now
 */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);

      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
