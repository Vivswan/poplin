// How the Settings screen reads its data: every setting as a row, and whether an update link is saved.

import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";

/** The key the settings' data is kept under: every change of a setting makes it stale, so the rows are read again. */
export const SETTINGS_KEY = ["settings"] as const;

/** The key the saves of a setting are counted under, so it is known whether one is on its way, and which is the last of a run of them. */
export const SETTINGS_SAVES_KEY = [...SETTINGS_KEY, "save"] as const;

/** What the server answers. */
export type Settings = InferResponseType<typeof api.settings.$get, 200>;

/** One setting: its key, its control, its value as text, its default, and its state. */
export type Row = Settings["rows"][number];

/** Whether an update link is saved, and since when in milliseconds since the epoch. The address itself is in no answer. */
export type UpdateAddress = Settings["updateAddress"];

/** Read every setting. A window that gets the focus back reads again only while no save is on its way: such a read would show, for a moment, the value from before the save. */
export function useSettings(): UseQueryResult<Settings> {
  const client = useQueryClient();

  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => answerOf(api.settings.$get()),
    refetchOnWindowFocus: () => client.isMutating({ mutationKey: SETTINGS_SAVES_KEY }) === 0,
  });
}
