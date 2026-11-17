import { expect, test } from "bun:test";

import type { DomainReading, DomainSettings } from "../../../app/src/console/domain/records";
import { changingPlug, WITH_DOMAIN, WITHOUT_DOMAIN } from "../../src/preview/domain-plug";

/** The settings a run reads, which the preview's plug asks for and does not use. */
const SETTINGS: DomainSettings = { logins: [], outside_pages: "blocked", search_engines_allowed: false, block_bots: "off", provider_logs: true };

/** The optional rows of a run that read its table, each as its state and its detail. */
function optionalRows(reading: DomainReading): string[] {
  if (!reading.ok) return [];

  return reading.rows.filter((row) => row.state === "optional").map((row) => `${row.object} | ${row.detail}`);
}

// Drift: the row of the optional piece would name a right the token form does not offer, say another thing of it than the form says, or leave after a repair with a token that never had the right.
test.each([
  ["under a domain", WITH_DOMAIN, "Rate rule | sample-rate-rule: The provider stops floods before they reach a site. To switch this on, add this permission to the account token and press Repair: Rules: Edit"],
  [
    "without a domain",
    WITHOUT_DOMAIN,
    "Spend alert | sample-spend-alert: The provider emails your first user when the account's charges reach an amount. To switch this on, add this permission to the account token and press Repair: Alerts: Edit",
  ],
])("an install %s has one optional piece, whose row says what the token form says of its right, on a check and after a repair", async (_kind, provider, row) => {
  const plug = changingPlug(provider);
  const read = async (): Promise<DomainSettings> => SETTINGS;
  const ends = plug.tokenOptional.map(({ right, adds }) => row.endsWith(`: ${adds} To switch this on, add this permission to the account token and press Repair: ${right}`));

  expect([optionalRows(await plug.check("any", read)), optionalRows(await plug.repair("any", read))]).toEqual([[row], [row]]);
  expect(ends).toEqual([true]);
});
