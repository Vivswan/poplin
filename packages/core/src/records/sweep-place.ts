// Where the sweep's walk stands between two of its steps, and between two scheduled runs.

import * as v from "valibot";

import { MOMENT, SITE_ID } from "./fields";
import { SITE_FOLDER } from "./site";
import { UPLOAD_ID } from "./upload";

/** Where a walk stands: in the sites or in the trash, after which site; in the uploads, after which upload; or in the leftovers, after which folder. */
export const SWEEP_PLACE = v.union([
  v.strictObject({ trash: v.boolean(), after: v.optional(v.strictObject({ updated_at: MOMENT, id: SITE_ID })) }),
  v.strictObject({ uploads: v.literal(true), after: v.optional(v.strictObject({ created_at: MOMENT, id: UPLOAD_ID })) }),
  v.strictObject({ leftovers: v.literal(true), after: v.optional(SITE_FOLDER) }),
]);

/** Where a walk stands. */
export type SweepPlace = v.InferOutput<typeof SWEEP_PLACE>;
