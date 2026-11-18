// Every live check, in the order a run makes them. The check of the way a file goes comes first: it watches the run's first publish. The edge checks come last.

import { BACKUP_CHECKS } from "./checks/backup";
import { EDGE_CHECKS } from "./checks/edge";
import { LETTER_CHECKS } from "./checks/letters";
import { LIFECYCLE_CHECKS } from "./checks/lifecycle";
import { LOG_CHECKS } from "./checks/logs";
import { UPLOAD_CHECKS } from "./checks/uploads";
import { USER_CHECKS } from "./checks/users";
import type { Check } from "./records";

/** The whole suite. */
export const CHECKS: readonly Check[] = [...UPLOAD_CHECKS, ...LIFECYCLE_CHECKS, ...BACKUP_CHECKS, ...USER_CHECKS, ...LOG_CHECKS, ...LETTER_CHECKS, ...EDGE_CHECKS];
