// Every live check, in the order a run makes them. The edge checks come last: their last two use up the visitor's minute.

import { BACKUP_CHECKS } from "./checks/backup";
import { EDGE_CHECKS } from "./checks/edge";
import { LETTER_CHECKS } from "./checks/letters";
import { LIFECYCLE_CHECKS } from "./checks/lifecycle";
import type { Check } from "./records";

/** The whole suite. */
export const CHECKS: readonly Check[] = [...LIFECYCLE_CHECKS, ...BACKUP_CHECKS, ...LETTER_CHECKS, ...EDGE_CHECKS];
