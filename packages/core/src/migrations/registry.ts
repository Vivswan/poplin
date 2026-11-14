// Old schemas and every step between them live in this folder alone; all other code knows only the current schema.
// A step is one file named `0001-<what>.ts`, numbered in the order written, and listed here in that order.

import { CREATE_SCHEMA } from "./0001-create-schema";
import type { Step } from "./migrate";

/** Every step, in ascending order from 1 with no gap. */
export const STEPS: readonly Step[] = [CREATE_SCHEMA];

/** The schema version this code reads and writes: the number of the last step. */
export const SCHEMA_VERSION = STEPS.length;
