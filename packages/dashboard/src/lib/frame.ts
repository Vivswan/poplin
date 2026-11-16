// What the frame around every screen shows of the install: the newer release it knows of, whether an update can be started, the version it can go back to, what its domain needs, and what went wrong within a day.

import { type DefinedUseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";
import { BOOT } from "@/lib/boot";

/** The key the frame's data is kept under. It sits under the settings' key: a saved setting makes it stale with them. A run on the domain, and a try to start an update, mark it stale by this key. */
export const FRAME_KEY = ["settings", "frame"] as const;

/** How long the frame's data stands as it was read, in milliseconds. Past it, a page that is looked at again, or moved to another screen, reads it again. */
const FRESH_MS = 5 * 60_000;

/** How often a page that stays open and in sight reads the frame's data again, in milliseconds: a problem leaves the frame a day after it was last seen, and a new one comes at any time. */
const READ_AGAIN_MS = 15 * 60_000;

/** The key it is kept under that an update was started from this page. */
const STARTED_KEY = ["update", "started"] as const;

/** Where a key is to be had, after a sentence that says the install holds none: only a console with a Domain screen has the place. */
export const GET_KEY = BOOT.domain ? " Open Domain and press Repair." : "";

/** What the server answers. */
type Frame = InferResponseType<typeof api.frame.$get, 200>;

/** The frame as the page started with it: nothing is asked until it is stale. */
const AT_START: Frame = { ok: true, update: BOOT.update, starts: BOOT.starts, back: BOOT.back, domainNote: BOOT.domainNote, recent: BOOT.recent, marks: BOOT.marks };

/** Read the frame's data. It starts from the page's own values, and is read again after a change that touches it and as it grows old, so a mark neither stays past its problem nor comes late. */
export function useFrame(): DefinedUseQueryResult<Frame> {
  return useQuery({ queryKey: FRAME_KEY, queryFn: () => answerOf(api.frame.$get()), initialData: AT_START, staleTime: FRESH_MS, refetchInterval: READ_AGAIN_MS });
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
