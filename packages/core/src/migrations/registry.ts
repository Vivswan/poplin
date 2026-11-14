// Old shapes, old names, and every step between shapes live in this folder alone; all other code knows only the current shape.
// A step is one file named `0001-<what>.ts`, numbered in the order written, and listed here under its record kind in ascending order.

import type { Registry } from "./upgrade";

/** The steps of each record kind. A kind at its first shape has none. */
export const REGISTRY: Registry = { settings: [], site: [], token: [] };
