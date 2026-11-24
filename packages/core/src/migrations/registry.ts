// Old schemas and every step between them live in this folder alone; all other code knows only the current schema.
// A file is named for the release its steps migrate away from, `<version>.ts`, and is listed here in ascending order of version.
// `bun run --cwd packages/core draft-step "<what>"` drafts a step from a change to `database/schema.ts`, into the file of the newest release.

import { V0_0_0 } from "./0.0.0";
import { V0_1_2 } from "./0.1.2";
import type { Step, VersionSteps } from "./migrate";

/** Every file of steps, in ascending order of version. */
export const VERSIONS: readonly VersionSteps[] = [V0_0_0, V0_1_2];

/** Every step in the order they run: by version, then as its file lists them. A step's place here, counted from 1, is the schema version it leaves a database at. */
export const STEPS: readonly Step[] = VERSIONS.flatMap(({ version, steps }) => steps.map((step): Step => ({ version, ...step })));
