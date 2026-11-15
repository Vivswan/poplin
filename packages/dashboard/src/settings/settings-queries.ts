// How the Settings screen reads its data: every setting as a row, and whether an address that starts a rebuild is saved.

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";

import { answerOf, api } from "@/lib/api";

/** The key the settings' data is kept under: every change of a setting makes it stale, so the rows are read again. */
export const SETTINGS_KEY = ["settings"] as const;

/** What the server answers. */
export type Settings = InferResponseType<typeof api.settings.$get, 200>;

/** One setting: its key, its control, its value as text, its default, and its state. */
export type Row = Settings["rows"][number];

/** Whether a rebuild address is saved, and since when in milliseconds since the epoch. The address itself is in no answer. */
export type UpdateAddress = Settings["updateAddress"];

/** Read every setting. */
export function useSettings(): UseQueryResult<Settings> {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => answerOf(api.settings.$get()) });
}
