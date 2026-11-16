// What a visitor's request for a site costs as the install grows, and as the site does.

import type { Fill } from "../../../load/profiles";
import { filePath } from "../../shared/worker/support/budget-seeds";
import { get } from "../../shared/worker/support/budget-stage";
import { accessHeaders } from "../../shared/worker/support/install";
import { FILLED, fillInstall } from "./fill";
import type { Scenario } from "./measure";

/** The header the provider writes a visitor's address into. */
const ADDRESS_HEADER = "CF-Connecting-IP";

/** An address of no site. */
const NO_SITE = "https://nothing--zzzzzzzzzzzz-u-poplin.example.com/";

/** A visitor of its own for each scenario and size, so no scenario spends another's minute: an address of the range kept for examples. */
export function visitorOf(scenario: number, fill: Fill): Record<string, string> {
  return { [ADDRESS_HEADER]: `2001:db8::${scenario}:${fill.sites.toString(16)}:${fill.files.toString(16)}:${fill.entries.toString(16)}` };
}

/** A visitor's request for one address of a filled install. */
function view(at: number, name: string, axis: Scenario["axis"], address: (fill: Fill) => string, status: number): Scenario {
  return {
    name,
    axis,
    flat: true,
    open: true,
    status,
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const headers = visitorOf(at, fill);

      return (measured) => get(measured, address(fill), headers);
    },
  };
}

/** A visitor's requests. */
export const SERVE_SCENARIOS: readonly Scenario[] = [
  view(1, "serve a public file", "sites", () => `${FILLED.public}/${filePath(1)}`, 200),
  view(2, "serve a public file: the last of a site's files", "files", (fill) => `${FILLED.public}/${filePath(fill.files - 1)}`, 200),
  view(3, "serve an unlisted page", "sites", () => `${FILLED.unlisted}/`, 200),
  {
    name: "serve a private page, logged in",
    axis: "sites",
    flat: true,
    status: 200,
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const headers = { ...(await accessHeaders(stage.w)), ...visitorOf(4, fill) };

      return (measured) => get(measured, `${FILLED.private}/`, headers);
    },
  },
  view(5, "a file a site does not hold: 404", "sites", () => `${FILLED.public}/nothing-here.html`, 404),
  view(6, "an address of no site", "sites", () => NO_SITE, 302),
];
