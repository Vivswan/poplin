// What the frame around every screen shows of the install: the newer release it knows of, whether an update can be started, and what its domain needs.

import { type DefinedUseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";
import { BOOT } from "@/lib/boot";

/** The key the frame's data is kept under. It sits under the settings' key: a saved setting, or a saved update link, makes it stale with them. A run on the domain marks it stale by this key. */
export const FRAME_KEY = ["settings", "frame"] as const;

/** The key it is kept under that an update was started from this page. */
const STARTED_KEY = ["update", "started"] as const;

/** What the server answers. */
type Frame = InferResponseType<typeof api.frame.$get, 200>;

/** The frame as the page started with it: nothing is asked until a change makes it stale. */
const AT_START: Frame = { ok: true, update: BOOT.update, starts: BOOT.starts, domainNote: BOOT.domainNote };

/** Read the frame's data. It starts from the page's own values and is read again after a setting changes. */
export function useFrame(): DefinedUseQueryResult<Frame> {
  return useQuery({ queryKey: FRAME_KEY, queryFn: () => answerOf(api.frame.$get()), initialData: AT_START, staleTime: Number.POSITIVE_INFINITY });
}

/**
 * Whether an update was started from this page, and the way to say that one was. It is kept beside the frame's data, so the frame of every screen says it.
 *
 * @returns the fact, and a function that sets it
 */
export function useStarted(): readonly [boolean, () => void] {
  const client = useQueryClient();
  const { data } = useQuery({ queryKey: STARTED_KEY, queryFn: () => false, initialData: false, staleTime: Number.POSITIVE_INFINITY });

  return [data, () => client.setQueryData(STARTED_KEY, true)];
}
