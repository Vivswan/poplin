// What the shell page hands the client to start from.

import type { Boot } from "@poplin/app/src/console/shell";

/** The start values of this page, read once from the data block the shell page carries. */
export const BOOT: Boot = JSON.parse(document.getElementById("boot")?.textContent ?? "{}") as Boot;
