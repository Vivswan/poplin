// What the setup page hands the client to start from, and how the setup screen sends its run.

import type { SetupRoutes } from "@poplin/app/src/console/setup-console";
import { hc, type InferResponseType } from "hono/client";

import type { Domain } from "@/domain/domain-queries";
import { BOOT } from "@/lib/boot";

/** What the setup screen starts from: which boxes its form has, and what a token must hold. Nothing in it is of the install. */
interface Start {
  /** `first` on an install with nothing set, which is asked its domain and first login; `login` on one nobody has logged in to. */
  readonly boxes: "first" | "login";

  /** What a token must hold and where one is made, in the provider's words. */
  readonly form: Domain["form"];
}

/** The start values of the setup screen, out of the ones the page carries; `null` on every page but the setup page. */
export const SETUP: Start | null = (BOOT as typeof BOOT & { readonly setup?: Start }).setup ?? null;

/** The setup screen's runs, called as `setupApi.repair.$post({ json })`. */
export const setupApi = hc<SetupRoutes>(`${BOOT.base}/data`);

/** A run of the setup screen that read its pieces, as the server answers it. */
export type SetupRan = InferResponseType<typeof setupApi.repair.$post, 200>;
