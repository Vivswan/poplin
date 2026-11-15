// Old schemas and every step between them live in this folder alone; all other code knows only the current schema.
// A step is one file named `0001-<what>.ts`, numbered in the order written, and listed here in that order.
// `bun run --cwd packages/core draft-step "<what>"` drafts the next one from a change to `database/schema.ts`.

import { CREATE_SCHEMA } from "./0001-create-schema";
import type { Step } from "./migrate";

/** Every step, in ascending order from 1 with no gap. */
export const STEPS: readonly Step[] = [CREATE_SCHEMA];
